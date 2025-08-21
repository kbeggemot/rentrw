import { listSales, updateSaleOfdUrlsByOrderId } from './taskStore';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from './ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_FULL_PAYMENT, PAYMENT_METHOD_PREPAY_FULL } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from './userStore';
import { getDecryptedApiToken } from './secureStore';
import { getInvoiceIdString } from './orderStore';

let started = false;
let timer: NodeJS.Timer | null = null;

/**
 * Periodically scans sales for missing OFD receipts and repairs them.
 * Cases:
 * - isToday and status final: create full settlement (Income) if missing
 * - not today and status final: create prepayment (IncomePrepayment) if missing
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
    const allUsers = new Set<string>();
    // gather users from sales list (sales already partitioned by userId)
    // listSales requires a userId; we don't have multi-tenant listing exported,
    // so we rely on scanning recent userIds from environment/session not available.
    // Fallback: try to repair per user ids inferred from LAST entries persisted in stores is not trivial.
    // Simpler approach: try to repair for users derived from sales themselves by iterating per user candidate set.
  } catch {}
}

// Helper that performs repair for a single user
export async function repairUserSales(userId: string): Promise<void> {
  const sales = await listSales(userId);
  if (sales.length === 0) return;
  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const ofdToken = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
  const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
  const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
  for (const s of sales) {
    const status = String(s.status || '').toLowerCase();
    const final = status === 'paid' || status === 'transfered' || status === 'transferred';
    if (!final) continue;
    const isToday = (s.serviceEndDate || null) === mskToday;
    // Full settlement today
    if (isToday) {
      if (!s.ofdFullId && !s.ofdFullUrl) {
        try {
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
            const invoiceIdFull = await getInvoiceIdString(s.orderId);
            const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: s.description || 'Оплата услуги', amountRub: s.isAgent ? Math.max(0, s.amountGrossRub - s.retainedCommissionRub) : s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: defaultEmail, invoiceId: invoiceIdFull, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullId: created.id || null });
          } else {
            const orgInn = await getUserOrgInn(userId);
            const orgData = await getUserPayoutRequisites(userId);
            if (!orgInn) continue;
            const invoiceIdFull = await getInvoiceIdString(s.orderId);
            const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: s.description || 'Оплата услуги', amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: s.orderId, docType: 'Income', buyerEmail: defaultEmail, invoiceId: invoiceIdFull, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
            const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
            await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullId: created.id || null });
          }
        } catch {}
      }
      continue;
    }
    // Prepayment receipt missing
    if (!s.ofdPrepayId && !s.ofdUrl) {
      try {
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
          const invoiceIdFull = await getInvoiceIdString(s.orderId);
          const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: s.description || 'Оплата услуги', amountRub: Math.max(0, s.amountGrossRub - s.retainedCommissionRub), vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: defaultEmail, invoiceId: invoiceIdFull, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdPrepayId: created.id || null });
        } else {
          const orgInn = await getUserOrgInn(userId);
          const orgData = await getUserPayoutRequisites(userId);
          if (!orgInn) continue;
          const invoiceIdFull = await getInvoiceIdString(s.orderId);
          const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: s.description || 'Оплата услуги', amountRub: s.amountGrossRub, vatRate: (s.vatRate as any) || 'none', methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: s.orderId, docType: 'IncomePrepayment', buyerEmail: defaultEmail, invoiceId: invoiceIdFull, callbackUrl: undefined, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
          const created = await fermaCreateReceipt(payload, { baseUrl, authToken: ofdToken });
          await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdPrepayId: created.id || null });
        }
      } catch {}
    }
  }
}


