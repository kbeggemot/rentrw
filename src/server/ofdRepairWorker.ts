import { listSales, updateSaleOfdUrlsByOrderId, listAllSales, updateSaleFromStatus } from './taskStore';
import { appendOfdAudit } from './audit';
import { fermaGetAuthTokenCached, fermaCreateReceipt, fermaGetReceiptStatus, buildReceiptViewUrl } from './ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_FULL_PAYMENT, PAYMENT_METHOD_PREPAY_FULL } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from './userStore';
import { getDecryptedApiToken } from './secureStore';

let started = false;
let timer: NodeJS.Timer | null = null;

/**
 * Periodically scans sales for missing OFD receipts and repairs them.
 * Cases:
 * - isToday and status final: create full settlement (Income) if missing and invoiceIdFull exists
 * - not today and status final: create prepayment (IncomePrepayment) if missing and invoiceIdPrepay exists
 * - DO NOT create offset here; it is handled by the scheduler at 12:00 MSK
 */
export function startOfdRepairWorker(): void {
  if (started) return;
  started = true;
  // first tick soon after start
  setTimeout(() => { runRepairTick().catch(() => void 0); }, 15 * 1000);
  timer = setInterval(() => { runRepairTick().catch(() => void 0); }, 3 * 60 * 1000); // every 3 minutes
}

async function runRepairTick(): Promise<void> {
  try {
    const all = await listAllSales();
    const userIds = Array.from(new Set(all.map((s) => s.userId)));
    for (const uid of userIds) {
      try { await repairUserSales(uid); } catch {}
    }
  } catch {}
}

