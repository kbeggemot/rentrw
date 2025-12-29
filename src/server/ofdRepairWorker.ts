import { listSales, updateSaleOfdUrlsByOrderId, listAllSales, updateSaleFromStatus } from './taskStore';
import { appendOfdAudit } from './audit';
import { appendRwError } from './rwAudit';
import { fermaGetAuthTokenCached, fermaCreateReceipt, fermaGetReceiptStatus, buildReceiptViewUrl } from './ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_FULL_PAYMENT, PAYMENT_METHOD_PREPAY_FULL } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from './userStore';
import { getDecryptedApiToken } from './secureStore';
import { getInvoiceIdForOffset } from './orderStore';
import { listProductsForOrg } from './productsStore';
import { fetchTextWithTimeout } from './http';
import { ensureLeaderLease } from './leaderLease';

let started = false;
let timer: NodeJS.Timer | null = null;
let running = false;

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
  async function runSafe(): Promise<void> {
    if (running) return;
    running = true;
    try { await runRepairTick(); } catch {} finally { running = false; }
  }
  // first tick soon after start
  setTimeout(() => { runSafe().catch(() => void 0); }, 15 * 1000);
  timer = setInterval(() => { runSafe().catch(() => void 0); }, 3 * 60 * 1000); // every 3 minutes
}

async function runRepairTick(): Promise<void> {
  // Multi-instance safety: only one replica should run repair scans to avoid stampeding S3/RW/OFD.
  try {
    const ok = await ensureLeaderLease('ofdRepairWorker', 5 * 60_000);
    if (!ok) return;
  } catch {}
  try {
    const all = await listAllSales();
    const userIds = Array.from(new Set(all.map((s) => s.userId)));
    for (const uid of userIds) {
      try { await repairUserSales(uid); } catch {}
    }
  } catch {}
}

