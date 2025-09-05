import { NextResponse } from 'next/server';
import { listPartners, upsertPartner } from '@/server/partnerStore';
import { updateSaleFromStatus, findSaleByTaskId, updateSaleOfdUrlsByOrderId, updateSaleOfdUrls } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { updateWithdrawal } from '@/server/withdrawalStore';
import { getDecryptedApiToken } from '@/server/secureStore';
import { fermaGetAuthTokenCached, fermaCreateReceipt, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { getInvoiceIdForFull, getInvoiceIdForPrepay } from '@/server/orderStore';
import { getUserOrgInn, getUserPayoutRequisites } from '@/server/userStore';
import { enqueueOffsetJob, startOfdScheduleWorker } from '@/server/ofdScheduleWorker';
import { appendOfdAudit } from '@/server/audit';
import { readText, writeText } from '@/server/storage';
import { listProductsForOrg } from '@/server/productsStore';
// duplicated import removed

export const runtime = 'nodejs';

// Helper: safe getter
function pick<T = unknown>(obj: any, path: string, fallback?: T): T | undefined {
  try {
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return (cur === undefined ? fallback : cur) as T | undefined;
  } catch {
    return fallback;
  }
}

function buildFio(rec: any): string | null {
  const last = String(rec?.last_name || '').trim();
  const first = String(rec?.first_name || '').trim();
  const second = String(rec?.second_name || '').trim();
  const fio = [last, first, second].filter(Boolean).join(' ').trim();
  return fio.length > 0 ? fio : null;
}

export async function POST(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const segs = urlObj.pathname.split('/');
    const userId = decodeURIComponent(segs[segs.length - 1] || '');
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 400 });

    const raw = await req.text();
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

    // Debug: append incoming postback to file (S3‑compatible)
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), userId, body }, null, 2) + '\n';
      const prev = (await readText('.data/postbacks.log')) || '';
      await writeText('.data/postbacks.log', prev + line);
    } catch {}

    const event: string = String(body?.event || '').toLowerCase();
    const data: any = body?.data ?? body;
    // Derive subscription stream robustly: RW often omits 'subscription'
    let subscription: string = String(body?.subscription || '').toLowerCase();
    if (!subscription) {
      const hasAo = data && typeof data === 'object' && (('acquiring_order' in data) || ('task' in data));
      if (/^task\./.test(event) || hasAo) subscription = 'tasks';
      else if (/^executor\./.test(event)) subscription = 'executors';
      else subscription = 'tasks';
    }

    if (subscription === 'tasks') {
      // Attempt to extract task id and details
      const taskId = pick<number | string>(data, 'task_id')
        ?? pick<number | string>(data, 'id')
        ?? pick<number | string>(data, 'task.id');

      if (typeof taskId === 'undefined') return NextResponse.json({ ok: true });

      // Normalize status by event name when obvious
      let status: string | undefined;
      if (/task\.paid/.test(event)) status = 'paid';
      else if (/task\.paying/.test(event)) status = 'paying';
      else if (/task\.transfered?/.test(event)) status = 'transfered';
      else if (/task\.pending/.test(event)) status = 'pending';

      // Extract known URLs from payload when present (try multiple shapes)
      const ofdUrl = pick<string>(data, 'ofd_url')
        ?? pick<string>(data, 'ofd_receipt_url');
      const additionalCommissionOfdUrl = pick<string>(data, 'additional_commission_ofd_url');
      const npdReceiptUri = pick<string>(data, 'receipt_uri');

      // Fallback statuses from payload when event name is generic
      const kindRaw = String(pick<string>(data, 'type') || pick<string>(data, 'task.type') || '').toLowerCase();
      const aoStatusRaw = kindRaw === 'withdrawal'
        ? undefined
        : (pick<string>(data, 'acquiring_order.status') || pick<string>(data, 'task.acquiring_order.status'));
      const rootStatusRaw = pick<string>(data, 'status')
        ?? pick<string>(data, 'task.status');

      await updateSaleFromStatus(userId, taskId, {
        status: status || aoStatusRaw,
        ofdUrl: ofdUrl || undefined,
        additionalCommissionOfdUrl: additionalCommissionOfdUrl || undefined,
        npdReceiptUri: npdReceiptUri || undefined,
        // pass root status through duck-typed property so taskStore can persist it
        rootStatus: rootStatusRaw,
      } as any);
      try {
        const { findSaleByTaskId } = await import('@/server/taskStore');
        const sale = await findSaleByTaskId(userId, taskId);
        const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'event', userId, taskId, event, status, aoStatusRaw, rootStatusRaw, sale: sale ? { orderId: sale.orderId, orgInn: sale.orgInn, ofdUrl: sale.ofdUrl, ofdFullUrl: sale.ofdFullUrl, invoiceA: (sale as any).invoiceIdPrepay, invoiceC: (sale as any).invoiceIdFull } : null });
        const prev = (await readText('.data/ofd_create_attempts.log')) || '';
        await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
      } catch {}
      try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'postback', data: { event, status: status || null, rootStatusRaw: rootStatusRaw || null } }); } catch {}
      // Background pay trigger with unchanged conditions (agent, transfered, completed, has full receipt)
      try {
        const sale = await findSaleByTaskId(userId, taskId);
        const aoStatus = String(aoStatusRaw || status || '').toLowerCase();
        const rootStatus = String(rootStatusRaw || '').toLowerCase();
        if (sale && sale.isAgent && sale.ofdFullUrl && aoStatus === 'transfered' && rootStatus === 'completed') {
          const token = await getDecryptedApiToken(userId);
          if (token) {
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const payUrl = new URL(`tasks/${encodeURIComponent(String(taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
            try {
              if (process.env.OFD_AUDIT === '1') {
                const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                await appendOfdAudit({ ts: new Date().toISOString(), source: 'postback', userId, orderId: numOrder, taskId, action: 'background_pay', patch: { reason: 'agent_transfered_completed_has_full', payUrl } });
              }
            } catch {}
            await fetch(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          }
        }
      } catch {}
      // If paid/transfered — write a local marker so UI can hide QR instantly
      try {
        const fin = String((status || aoStatusRaw || '') as string).toLowerCase();
        if (fin === 'paid' || fin === 'transfered' || fin === 'transferred') {
          await writeText(`.data/task_paid_${userId}_${String(taskId)}.json`, JSON.stringify({ userId, taskId, status: fin, ts: new Date().toISOString() }));
        }
      } catch {}
      // If this is a Withdrawal and it became paid, write a marker file for UI
      try {
        const kind = String(pick<string>(data, 'type') || pick<string>(data, 'task.type') || '').toLowerCase();
        const aoStatus = String(aoStatusRaw || '').toLowerCase();
        const rootStatus = String(rootStatusRaw || '').toLowerCase();
        if (kind === 'withdrawal') {
          // Persist store for history — только корневой статус задачи
          try { await updateWithdrawal(userId, taskId, { status: (rootStatusRaw || status || null) }); } catch {}
        }
        if (kind === 'withdrawal' && (status === 'paid' || rootStatus === 'paid')) {
          await writeText(`.data/withdrawal_${userId}_${String(taskId)}.json`, JSON.stringify({ userId, taskId, paidAt: new Date().toISOString() }));
          try { await updateWithdrawal(userId, taskId, { status: 'paid', paidAt: new Date().toISOString() }); } catch {}
        }
      } catch {}

      // Create OFD receipts ourselves based on acquiring_order.status — сразу по событию paid/transfered
      try {
        const fin = String(((status || aoStatusRaw || '') as string)).toLowerCase();
        if (fin === 'paid' || fin === 'transfered' || fin === 'transferred') {
          const sale = await findSaleByTaskId(userId, taskId);
          if (sale) {
            const createdAt = (sale as any).createdAtRw || (sale as any).createdAt;
            const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
            const endDate = sale.serviceEndDate || null;
            const isToday = Boolean(createdDate && endDate && createdDate === endDate);
            const amountRub = Number(sale.amountGrossRub || 0);
            const usedVat = (sale.vatRate || 'none') as any;
            const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
            let tokenOfd: string;
            try {
              tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
            } catch (e) {
              try {
                const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'auth_error', userId, taskId, orderId: sale.orderId, error: e instanceof Error ? e.message : String(e) });
                await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
              } catch {}
              return NextResponse.json({ ok: true });
            }
            // Build callback URL from current request headers
            const rawProto = req.headers.get('x-forwarded-proto') || 'http';
            const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
            const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(hostHdr);
            const protoHdr = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
            const secret = process.env.OFD_CALLBACK_SECRET || '';
            const callbackUrl = `${protoHdr}://${hostHdr}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;

            // Helper: resolve receipt URL by id with short polling
            const tryResolveUrl = async (id: string | undefined | null): Promise<string | undefined> => {
              if (!id) return undefined;
              try {
                let url: string | undefined;
                let tries = 0;
                while (!url && tries < 20) {
                  try {
                    const st = await fermaGetReceiptStatus(String(id), { baseUrl, authToken: tokenOfd });
                    const obj = st.rawText ? JSON.parse(st.rawText) : {};
                    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    if (typeof direct === 'string' && direct.length > 0) { url = direct; break; }
                    if (fn && fd != null && fp != null) { url = buildReceiptViewUrl(fn, fd, fp); break; }
                  } catch {}
                  tries += 1;
                  await new Promise((r) => setTimeout(r, 400));
                }
                return url;
              } catch { return undefined; }
            };

            if (sale.isAgent) {
              // Try to resolve partner INN through RW task
              try {
                const token = await getDecryptedApiToken(userId);
                const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                const tUrl = new URL(`tasks/${encodeURIComponent(String(taskId))}`, base.endsWith('/') ? base : base + '/').toString();
                const r = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
                const txt = await r.text();
                let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                const taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
                const partnerInn: string | undefined = (taskObj?.executor?.inn as string | undefined);
                if (partnerInn) {
                  const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
                  const amountNet = Math.max(0, Number(sale.amountGrossRub || 0) - Number(sale.retainedCommissionRub || 0));
                  if (isToday) {
                    let invoiceIdFull = (sale as any).invoiceIdFull || null;
                    if (!invoiceIdFull) {
                      try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdFull = await getInvoiceIdForFull(num); } catch {}
                    }
                    if (invoiceIdFull) {
                      const partnerName = (taskObj?.executor && [taskObj?.executor?.last_name, taskObj?.executor?.first_name, taskObj?.executor?.second_name].filter(Boolean).join(' ').trim()) || undefined;
                      try {
                        const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, callbackUrl });
                        await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                      } catch {}
                      const itemsParam = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const products = inn ? await listProductsForOrg(inn) : []; return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                      const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: 'Оплата услуг', amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' }, items: itemsParam });
                      const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                      try {
                        const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                        await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                      } catch {}
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                      // try resolve URL immediately without waiting for callback
                      try {
                        const built = await tryResolveUrl(created.id || null);
                        if (built) {
                          const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: built });
                        }
                      } catch {}
                    }
                  } else {
                    let invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                    if (!invoiceIdPrepay) {
                      try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdPrepay = await getInvoiceIdForPrepay(num); } catch {}
                    }
                    if (invoiceIdPrepay) {
                      const partnerName2 = (taskObj?.executor && [taskObj?.executor?.last_name, taskObj?.executor?.first_name, taskObj?.executor?.second_name].filter(Boolean).join(' ').trim()) || undefined;
                      try {
                        const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, callbackUrl });
                        await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                      } catch {}
                      const itemsParamA = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const products = inn ? await listProductsForOrg(inn) : []; return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                      const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: 'Оплата услуг', amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName2 || 'Исполнитель' }, items: itemsParamA });
                      const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                      try {
                        const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                        await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                      } catch {}
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                      try {
                        const built = await tryResolveUrl(created.id || null);
                        if (built) {
                          const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdUrl: built });
                        }
                      } catch {}
                      // schedule offset at 12:00 MSK
                      if (sale.serviceEndDate) {
                        startOfdScheduleWorker();
                        // 12:00 MSK -> convert to UTC: MSK=UTC+3, so 09:00Z
                        const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
                        { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: 'partner', partnerInn, description: 'Оплата услуги', amountRub: amountNet, vatRate: usedVat, buyerEmail: sale.clientEmail || defaultEmail }); }
                      }
                    }
                  }
                }
              } catch {}
            } else {
              const orgInn = (sale?.orgInn && String(sale.orgInn).trim().length > 0 && String(sale.orgInn) !== 'неизвестно') ? String(sale.orgInn).replace(/\D/g, '') : null;
              const { getOrgPayoutRequisites } = await import('@/server/orgStore');
              const orgData = orgInn ? await getOrgPayoutRequisites(orgInn) : { bik: null, account: null } as any;
              if (orgInn) {
                const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
                if (isToday) {
                  let invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (!invoiceIdFull) {
                    try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdFull = await getInvoiceIdForFull(num); } catch {}
                  }
                  if (invoiceIdFull) {
                    try {
                      const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, callbackUrl, orgInn });
                      await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                    } catch {}
                    let supplierName: string | undefined;
                    try {
                      const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                      const rec = await findOrgByInn(orgInn);
                      supplierName = (rec?.name && rec.name.trim().length > 0) ? rec.name.trim() : undefined;
                      if (!supplierName) {
                        const tok = await getTokenForOrg(orgInn, userId);
                        if (tok) {
                          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                          const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                          const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' });
                          const txt = await r.text();
                          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                          const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                          if (nm) { supplierName = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                        }
                      }
                    } catch {}
                    const itemsParamOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const products = await listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                    const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: 'Оплата услуг', amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName }, items: itemsParamOrg });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    try {
                      const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                      await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                    } catch {}
                    { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                    try {
                      const built = await tryResolveUrl(created.id || null);
                      if (built) {
                        const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                        await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: built });
                      }
                    } catch {}
                  }
                } else {
                  let invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                  if (!invoiceIdPrepay) {
                    try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdPrepay = await getInvoiceIdForPrepay(num); } catch {}
                  }
                  if (invoiceIdPrepay) {
                    try {
                      const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, callbackUrl, orgInn });
                      await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                    } catch {}
                    let supplierName2: string | undefined;
                    try {
                      const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                      const rec2 = await findOrgByInn(orgInn);
                      supplierName2 = (rec2?.name && rec2.name.trim().length > 0) ? rec2.name.trim() : undefined;
                      if (!supplierName2) {
                        const tok2 = await getTokenForOrg(orgInn, userId);
                        if (tok2) {
                          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                          const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                          const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${tok2}`, Accept: 'application/json' }, cache: 'no-store' });
                          const txt = await r.text();
                          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                          const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                          if (nm) { supplierName2 = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                        }
                      }
                    } catch {}
                    const itemsParamAOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const products = await listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                    const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: 'Оплата услуг', amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName2 }, items: itemsParamAOrg });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    try {
                      const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                      await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                    } catch {}
                    { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                    try {
                      const built = await tryResolveUrl(created.id || null);
                      if (built) {
                        const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                        await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdUrl: built });
                      }
                    } catch {}
                    if (sale.serviceEndDate) {
                      startOfdScheduleWorker();
                      const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: 'org', description: 'Оплата услуги', amountRub, vatRate: usedVat, buyerEmail: sale.clientEmail || defaultEmail }); }
                    }
                  }
                }
              }
            }
          }
        }
      } catch {}
      return NextResponse.json({ ok: true });
    }

    if (subscription === 'executors') {
      // Update partner info based on executor payload
      const executor = data?.executor ?? data;
      const phone: string | undefined = String(executor?.phone || executor?.id || '').trim();
      if (!phone) return NextResponse.json({ ok: true });
      const status: string | null = (executor?.selfemployed_status ?? null) as string | null;
      const fio = buildFio(executor);
      const inn: string | null = (executor?.inn as string | undefined) ?? null;

      // Merge with existing data, ignoring nulls
      const current = (await listPartners(userId)).find((p) => p.phone === phone) ?? {
        phone,
        fio: null,
        status: null,
        inn: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = {
        phone,
        fio: fio ?? current.fio,
        status: status ?? current.status,
        inn: inn ?? current.inn,
        createdAt: current.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await upsertPartner(userId, next);

      // Дополнительный триггер: если у агента INN появился позже, попробуем создать чеки по уже оплаченным продажам
      try {
        const phoneDigits = String(phone || '').replace(/\D/g, '');
        const innNow = typeof inn === 'string' && inn.trim().length > 0 ? inn.trim() : null;
        if (innNow) {
          const { listSales, updateSaleOfdUrlsByOrderId } = await import('@/server/taskStore');
          const sales = await listSales(userId);
          const targets = sales.filter((s: any) => {
            const sPhone = String(s?.partnerPhone || '').replace(/\D/g, '');
            const st = String(s?.status || '').toLowerCase();
            const fin = st === 'paid' || st === 'transfered' || st === 'transferred';
            // ещё не создан ни предоплатный, ни полный чек для партнёра
            const noUrls = !(s?.ofdUrl) && !(s?.ofdFullUrl);
            return Boolean(s?.isAgent) && sPhone && sPhone === phoneDigits && fin && noUrls;
          });
          if (targets.length > 0) {
            const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
            const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
            const rawProto = req.headers.get('x-forwarded-proto') || 'http';
            const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
            const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(hostHdr);
            const protoHdr = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
            const secret = process.env.OFD_CALLBACK_SECRET || '';
            const callbackBase = `${protoHdr}://${hostHdr}`;
            for (const sale of targets) {
              try {
                const amountRub = Number(sale.amountGrossRub || 0);
                const retained = Number(sale.retainedCommissionRub || 0);
                const amountNet = Math.max(0, amountRub - retained);
                const usedVat = (sale.vatRate || 'none') as any;
                const createdAt = (sale as any).createdAtRw || (sale as any).createdAt;
                const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
                const endDate = sale.serviceEndDate || null;
                const isToday = Boolean(createdDate && endDate && createdDate === endDate);
                const callbackUrl = `${callbackBase}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;
                const itemsParam = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const orgInn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const products = orgInn ? await listProductsForOrg(orgInn) : []; return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
                if (isToday) {
                  let invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (!invoiceIdFull) {
                    try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdFull = await getInvoiceIdForFull(num); } catch {}
                  }
                  if (invoiceIdFull) {
                    const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: innNow, description: 'Оплата услуг', amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: innNow, SupplierName: 'Исполнитель' }, items: itemsParam });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                    await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null });
                  }
                } else {
                  let invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                  if (!invoiceIdPrepay) {
                    try { const num = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); invoiceIdPrepay = await getInvoiceIdForPrepay(num); } catch {}
                  }
                  if (invoiceIdPrepay) {
                    const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: innNow, description: 'Оплата услуг', amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: innNow, SupplierName: 'Исполнитель' }, items: itemsParam });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                    await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null });
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}