// Helper that performs repair for a single user
export async function repairUserSales(userId: string): Promise<void> {
  const sales = await listSales(userId);
  if (sales.length === 0) return;
  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const ofdToken = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
  // RW API settings for background pay trigger
  const rwBase = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
  let rwToken: string | null = null;
  try { rwToken = await getDecryptedApiToken(userId); } catch { rwToken = null; }
  const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
  for (const s of sales) {
    const status = String(s.status || '').toLowerCase();
    const final = status === 'paid' || status === 'transfered' || status === 'transferred';
    if (!final) continue;
    const created = s.createdAtRw || s.createdAt;
    const createdDate = created ? String(created).slice(0, 10) : null;
    const endDate = s.serviceEndDate || null;
    const isToday = Boolean(createdDate && endDate && createdDate === endDate);
    // Full settlement today
    if (isToday) {
      if (!s.ofdFullId && !s.ofdFullUrl && s.invoiceIdFull) {
        try {
          // Idempotency pre-check: see if OFD already has receipt by stored InvoiceId (C)
          const invoiceIdFull = s.invoiceIdFull;
          try {
            const st = await fermaGetReceiptStatus(String(invoiceIdFull), { baseUrl, authToken: ofdToken });
            const obj = st.rawText ? JSON.parse(st.rawText) : {};
            const fn = obj?.Data?.Fn || obj?.Fn;
            const fd = obj?.Data?.Fd || obj?.Fd;
            const fp = obj?.Data?.Fp || obj?.Fp;
            const rid = obj?.Data?.ReceiptId || obj?.ReceiptId;
            if ((fn && fd != null && fp != null) || rid) {
              const url = fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined;
              try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
              await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullId: rid || null, ofdFullUrl: url || null });
              continue; // already exists -> skip creation
            }
          } catch {}
          // create new with stored InvoiceId C
          if (s.isAgent) {
            // need partner inn/name from RW
            const token = await getDecryptedApiToken(userId);
            if (!token) continue;
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            const r = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            const txt = await r.text();
            let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
            const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
            const partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
            if (!partnerInn) continue;
            const partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
            const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: s.description || 'Оплата услуги', amountRub: s.isAgent ? Math.max(0, s.amountGrossRub - s.retainedCommissionRub) : s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdFull, callbackUrl: undefined, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
            await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullId: created.id || null });
          } else {
            const orgInn = (s.orgInn && String(s.orgInn).trim().length > 0 && String(s.orgInn) !== 'неизвестно') ? String(s.orgInn).replace(/\D/g, '') : null;
            if (!orgInn) continue;
            const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: s.description || 'Оплата услуги', amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdFull, callbackUrl: undefined, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: 'Организация' } });
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
            await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullId: created.id || null });
          }
        } catch {}
      }
      continue;
    }
    // Prepayment receipt missing
    if (!s.ofdPrepayId && !s.ofdUrl && s.invoiceIdPrepay) {
      try {
        const invoiceIdPrepay = s.invoiceIdPrepay;
        // Idempotency pre-check: maybe prepay already exists by stored invoice A
        try {
          const st = await fermaGetReceiptStatus(String(invoiceIdPrepay), { baseUrl, authToken: ofdToken });
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const fn = obj?.Data?.Fn || obj?.Fn;
          const fd = obj?.Data?.Fd || obj?.Fd;
          const fp = obj?.Data?.Fp || obj?.Fp;
          const rid = obj?.Data?.ReceiptId || obj?.ReceiptId;
          if ((fn && fd != null && fp != null) || rid) {
            const url = fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined;
            try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
            await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdPrepayId: rid || null, ofdUrl: url || null });
            continue;
          }
        } catch {}
        // create with stored A
        if (s.isAgent) {
          const token = await getDecryptedApiToken(userId);
          if (!token) continue;
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
          const r = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          const txt = await r.text();
          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
          const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
          const partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
          if (!partnerInn) continue;
          const partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
          const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: s.description || 'Оплата услуги', amountRub: Math.max(0, s.amountGrossRub - s.retainedCommissionRub), vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdPrepay, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdPrepayId: created.id || null });
        } else {
          const orgInn = (s.orgInn && String(s.orgInn).trim().length > 0 && String(s.orgInn) !== 'неизвестно') ? String(s.orgInn).replace(/\D/g, '') : null;
          if (!orgInn) continue;
          const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: s.description || 'Оплата услуги', amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdPrepay, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: 'Организация' } });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdPrepayId: created.id || null });
        }
      } catch {}
    }
    // Background pay trigger (same conditions as in tasks GET handler), but in the background
    try {
      const aoStatus = String(s.status || '').toLowerCase();
      const hasFull = Boolean(s.ofdFullUrl);
      if (s.isAgent && hasFull && aoStatus === 'transfered' && rwToken) {
        const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, rwBase.endsWith('/') ? rwBase : rwBase + '/').toString();
        const res = await fetch(tUrl, { headers: { Authorization: `Bearer ${rwToken}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await res.text();
        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
        const taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
        const rootStatus = String(taskObj?.status || '').toLowerCase();
        if (rootStatus === 'completed') {
          const payUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}/pay`, rwBase.endsWith('/') ? rwBase : rwBase + '/').toString();
          try {
            if (process.env.OFD_AUDIT === '1') {
              await appendOfdAudit({ ts: new Date().toISOString(), source: 'repair_worker', userId, orderId: s.orderId, taskId: s.taskId, action: 'background_pay', patch: { reason: 'agent_transfered_completed_has_full', payUrl } });
            }
          } catch {}
          await fetch(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${rwToken}`, Accept: 'application/json' }, cache: 'no-store' });
          // After pay, poll briefly to capture receipt_uri and refresh local store
          let triesNpd = 0;
          while (triesNpd < 5) {
            await new Promise((r) => setTimeout(r, 1200));
            const r2 = await fetch(tUrl, { headers: { Authorization: `Bearer ${rwToken}`, Accept: 'application/json' }, cache: 'no-store' });
            const t2 = await r2.text();
            let o2: any = null; try { o2 = t2 ? JSON.parse(t2) : null; } catch { o2 = t2; }
            const norm = (o2 && typeof o2 === 'object' && 'task' in o2) ? (o2.task as any) : o2;
            const npd = (norm?.receipt_uri as string | undefined) ?? undefined;
            const ofd = (norm?.ofd_url as string | undefined)
              ?? (norm?.ofd_receipt_url as string | undefined)
              ?? (norm?.acquiring_order?.ofd_url as string | undefined)
              ?? (norm?.acquiring_order?.ofd_receipt_url as string | undefined)
              ?? undefined;
            const add = (norm?.additional_commission_ofd_url as string | undefined) ?? undefined;
            const aoSt = (norm?.acquiring_order?.status as string | undefined) ?? undefined;
            try { await updateSaleFromStatus(userId, s.taskId, { status: aoSt, ofdUrl: ofd, additionalCommissionOfdUrl: add, npdReceiptUri: npd }); } catch {}
            if (npd) break;
            triesNpd += 1;
          }
        }
      }
    } catch {}
  }
}


