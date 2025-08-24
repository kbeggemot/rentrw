import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { promises as fs } from 'fs';
import path from 'path';
import { updateSaleFromStatus, findSaleByTaskId, updateSaleOfdUrlsByOrderId, setSaleCreatedAtRw } from '@/server/taskStore';
import { ensureSaleFromTask } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from '@/server/ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from '@/server/userStore';
import { enqueueOffsetJob, startOfdScheduleWorker } from '@/server/ofdScheduleWorker';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(_: Request) {
  try {
    const cookie = _.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || _.headers.get('x-user-id') || 'default';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    // поддерживаем специальный id last из локального стора для дебага
    const urlObj = new URL(_.url);
    const segs = urlObj.pathname.split('/');
    let taskId = decodeURIComponent(segs[segs.length - 1] || '');
    if (taskId === 'last') {
      try {
        const raw = await fs.readFile(path.join(process.cwd(), '.data', 'tasks.json'), 'utf8');
        const parsed = JSON.parse(raw) as { tasks?: { id: string | number }[] };
        const last = parsed.tasks && parsed.tasks.length > 0 ? parsed.tasks[parsed.tasks.length - 1].id : null;
        if (last != null) taskId = String(last);
      } catch {}
    }
    const url = new URL(`tasks/${encodeURIComponent(taskId)}`, base.endsWith('/') ? base : base + '/').toString();

    let res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      // disable any framework caches
      cache: 'no-store',
    });

    let text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // лог статуса для отладки
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, 'last_task_status.json'), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
    } catch {}

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const message = (maybeObj?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: message }, { status: res.status });
    }

    let maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    let normalized: RocketworkTask = (maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask);

    // Ensure a local sale record exists for this task (creates if missing)
    try { await ensureSaleFromTask({ userId, taskId, task: normalized as any }); } catch {}

    // Attempt short polling for receipts if already paid/transferred and receipts missing
    let tries = 0;
    const hasAnyReceipt = (obj: RocketworkTask): boolean => {
      const purchase = (obj?.ofd_url || obj?.acquiring_order?.ofd_url) ?? undefined;
      const addComm = obj?.additional_commission_ofd_url ?? undefined;
      if (obj?.additional_commission_value) {
        return Boolean(purchase) && Boolean(addComm);
      }
      return Boolean(purchase);
    };
    while (['paid', 'transferred', 'transfered'].includes(String(normalized?.acquiring_order?.status || '').toLowerCase()) && tries < 5 && !hasAnyReceipt(normalized)) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
      tries += 1;
    }

    // If agent sale got transferred and root status is only completed, trigger pay
    try {
      const aoStatus = String(normalized?.acquiring_order?.status || '').toLowerCase();
      const rootStatus = String(normalized?.status || '').toLowerCase();
      const hasAgent = Boolean(normalized?.additional_commission_value);
      // New gate: require full-settlement receipt link present in our store
      let saleHasFull = false;
      try { const s = await findSaleByTaskId(userId, taskId); saleHasFull = Boolean(s?.ofdFullUrl); } catch {}
      if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed' && saleHasFull) {
        const payUrl = new URL(`tasks/${encodeURIComponent(taskId)}/pay`, base.endsWith('/') ? base : base + '/').toString();
        await fetch(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        // After pay, poll specifically until NPD receipt appears
        let triesNpd = 0;
        while (!normalized?.receipt_uri && triesNpd < 5) {
          await new Promise((r) => setTimeout(r, 1200));
          res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          text = await res.text();
          try { data = text ? JSON.parse(text) : null; } catch { data = text; }
          maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
          normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
          triesNpd += 1;
        }
      }
    } catch {}

    // Persist into sales store; if deferred flow, prefer ofdFullUrl presence for UI
    try {
      const ofdUrl = (normalized?.ofd_url as string | undefined)
        ?? (normalized?.ofd_receipt_url as string | undefined)
        ?? (normalized?.acquiring_order?.ofd_url as string | undefined)
        ?? (normalized?.acquiring_order?.ofd_receipt_url as string | undefined)
        ?? null;
      const addOfd = (normalized?.additional_commission_ofd_url as string | undefined)
        ?? null;
      const npdReceipt = (normalized?.receipt_uri as string | undefined) ?? null;
      await updateSaleFromStatus(userId, taskId, { status: normalized?.acquiring_order?.status, ofdUrl, additionalCommissionOfdUrl: addOfd, npdReceiptUri: npdReceipt, rootStatus: (normalized as any)?.status } as any);
      try {
        const createdAtRw: string | undefined = (normalized as any)?.created_at || undefined;
        if (createdAtRw) await setSaleCreatedAtRw(userId, taskId, createdAtRw);
      } catch {}
      // If no RW ofd_url (because we turned it off) and we already have prepayment/full URLs from OFD callback store,
      // the client will still display '-' here; that's expected until callback arrives.
    } catch {}

    // Fallback path: if acquiring_order.status is final and sale has no receipt yet, create OFD receipt(s) ourselves
    try {
      const aoFin = String(normalized?.acquiring_order?.status || '').toLowerCase();
      if (aoFin === 'paid' || aoFin === 'transfered' || aoFin === 'transferred') {
        const sale = await findSaleByTaskId(userId, taskId);
        if (sale && sale.source !== 'external') {
          const createdAt = (normalized as any)?.created_at || sale.createdAtRw || sale.createdAt;
          const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
          const endDate = sale.serviceEndDate || null;
          const isToday = Boolean(createdDate && endDate && createdDate === endDate);
          const amountRub = Number(sale.amountGrossRub || 0);
          const retainedRub = Number(sale.retainedCommissionRub || 0);
          const amountNetRub = sale.isAgent ? Math.max(0, amountRub - retainedRub) : amountRub;
          const usedVat = (sale.vatRate || 'none') as any;
          const itemLabel = (sale.description && sale.description.trim().length > 0) ? sale.description.trim() : 'Оплата услуги';
          const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
          const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
          // Build callback URL from current request headers to avoid relying on env host
          const rawProto = _.headers.get('x-forwarded-proto') || 'http';
          const hostHdr = _.headers.get('x-forwarded-host') || _.headers.get('host') || 'localhost:3000';
          const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(hostHdr);
          const protoHdr = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
          const secret = process.env.OFD_CALLBACK_SECRET || '';
          const callbackUrl = `${protoHdr}://${hostHdr}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;

          const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
          if (isToday) {
            // Need full settlement receipt if not already present
            if (!sale.ofdFullUrl && !sale.ofdFullId) {
              if (sale.isAgent) {
                const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                if (partnerInn) {
                  const { getInvoiceIdForFull } = await import('@/server/orderStore');
                  const invoiceIdFull = await getInvoiceIdForFull(sale.orderId);
                  const partnerName = ((normalized as any)?.executor && [
                    (normalized as any)?.executor?.last_name,
                    (normalized as any)?.executor?.first_name,
                    (normalized as any)?.executor?.second_name,
                  ].filter(Boolean).join(' ').trim()) || undefined;
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  await updateSaleOfdUrlsByOrderId(userId, sale.orderId, { ofdFullId: created.id || null });
                }
              } else {
                const orgInn = await getUserOrgInn(userId);
                const orgData = await getUserPayoutRequisites(userId);
                if (orgInn) {
                  const { getInvoiceIdForFull } = await import('@/server/orderStore');
                  const invoiceIdFull = await getInvoiceIdForFull(sale.orderId);
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  await updateSaleOfdUrlsByOrderId(userId, sale.orderId, { ofdFullId: created.id || null });
                }
              }
            }
          } else {
            // Prepayment receipt if not present, and schedule offset
            if (!sale.ofdUrl && !sale.ofdPrepayId) {
              if (sale.isAgent) {
                const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                if (partnerInn) {
                  const { getInvoiceIdForPrepay } = await import('@/server/orderStore');
                  const invoiceIdFull = await getInvoiceIdForPrepay(sale.orderId);
                  const partnerName2 = ((normalized as any)?.executor && [
                    (normalized as any)?.executor?.last_name,
                    (normalized as any)?.executor?.first_name,
                    (normalized as any)?.executor?.second_name,
                  ].filter(Boolean).join(' ').trim()) || undefined;
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName2 || 'Исполнитель' } });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  await updateSaleOfdUrlsByOrderId(userId, sale.orderId, { ofdPrepayId: created.id || null });
                }
              } else {
                const orgInn = await getUserOrgInn(userId);
                const orgData = await getUserPayoutRequisites(userId);
                if (orgInn) {
                  const { getInvoiceIdForPrepay } = await import('@/server/orderStore');
                  const invoiceIdFull = await getInvoiceIdForPrepay(sale.orderId);
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  await updateSaleOfdUrlsByOrderId(userId, sale.orderId, { ofdPrepayId: created.id || null });
                }
              }
            }
            if (sale.serviceEndDate) {
              startOfdScheduleWorker();
              const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
              let partnerInn: string | undefined;
              if (sale.isAgent) {
                partnerInn = (normalized as any)?.executor?.inn as string | undefined;
              }
              const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
              await enqueueOffsetJob({ userId, orderId: sale.orderId, dueAt: dueDate.toISOString(), party: sale.isAgent ? 'partner' : 'org', partnerInn, description: 'Оплата услуги', amountRub: sale.isAgent ? amountNetRub : amountRub, vatRate: usedVat, buyerEmail: bEmail });
            }
          }
        }
      }
    } catch {}

    // Также проставим заголовок, чтобы клиент не кешировал
    // Augment response with UI hint which column to watch
    try {
      const sale = await findSaleByTaskId(userId, taskId);
      const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
      const isToday = sale?.serviceEndDate === mskToday;
      const hint = { ofdTarget: isToday ? 'full' : 'prepay', orderId: sale?.orderId } as Record<string, unknown>;
      return new NextResponse(JSON.stringify({ ...(normalized as any), __hint: hint }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } });
    } catch {
      return new NextResponse(JSON.stringify(normalized), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