// Helper that performs repair for a single user
export async function repairUserSales(userId: string, onlyOrderId?: number): Promise<void> {
  const salesAll = await listSales(userId);
  const sales = typeof onlyOrderId === 'number' && Number.isFinite(onlyOrderId)
    ? salesAll.filter((s) => Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN) === onlyOrderId)
    : salesAll;
  if (sales.length === 0) return;
  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const ofdToken = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
  // RW API settings for background pay trigger
  const rwBase = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
  const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
  for (const s of sales) {
    // First: if we already have ReceiptId but no URL — try to resolve quickly
    try {
      const patchDirect: any = {};
      if (!s.ofdUrl && (s as any).ofdPrepayId) {
        try {
          const st = await fermaGetReceiptStatus(String((s as any).ofdPrepayId), { baseUrl, authToken: ofdToken });
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
          const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
          if (typeof direct === 'string' && direct.length > 0) patchDirect.ofdUrl = direct;
          else if (fn && fd != null && fp != null) patchDirect.ofdUrl = buildReceiptViewUrl(fn, fd, fp);
        } catch {}
      }
      if (!s.ofdFullUrl && (s as any).ofdFullId) {
        try {
          const st = await fermaGetReceiptStatus(String((s as any).ofdFullId), { baseUrl, authToken: ofdToken });
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
          const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
          if (typeof direct === 'string' && direct.length > 0) patchDirect.ofdFullUrl = direct;
          else if (fn && fd != null && fp != null) patchDirect.ofdFullUrl = buildReceiptViewUrl(fn, fd, fp);
        } catch {}
      }
      if (Object.keys(patchDirect).length > 0) {
        try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
        const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
        await updateSaleOfdUrlsByOrderId(userId, numOrder, patchDirect);
      }
    } catch {}

    const status = String(s.status || '').toLowerCase();
    const final = status === 'paid' || status === 'transfered' || status === 'transferred';
    if (!final) continue;
    const created = s.createdAtRw || s.createdAt;
    const createdDate = created ? String(created).slice(0, 10) : null;
    const endDate = s.serviceEndDate || null;
    // День полного расчёта определяем по дате оказания услуги в МСК
    const mskToday = new Date()
      .toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
      .split('.')
      .reverse()
      .join('-');
    const isToday = Boolean(endDate && endDate === mskToday);
    // Full settlement «день-в-день» по InvoiceId C — только если C присвоен
    if (isToday && s.invoiceIdFull) {
      if (!s.ofdFullId && !s.ofdFullUrl) {
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
              const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
              await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: rid || null, ofdFullUrl: url || null });
              continue; // already exists -> skip creation
            }
          } catch {}
          // create new with stored InvoiceId C
          if (s.isAgent) {
            // need partner inn/name from RW
            let token: string | null = null;
            try {
              const { resolveRwTokenWithFingerprint } = await import('./rwToken');
              const fp = (s as any)?.rwTokenFp || undefined;
              const inn = (s as any)?.orgInn || undefined;
              const res = await resolveRwTokenWithFingerprint({ headers: new Headers() } as any, userId, inn, fp);
              token = res.token;
            } catch {}
            if (!token) token = await getDecryptedApiToken(userId);
            if (!token) continue;
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            const out = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
            const txt = out.text;
            let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
            const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
            const partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
            if (!partnerInn) continue;
            const partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
            const itemsParam = await (async () => {
              try {
                const snap = (s as any)?.itemsSnapshot as any[] | null;
                if (!Array.isArray(snap) || snap.length === 0) return undefined;
                const orgInnDigits = (s as any)?.orgInn ? String((s as any).orgInn).replace(/\D/g, '') : undefined;
                const products = orgInnDigits ? await listProductsForOrg(orgInnDigits) : [];
                return snap.map((it: any) => {
                  const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                  return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                });
              } catch { return undefined; }
            })();
            const itemLabel = (() => { try { const d=(s as any)?.description&&String((s as any).description).trim(); if(d) return String(d).slice(0,128); const snap=(s as any)?.itemsSnapshot as any[]|null; if(Array.isArray(snap)&&snap.length>0){ const labels=snap.map(it=>String(it?.title||'').trim()).filter(Boolean); if(labels.length>0) return labels.join(', ').slice(0,128);} } catch{} return 'Оплата услуг'; })();
            const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: s.isAgent ? Math.max(0, s.amountGrossRub - s.retainedCommissionRub) : s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdFull, callbackUrl: undefined, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' }, items: itemsParam });
            try {
              const { readText, writeText } = await import('./storage');
              const prev = (await readText('.data/ofd_create_attempts.log')) || '';
              const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_attempt', party: 'partner', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: s.invoiceIdFull, doc: 'C' }) + '\n';
              await writeText('.data/ofd_create_attempts.log', prev + line);
            } catch {}
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            try {
              const { readText, writeText } = await import('./storage');
              const prev = (await readText('.data/ofd_create_attempts.log')) || '';
              const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_result', party: 'partner', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: s.invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status, doc: 'C' }) + '\n';
              await writeText('.data/ofd_create_attempts.log', prev + line);
            } catch {}
            try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
            { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
            // Try to resolve URL right away without waiting for callback
            try {
              let url: string | undefined;
              let tries = 0;
              while (!url && tries < 20 && created.id) {
                try {
                  const st = await fermaGetReceiptStatus(String(created.id), { baseUrl, authToken: ofdToken });
                  const obj = st.rawText ? JSON.parse(st.rawText) : {};
                  const fn = obj?.Data?.Fn || obj?.Fn;
                  const fd = obj?.Data?.Fd || obj?.Fd;
                  const fp = obj?.Data?.Fp || obj?.Fp;
                  const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                  if (direct && direct.length > 0) { url = direct; break; }
                  if (fn && fd != null && fp != null) { url = buildReceiptViewUrl(fn, fd, fp); break; }
                } catch {}
                tries += 1;
                await new Promise((r) => setTimeout(r, 400));
              }
              if (url) {
                try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
                { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: url }); }
              }
            } catch {}
          } else {
            const orgInn = (s.orgInn && String(s.orgInn).trim().length > 0 && String(s.orgInn) !== 'неизвестно') ? String(s.orgInn).replace(/\D/g, '') : null;
            if (!orgInn) continue;
            // Определяем реальное название организации; без него чек не создаём
            let supplierName: string | null = null;
            try {
              const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('./orgStore');
              const org = await findOrgByInn(orgInn);
              if (org && org.name && String(org.name).trim().length > 0) supplierName = String(org.name).trim();
              if (!supplierName && userId) {
                const token = await getTokenForOrg(orgInn, userId).catch(() => null);
                if (token) {
                  const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                  const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                  const outAcc = await fetchTextWithTimeout(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                  const txtAcc = outAcc.text;
                  let dataAcc: any = null; try { dataAcc = txtAcc ? JSON.parse(txtAcc) : null; } catch { dataAcc = txtAcc; }
                  const name = dataAcc?.account?.company_name || dataAcc?.company_name || null;
                  if (name && typeof name === 'string' && name.trim().length > 0) {
                    supplierName = name.trim();
                    try { await updateOrganizationName(orgInn, supplierName); } catch {}
                  }
                }
              }
            } catch {}
            if (!supplierName) continue;
            const itemsParamOrg = await (async () => {
              try {
                const snap = (s as any)?.itemsSnapshot as any[] | null;
                if (!Array.isArray(snap) || snap.length === 0) return undefined;
                const products = await listProductsForOrg(orgInn);
                return snap.map((it: any) => {
                  const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                  return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                });
              } catch { return undefined; }
            })();
            const itemLabelOrg = (() => { try { const d=(s as any)?.description&&String((s as any).description).trim(); if(d) return String(d).slice(0,128); const snap=(s as any)?.itemsSnapshot as any[]|null; if(Array.isArray(snap)&&snap.length>0){ const labels=snap.map(it=>String(it?.title||'').trim()).filter(Boolean); if(labels.length>0) return labels.join(', ').slice(0,128);} } catch{} return 'Оплата услуг'; })();
            const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabelOrg, amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdFull, callbackUrl: undefined, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName }, items: itemsParamOrg });
            try {
              const { readText, writeText } = await import('./storage');
              const prev = (await readText('.data/ofd_create_attempts.log')) || '';
              const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_attempt', party: 'org', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: s.invoiceIdFull, doc: 'C' }) + '\n';
              await writeText('.data/ofd_create_attempts.log', prev + line);
            } catch {}
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            try {
              const { readText, writeText } = await import('./storage');
              const prev = (await readText('.data/ofd_create_attempts.log')) || '';
              const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_result', party: 'org', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: s.invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status, doc: 'C' }) + '\n';
              await writeText('.data/ofd_create_attempts.log', prev + line);
            } catch {}
            try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
            { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
            // Try to resolve URL right away without waiting for callback
            try {
              let url: string | undefined;
              let tries = 0;
              while (!url && tries < 20 && created.id) {
                try {
                  const st = await fermaGetReceiptStatus(String(created.id), { baseUrl, authToken: ofdToken });
                  const obj = st.rawText ? JSON.parse(st.rawText) : {};
                  const fn = obj?.Data?.Fn || obj?.Fn;
                  const fd = obj?.Data?.Fd || obj?.Fd;
                  const fp = obj?.Data?.Fp || obj?.Fp;
                  const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                  if (direct && direct.length > 0) { url = direct; break; }
                  if (fn && fd != null && fp != null) { url = buildReceiptViewUrl(fn, fd, fp); break; }
                } catch {}
                tries += 1;
                await new Promise((r) => setTimeout(r, 400));
              }
              if (url) {
                try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
                { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: url }); }
              }
            } catch {}
          }
        } catch {}
      }
      continue; // C обработан сегодня → не пытаемся делать B
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
            { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: rid || null, ofdUrl: url || null }); }
            continue;
          }
        } catch {}
        // create with stored A
        if (s.isAgent) {
          const token = await getDecryptedApiToken(userId);
          if (!token) continue;
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
          const out = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
          const txt = out.text;
          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
          const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
          const partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
          if (!partnerInn) continue;
          const partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
          const itemsParamA = await (async () => {
            try {
              const snap = (s as any)?.itemsSnapshot as any[] | null;
              if (!Array.isArray(snap) || snap.length === 0) return undefined;
              const orgInnDigits = (s as any)?.orgInn ? String((s as any).orgInn).replace(/\D/g, '') : undefined;
              const products = orgInnDigits ? await listProductsForOrg(orgInnDigits) : [];
              return snap.map((it: any) => {
                const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
              });
            } catch { return undefined; }
          })();
          const itemLabelA = (() => { try { const d=(s as any)?.description&&String((s as any).description).trim(); if(d) return String(d).slice(0,128); const snap=(s as any)?.itemsSnapshot as any[]|null; if(Array.isArray(snap)&&snap.length>0){ const labels=snap.map(it=>String(it?.title||'').trim()).filter(Boolean); if(labels.length>0) return labels.join(', ').slice(0,128);} } catch{} return 'Оплата услуг'; })();
          const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabelA, amountRub: Math.max(0, s.amountGrossRub - s.retainedCommissionRub), vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdPrepay, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' }, items: itemsParamA });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
          { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
        } else {
          const orgInn = (s.orgInn && String(s.orgInn).trim().length > 0 && String(s.orgInn) !== 'неизвестно') ? String(s.orgInn).replace(/\D/g, '') : null;
          if (!orgInn) continue;
          let supplierName: string | null = null;
          try {
            const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('./orgStore');
            const org = await findOrgByInn(orgInn);
            if (org && org.name && String(org.name).trim().length > 0) supplierName = String(org.name).trim();
            if (!supplierName && userId) {
              const token = await getTokenForOrg(orgInn, userId).catch(() => null);
              if (token) {
                const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                const outAcc = await fetchTextWithTimeout(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                const txtAcc = outAcc.text;
                let dataAcc: any = null; try { dataAcc = txtAcc ? JSON.parse(txtAcc) : null; } catch { dataAcc = txtAcc; }
                const name = dataAcc?.account?.company_name || dataAcc?.company_name || null;
                if (name && typeof name === 'string' && name.trim().length > 0) {
                  supplierName = name.trim();
                  try { await updateOrganizationName(orgInn, supplierName); } catch {}
                }
              }
            }
          } catch {}
          if (!supplierName) continue;
          const itemsParamAOrg = await (async () => {
            try {
              const snap = (s as any)?.itemsSnapshot as any[] | null;
              if (!Array.isArray(snap) || snap.length === 0) return undefined;
              const products = await listProductsForOrg(orgInn);
              return snap.map((it: any) => {
                const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
              });
            } catch { return undefined; }
          })();
          const itemLabelAOrg = (() => { try { const d=(s as any)?.description&&String((s as any).description).trim(); if(d) return String(d).slice(0,128); const snap=(s as any)?.itemsSnapshot as any[]|null; if(Array.isArray(snap)&&snap.length>0){ const labels=snap.map(it=>String(it?.title||'').trim()).filter(Boolean); if(labels.length>0) return labels.join(', ').slice(0,128);} } catch{} return 'Оплата услуг'; })();
          const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabelAOrg, amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: s.clientEmail || defaultEmail, invoiceId: s.invoiceIdPrepay, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName }, items: itemsParamAOrg });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
          { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
        }
      } catch {}
    }
    // Offset (зачёт предоплаты) — создаём, если назначен invoiceIdOffset, дата сервиса наступила (по МСК), URL полного чека отсутствует
    try {
      const end = s.serviceEndDate || null;
      const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
      const mskHourStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false });
      const mskHour = Number(mskHourStr.replace(/[^0-9]/g, '') || '0');
      const isPast = !!end && end < mskToday;
      const isTodayMsk = !!end && end === mskToday;
      const due = Boolean(isPast || (isTodayMsk && mskHour >= 12));
      const hasOffset = !!(s as any).invoiceIdOffset;
      const hasFullUrl = !!s.ofdFullUrl;
      const st = String(s.status || '').toLowerCase();
      const final = st === 'paid' || st === 'transfered' || st === 'transferred';
      if (due && hasOffset && !hasFullUrl && final) {
        const host = process.env.BASE_HOST || process.env.VERCEL_URL || process.env.RENDER_EXTERNAL_URL || 'localhost:3000';
        const secret = process.env.OFD_CALLBACK_SECRET || '';
        const callbackUrl = `https://${host}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;
        if (s.isAgent) {
          // партнёр: тянем ИНН/ФИО исполнителя из RW
          // Используем тот же механизм, что и во всех API: резолв по fingerprint/inn
          let token: string | null = null;
          try {
            const { resolveRwTokenWithFingerprint } = await import('./rwToken');
            const fp = (s as any)?.rwTokenFp || undefined;
            const inn = (s as any)?.orgInn || undefined;
            const res = await resolveRwTokenWithFingerprint({ headers: new Headers() } as any, userId, inn, fp);
            token = res.token;
          } catch {}
          if (!token) token = await getDecryptedApiToken(userId);
          if (token) {
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            const out = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
            const txt = out.text;
            let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
            const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
            const partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
            if (partnerInn) {
              const orderNum = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
              const invOffset = (s as any).invoiceIdOffset || (Number.isFinite(orderNum) ? await getInvoiceIdForOffset(orderNum) : null);
              if (!invOffset) { /* cannot proceed without InvoiceId B */ }
              const partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
              // debug log
              try {
                const { readText, writeText } = await import('./storage');
                const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_attempt', party: 'partner', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: invOffset, callbackUrl }) + '\n';
                await writeText('.data/ofd_create_attempts.log', prev + line);
              } catch {}
              const itemsParamB = await (async () => {
                try {
                  const snap = (s as any)?.itemsSnapshot as any[] | null;
                  if (!Array.isArray(snap) || snap.length === 0) return undefined;
                  const orgInnDigits = (s as any)?.orgInn ? String((s as any).orgInn).replace(/\D/g, '') : undefined;
                  const products = orgInnDigits ? await listProductsForOrg(orgInnDigits) : [];
                  return snap.map((it: any) => {
                    const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                    return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                  });
                } catch { return undefined; }
              })();
              const payload = buildFermaReceiptPayload({
                party: 'partner',
                partyInn: partnerInn,
                description: 'Оплата услуг',
                amountRub: Math.max(0, (s.amountGrossRub || 0) - ((s as any).retainedCommissionRub || 0)),
                vatRate: (s.vatRate as any) || 'none',
                methodCode: PAYMENT_METHOD_FULL_PAYMENT,
                orderId: s.orderId,
                docType: 'Income',
                buyerEmail: s.clientEmail || defaultEmail,
                invoiceId: invOffset || undefined,
                callbackUrl,
                withAdvanceOffset: true,
                paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' },
                items: itemsParamB,
              });
              const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
              try {
                const { readText, writeText } = await import('./storage');
                const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_result', party: 'partner', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: invOffset, id: created.id, rawStatus: created.rawStatus, statusText: created.status }) + '\n';
                await writeText('.data/ofd_create_attempts.log', prev + line);
              } catch {}
              try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
              { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
              // try resolve URL immediately
              try {
                let url: string | undefined; let tries = 0;
                while (!url && tries < 20 && created.id) {
                  try {
                    const stR = await fermaGetReceiptStatus(String(created.id), { baseUrl, authToken: ofdToken });
                    const obj = stR.rawText ? JSON.parse(stR.rawText) : {};
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                    if (direct && direct.length > 0) { url = direct; break; }
                    if (fn && fd != null && fp != null) { url = buildReceiptViewUrl(fn, fd, fp); break; }
                  } catch {}
                  tries += 1; await new Promise((r2) => setTimeout(r2, 500));
                }
                if (url) { try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {} const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: url }); }
              } catch {}
            }
          }
        } else {
          // организация: нужно валидное название
          const orgInn = (s.orgInn && String(s.orgInn).trim().length > 0 && String(s.orgInn) !== 'неизвестно') ? String(s.orgInn).replace(/\D/g, '') : null;
          if (orgInn) {
            let supplierName: string | null = null;
            try {
              const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('./orgStore');
              const org = await findOrgByInn(orgInn);
              if (org && org.name && String(org.name).trim().length > 0) supplierName = String(org.name).trim();
              if (!supplierName) {
                // пробуем привязанный к пользователю токен RW
                let token: string | null = null;
                try {
                  const { resolveRwTokenWithFingerprint } = await import('./rwToken');
                  const fp = (s as any)?.rwTokenFp || undefined;
                  const res = await resolveRwTokenWithFingerprint({ headers: new Headers() } as any, userId, orgInn, fp);
                  token = res.token;
                } catch {}
                if (!token) token = await getTokenForOrg(orgInn, userId).catch(() => null);
                if (token) {
                  const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                  const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                  const outAcc = await fetchTextWithTimeout(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                  const txt = outAcc.text;
                  let dAcc: any = null; try { dAcc = txt ? JSON.parse(txt) : null; } catch { dAcc = txt; }
                  const nm = dAcc?.account?.company_name || dAcc?.company_name || null;
                  if (nm && typeof nm === 'string' && nm.trim().length > 0) { supplierName = nm.trim(); try { await updateOrganizationName(orgInn, supplierName); } catch {} }
                }
              }
            } catch {}
            if (supplierName) {
              const orderNum = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
              const invOffset = (s as any).invoiceIdOffset || (Number.isFinite(orderNum) ? await getInvoiceIdForOffset(orderNum) : null);
              try {
                const { readText, writeText } = await import('./storage');
                const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_attempt', party: 'org', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: invOffset, callbackUrl, orgInn }) + '\n';
                await writeText('.data/ofd_create_attempts.log', prev + line);
              } catch {}
              const itemsParamBOrg = await (async () => {
                try {
                  const snap = (s as any)?.itemsSnapshot as any[] | null;
                  if (!Array.isArray(snap) || snap.length === 0) return undefined;
                  const products = await listProductsForOrg(orgInn);
                  return snap.map((it: any) => {
                    const prod = products.find((p) => (p.id && it?.id && String(p.id) === String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase() === String(it.title).toLowerCase())) || null;
                    return { label: String(it.title || ''), price: Number(it.price || 0), qty: Number(it.qty || 1), vatRate: (prod?.vat as any) || ((s as any)?.vatRate as any), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                  });
                } catch { return undefined; }
              })();
              const payload = buildFermaReceiptPayload({
                party: 'org',
                partyInn: orgInn,
                description: 'Оплата услуг',
                amountRub: s.amountGrossRub,
                vatRate: (s.vatRate as any) || 'none',
                methodCode: PAYMENT_METHOD_FULL_PAYMENT,
                orderId: s.orderId,
                docType: 'Income',
                buyerEmail: s.clientEmail || defaultEmail,
                invoiceId: invOffset || undefined,
                callbackUrl,
                withAdvanceOffset: true,
                paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName },
                items: itemsParamBOrg,
              });
              const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
              try {
                const { readText, writeText } = await import('./storage');
                const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), src: 'repair_worker', stage: 'create_result', party: 'org', userId, taskId: s.taskId, orderId: s.orderId, invoiceId: invOffset, id: created.id, rawStatus: created.rawStatus, statusText: created.status }) + '\n';
                await writeText('.data/ofd_create_attempts.log', prev + line);
              } catch {}
              try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {}
              { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
              try {
                let url: string | undefined; let tries = 0;
                while (!url && tries < 20 && created.id) {
                  try {
                    const stR = await fermaGetReceiptStatus(String(created.id), { baseUrl, authToken: ofdToken });
                    const obj = stR.rawText ? JSON.parse(stR.rawText) : {};
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                    if (direct && direct.length > 0) { url = direct; break; }
                    if (fn && fd != null && fp != null) { url = buildReceiptViewUrl(fn, fd, fp); break; }
                  } catch {}
                  tries += 1; await new Promise((r2) => setTimeout(r2, 500));
                }
                if (url) { try { (global as any).__OFD_SOURCE__ = 'repair_worker'; } catch {} const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: url }); }
              } catch {}
            }
          }
        }
      }
    } catch {}
    // Background pay trigger (same conditions as в API и postback): агент, transfered, completed, есть полный чек и чек комиссии
    try {
      const aoStatus = String(s.status || '').toLowerCase();
      const hasFull = Boolean(s.ofdFullUrl);
      const hasCommission = Boolean((s as any)?.additionalCommissionOfdUrl);
      if (s.isAgent && hasFull && hasCommission && aoStatus === 'transfered') {
        // Резолвим токен: сначала по организации, затем общий
        let token: string | null = null;
        try {
          const innDigits = (s as any)?.orgInn ? String((s as any).orgInn).replace(/\D/g, '') : '';
          if (innDigits) {
            const { getTokenForOrg } = await import('./orgStore');
            token = await getTokenForOrg(innDigits, userId);
          }
        } catch {}
        if (!token) {
          try { token = await getDecryptedApiToken(userId); } catch { token = null; }
        }
        if (token) {
        const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, rwBase.endsWith('/') ? rwBase : rwBase + '/').toString();
          let rootStatus = '';
          try {
            const out = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
        const txt = out.text;
        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
        const taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
            rootStatus = String(taskObj?.status || '').toLowerCase();
          } catch {}
        if (rootStatus === 'completed') {
          const payUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}/pay`, rwBase.endsWith('/') ? rwBase : rwBase + '/').toString();
          try {
            if (process.env.OFD_AUDIT === '1') {
                const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                await appendOfdAudit({ ts: new Date().toISOString(), source: 'repair_worker', userId, orderId: numOrder, taskId: s.taskId, action: 'background_pay', patch: { reason: 'agent_transfered_completed_has_full_and_commission', payUrl } });
              }
            } catch {}
            try {
              const outPay = await fetchTextWithTimeout(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
              const txt = outPay.text;
              if (!outPay.res.ok) {
                try { await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: outPay.res.status, responseText: txt, userId }); } catch {}
              }
            } catch (e) {
              try { await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: null, error: e instanceof Error ? e.message : String(e), userId }); } catch {}
            }
            // Короткий опрос статуса, чтобы обновить локальную продажу
          let triesNpd = 0;
          while (triesNpd < 5) {
            await new Promise((r) => setTimeout(r, 1200));
              const out2 = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
            const t2 = out2.text;
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
              try { await updateSaleFromStatus(userId, s.taskId, { status: aoSt, ofdUrl: ofd, additionalCommissionOfdUrl: add, npdReceiptUri: npd, rootStatus: String(norm?.status || '').toLowerCase() } as any); } catch {}
              // НПД для ИП не ждём
              break;
            }
          }
        }
      }
    } catch {}
  }
}


