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
import { fetchTextWithTimeout } from '@/server/http';
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

// Moscow date helper (YYYY-MM-DD)
function ymdMoscow(ts: string | Date | null | undefined): string | null {
  try {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  } catch { return null; }
}

// Persistent phase lock to avoid double creation (prepay vs full)
async function getOrSetOfdPhase(userId: string, orderId: number | string, preferred: 'prepay' | 'full'): Promise<'prepay' | 'full'> {
  try {
    const { readText, writeText } = await import('@/server/storage');
    const path = `.data/ofd_phase_${encodeURIComponent(String(userId))}_${encodeURIComponent(String(orderId))}.json`;
    const prev = await readText(path);
    if (prev) {
      try {
        const obj = JSON.parse(prev);
        const phase = (obj && (obj.phase === 'prepay' || obj.phase === 'full') ? obj.phase : preferred) as 'prepay' | 'full';
        return phase;
      } catch {
        return preferred;
      }
    }
    await writeText(path, JSON.stringify({ phase: preferred, ts: new Date().toISOString() }));
    return preferred;
  } catch {
    return preferred;
  }
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

      // Normalize acquiring status only from acquiring_order events; root-level events (task.paid, task.completed, ...) must NOT change acquiring
      let statusFromEvent: string | undefined;
      if (/^task\.acquiring_order\./.test(event)) {
        if (/\.paid$/.test(event)) statusFromEvent = 'paid';
        else if (/\.paying$/.test(event)) statusFromEvent = 'paying';
        else if (/\.transfered$/.test(event) || /\.transferred$/.test(event)) statusFromEvent = 'transfered';
        else if (/\.pending$/.test(event)) statusFromEvent = 'pending';
        else if (/\.expired$/.test(event)) statusFromEvent = 'expired';
        else if (/\.refunded$/.test(event)) statusFromEvent = 'refunded';
        else if (/\.failed$/.test(event)) statusFromEvent = 'failed';
      }

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

      const allowedAo = new Set(['pending','paying','paid','transfered','transferred','expired','refunded','failed']);
      const statusLower = typeof statusFromEvent === 'string' ? String(statusFromEvent).toLowerCase() : undefined;
      const aoLower = typeof aoStatusRaw === 'string' ? String(aoStatusRaw).toLowerCase() : undefined;
      // Acquiring status priority: 1) acquiring_order.status; 2) only if missing — event-based when it is an acquiring_order.* event
      const acquiringStatus = (aoLower && allowedAo.has(aoLower))
        ? aoLower
        : ((statusLower && allowedAo.has(statusLower)) ? statusLower : undefined);
      await updateSaleFromStatus(userId, taskId, {
        status: acquiringStatus as any,
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
      try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'postback', data: { event, status: acquiringStatus || null, rootStatusRaw: rootStatusRaw || null } }); } catch {}
      // Background pay trigger (agent, transfered, completed, has full receipt AND commission receipt)
      try {
        const sale = await findSaleByTaskId(userId, taskId);
        const aoStatus = String(aoStatusRaw || status || '').toLowerCase();
        const rootStatus = String(rootStatusRaw || '').toLowerCase();
        const hasCommission = Boolean(sale?.additionalCommissionOfdUrl);
        if (sale && sale.isAgent && sale.ofdFullUrl && hasCommission && aoStatus === 'transfered' && rootStatus === 'completed') {
          // Resolve token preferring org-scoped token for the sale's inn
          let token: string | null = null;
          try {
            const innDigits = sale.orgInn ? String(sale.orgInn).replace(/\D/g, '') : '';
            if (innDigits) {
              const { getTokenForOrg } = await import('@/server/orgStore');
              token = await getTokenForOrg(innDigits, userId);
            }
          } catch {}
          if (!token) token = await getDecryptedApiToken(userId);
          if (token) {
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const payUrl = new URL(`tasks/${encodeURIComponent(String(taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
            try {
              if (process.env.OFD_AUDIT === '1') {
                const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                await appendOfdAudit({ ts: new Date().toISOString(), source: 'postback', userId, orderId: numOrder, taskId, action: 'background_pay', patch: { reason: 'agent_transfered_completed_has_full', payUrl } });
              }
            } catch {}
            try {
              const out = await fetchTextWithTimeout(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
              const txt = out.text;
              if (!out.res.ok) {
                try {
                  const prev = (await readText('.data/rw_errors.log')) || '';
                  const line = JSON.stringify({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: out.res.status, responseText: txt, userId, taskId });
                  await writeText('.data/rw_errors.log', prev + line + '\n');
                } catch {}
              }
            } catch (e) {
              try {
                const prev = (await readText('.data/rw_errors.log')) || '';
                const line = JSON.stringify({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: null, error: e instanceof Error ? e.message : String(e), userId, taskId });
                await writeText('.data/rw_errors.log', prev + line + '\n');
              } catch {}
            }
          }
        }
      } catch {}
      // If paid/transfered — write a local marker so UI can hide QR instantly (based on acquiring status only)
      try {
        const fin = String((aoStatusRaw || statusFromEvent || '') as string).toLowerCase();
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
            // Compare pay date (paidAt if available else now) with service end date in MSK
            const paidIso = (sale as any)?.paidAt ? String((sale as any).paidAt) : new Date().toISOString();
            const createdAt = (sale as any).createdAtRw || (sale as any).createdAt;
            const paidDateMsk = ymdMoscow(paidIso);
            const endDate = sale.serviceEndDate || null;
            const endDateMsk = ymdMoscow(endDate ? `${endDate}T00:00:00Z` : null);
            const isToday = Boolean(paidDateMsk && endDateMsk && paidDateMsk === endDateMsk);
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
                const out = await fetchTextWithTimeout(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                const txt = out.text;
                let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                const taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
                const partnerInn: string | undefined = (taskObj?.executor?.inn as string | undefined);
                if (partnerInn) {
                  const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
                  const amountNet = Math.max(0, Number(sale.amountGrossRub || 0) - Number(sale.retainedCommissionRub || 0));
                  const itemLabel = (() => {
                    try {
                      const desc = (sale as any)?.description && String((sale as any).description).trim();
                      if (desc) return String(desc).slice(0, 128);
                      const snap = (sale as any)?.itemsSnapshot as any[] | null;
                      if (Array.isArray(snap) && snap.length > 0) {
                        const labels = snap.map((it: any) => String(it?.title || '').trim()).filter(Boolean);
                        if (labels.length > 0) return labels.join(', ').slice(0, 128);
                      }
                    } catch {}
                    return 'Оплата услуг';
                  })();
                  const useFull = isToday;
                  try {
                    const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                    const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'ofd_branch_choice', party: 'partner', userId, taskId, orderId: sale.orderId, reason: useFull ? 'is_today' : 'not_today', fin, paidDateMsk, endDateMsk });
                    await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                  } catch {}
                  if (useFull) {
                    const invoiceIdFull = (sale as any).invoiceIdFull || null;
                    if (invoiceIdFull) {
                      const partnerName = (taskObj?.executor && [taskObj?.executor?.last_name, taskObj?.executor?.first_name, taskObj?.executor?.second_name].filter(Boolean).join(' ').trim()) || undefined;
                      // Pre-check by InvoiceId to avoid duplicate creation
                      try {
                        let existingUrl: string | undefined;
                        let existingId: string | undefined;
                        try {
                          const stPre = await fermaGetReceiptStatus(String(invoiceIdFull), { baseUrl, authToken: tokenOfd });
                          const objPre = stPre.rawText ? JSON.parse(stPre.rawText) : {};
                          const fnPre = objPre?.Data?.Fn || objPre?.Fn;
                          const fdPre = objPre?.Data?.Fd || objPre?.Fd;
                          const fpPre = objPre?.Data?.Fp || objPre?.Fp;
                          const directPre = objPre?.Data?.Device?.OfdReceiptUrl as string | undefined;
                          if (typeof directPre === 'string' && directPre.length > 0) existingUrl = directPre;
                          else if (fnPre && fdPre != null && fpPre != null) existingUrl = buildReceiptViewUrl(fnPre, fdPre, fpPre);
                          existingId = (objPre?.Data?.ReceiptId as string | undefined) ?? (objPre?.ReceiptId as string | undefined);
                        } catch {}
                        if (existingId || existingUrl) {
                          const numOrderPre = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          await updateSaleOfdUrlsByOrderId(userId, numOrderPre, { ofdFullId: existingId || null, ...(existingUrl ? { ofdFullUrl: existingUrl } : {}) });
                          // Skip creation since exists
                          return NextResponse.json({ ok: true });
                        }
                      } catch {}
                      try {
                        const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, callbackUrl });
                        await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                      } catch {}
                      let itemsParam = await (async ()=>{
                        try {
                          const snap = (sale as any)?.itemsSnapshot as any[] | null;
                          const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined;
                          const products = inn ? await listProductsForOrg(inn) : [];
                          const fromSnapshot = Array.isArray(snap) && snap.length > 0 ? snap.map((it:any)=>{
                            const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null;
                            const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any;
                            return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                          }) : [];
                          if (fromSnapshot.length > 0) return fromSnapshot;
                          try {
                            const prevLog = (await readText('.data/ofd_create_attempts.log')) || '';
                            const lineLog = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_snapshot_empty', userId, taskId, orderId: sale.orderId });
                            await writeText('.data/ofd_create_attempts.log', prevLog + lineLog + '\n');
                          } catch {}
                          // Fallback: попытаться взять из payment link, если snapshot пуст
                          try {
                            const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null;
                            if (!code) {
                              try {
                                const prevLog2 = (await readText('.data/ofd_create_attempts.log')) || '';
                                const lineLog2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_no_linkcode', userId, taskId, orderId: sale.orderId });
                                await writeText('.data/ofd_create_attempts.log', prevLog2 + lineLog2 + '\n');
                              } catch {}
                              return undefined;
                            }
                            const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${req.headers.get('x-forwarded-proto')||'http'}://${req.headers.get('x-forwarded-host')||req.headers.get('host')||'localhost:3000'}`).toString(), { cache: 'no-store', headers: { 'x-user-id': userId } })).json().catch(()=>null);
                            const cart = Array.isArray(link?.cartItems) ? link.cartItems : [];
                            if (cart.length === 0) {
                              try {
                                const prevLog3 = (await readText('.data/ofd_create_attempts.log')) || '';
                                const lineLog3 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_cart_empty', userId, taskId, orderId: sale.orderId, linkCode: code });
                                await writeText('.data/ofd_create_attempts.log', prevLog3 + lineLog3 + '\n');
                              } catch {}
                              return undefined;
                            }
                            try {
                              const prevLog4 = (await readText('.data/ofd_create_attempts.log')) || '';
                              const lineLog4 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_from_link', userId, taskId, orderId: sale.orderId, linkCode: code, count: cart.length });
                              await writeText('.data/ofd_create_attempts.log', prevLog4 + lineLog4 + '\n');
                            } catch {}
                            return cart.map((c:any)=>{
                              const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null;
                              return { label: String(c.title||''), price: Number(c.price||0), qty: Number(c.qty||1), vatRate: ((prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any;
                            });
                          } catch {
                            try {
                              const prevLog5 = (await readText('.data/ofd_create_attempts.log')) || '';
                              const lineLog5 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_fetch_failed', userId, taskId, orderId: sale.orderId });
                              await writeText('.data/ofd_create_attempts.log', prevLog5 + lineLog5 + '\n');
                            } catch {}
                            return undefined;
                          }
                        } catch { return undefined; }
                      })();
                      if (!Array.isArray(itemsParam) || itemsParam.length === 0) {
                        try {
                          const snap2 = (sale as any)?.itemsSnapshot as any[] | null;
                          if (Array.isArray(snap2) && snap2.length > 0) {
                            itemsParam = snap2.map((it:any)=>({ label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: usedVat }));
                            try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_fallback_naive', party: 'partner', userId, taskId, orderId: sale.orderId, count: itemsParam.length }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {}
                          }
                        } catch {}
                      }
                      try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_final', party: 'partner', userId, taskId, orderId: sale.orderId, branch: 'full', count: Array.isArray(itemsParam) ? itemsParam.length : 0 }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {}
                      const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' }, items: itemsParam });
                      const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                      try {
                        const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                        await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                      } catch {}
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                      // defer URL resolve with retries: 7x every 10s, then background worker will handle
                      (async () => {
                        let built: string | undefined;
                        for (let i = 0; i < 7; i += 1) {
                          try { await new Promise((r) => setTimeout(r, 10000)); } catch {}
                          try { built = await tryResolveUrl(created.id || null); } catch { built = undefined; }
                          if (built) {
                            const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                            try { await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: built }); } catch {}
                            return;
                          }
                        }
                      })();
                    }
                  } else {
                    const invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                    // Extra guard: do not create prepay if full receipt already exists OR paid date equals service date in MSK
                    const hasFullAlready = Boolean((sale as any)?.ofdFullUrl || (sale as any)?.ofdFullId);
                    const paidIsoMsk = (sale as any)?.paidAt ? String((sale as any).paidAt) : new Date().toISOString();
                    const endDateMsk = sale.serviceEndDate || null;
                    const equalMsk = Boolean(ymdMoscow(paidIsoMsk) && ymdMoscow(endDateMsk ? `${endDateMsk}T00:00:00Z` : null) && ymdMoscow(paidIsoMsk) === ymdMoscow(endDateMsk ? `${endDateMsk}T00:00:00Z` : null));
                    // Phase lock: only allow prepay if phase=='prepay'
                    const lockOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                    const phase = await getOrSetOfdPhase(userId, lockOrder, 'prepay');
                    if (invoiceIdPrepay && !hasFullAlready && !equalMsk && phase === 'prepay') {
                      const partnerName2 = (taskObj?.executor && [taskObj?.executor?.last_name, taskObj?.executor?.first_name, taskObj?.executor?.second_name].filter(Boolean).join(' ').trim()) || undefined;
                      // Pre-check by InvoiceId to avoid duplicate creation
                      try {
                        let existingUrl: string | undefined;
                        let existingId: string | undefined;
                        try {
                          const stPre = await fermaGetReceiptStatus(String(invoiceIdPrepay), { baseUrl, authToken: tokenOfd });
                          const objPre = stPre.rawText ? JSON.parse(stPre.rawText) : {};
                          const fnPre = objPre?.Data?.Fn || objPre?.Fn;
                          const fdPre = objPre?.Data?.Fd || objPre?.Fd;
                          const fpPre = objPre?.Data?.Fp || objPre?.Fp;
                          const directPre = objPre?.Data?.Device?.OfdReceiptUrl as string | undefined;
                          if (typeof directPre === 'string' && directPre.length > 0) existingUrl = directPre;
                          else if (fnPre && fdPre != null && fpPre != null) existingUrl = buildReceiptViewUrl(fnPre, fdPre, fpPre);
                          existingId = (objPre?.Data?.ReceiptId as string | undefined) ?? (objPre?.ReceiptId as string | undefined);
                        } catch {}
                        if (existingId || existingUrl) {
                          const numOrderPre = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          await updateSaleOfdUrlsByOrderId(userId, numOrderPre, { ofdPrepayId: existingId || null, ...(existingUrl ? { ofdUrl: existingUrl } : {}) });
                          // Skip creation since exists
                          return NextResponse.json({ ok: true });
                        }
                      } catch {}
                      try {
                        const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_attempt', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, callbackUrl });
                        await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                      } catch {}
                      let itemsParamA = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const products = inn ? await listProductsForOrg(inn) : []; const fromSnap = Array.isArray(snap) && snap.length>0 ? snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }) : []; if (fromSnap.length>0) return fromSnap; try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_snapshot_empty', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} try { const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null; if (!code) { try { const prev2 = (await readText('.data/ofd_create_attempts.log')) || ''; const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_no_linkcode', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n'); } catch {} return undefined; } const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${req.headers.get('x-forwarded-proto')||'http'}://${req.headers.get('x-forwarded-host')||req.headers.get('host')||'localhost:3000'}`).toString(), { cache: 'no-store', headers: { 'x-user-id': userId } })).json().catch(()=>null); const cart = Array.isArray(link?.cartItems) ? link.cartItems : []; if (cart.length===0) { try { const prev3 = (await readText('.data/ofd_create_attempts.log')) || ''; const line3 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_cart_empty', userId, taskId, orderId: sale.orderId, linkCode: code }); await writeText('.data/ofd_create_attempts.log', prev3 + line3 + '\n'); } catch {} return undefined; } try { const prev4 = (await readText('.data/ofd_create_attempts.log')) || ''; const line4 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_from_link', userId, taskId, orderId: sale.orderId, linkCode: code, count: cart.length }); await writeText('.data/ofd_create_attempts.log', prev4 + line4 + '\n'); } catch {} return cart.map((c:any)=>{ const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null; return { label: String(c.title||''), price: Number(c.price||0), qty: Number(c.qty||1), vatRate: ((prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { try { const prev5 = (await readText('.data/ofd_create_attempts.log')) || ''; const line5 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_fetch_failed', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev5 + line5 + '\n'); } catch {} return undefined; } } catch { return undefined; } })();
                      if (!Array.isArray(itemsParamA) || itemsParamA.length === 0) {
                        try { const snap2 = (sale as any)?.itemsSnapshot as any[] | null; if (Array.isArray(snap2) && snap2.length > 0) { itemsParamA = snap2.map((it:any)=>({ label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: usedVat })); try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_fallback_naive', party: 'partner', userId, taskId, orderId: sale.orderId, branch: 'prepay', count: itemsParamA.length }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} } } catch {}
                      }
                      try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_final', party: 'partner', userId, taskId, orderId: sale.orderId, branch: 'prepay', count: Array.isArray(itemsParamA) ? itemsParamA.length : 0 }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {}
                      const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName2 || 'Исполнитель' }, items: itemsParamA });
                      const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                      try {
                        const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                        const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'partner', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                        await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                      } catch {}
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                      // defer URL resolve with retries: 7x every 10s
                      (async () => {
                        let built: string | undefined;
                        for (let i = 0; i < 7; i += 1) {
                          try { await new Promise((r) => setTimeout(r, 10000)); } catch {}
                          try { built = await tryResolveUrl(created.id || null); } catch { built = undefined; }
                          if (built) {
                            const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                            try { await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdUrl: built }); } catch {}
                            return;
                          }
                        }
                      })();
                      // schedule offset at 12:00 MSK
                      if (sale.serviceEndDate) {
                        startOfdScheduleWorker();
                        // 12:00 MSK -> convert to UTC: MSK=UTC+3, so 09:00Z
                        const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
                        { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: 'partner', partnerInn, description: itemLabel, amountRub: amountNet, vatRate: usedVat, buyerEmail: sale.clientEmail || defaultEmail }); }
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
                const itemLabelOrg = (() => {
                  try {
                    const desc = (sale as any)?.description && String((sale as any).description).trim();
                    if (desc) return String(desc).slice(0, 128);
                    const snap = (sale as any)?.itemsSnapshot as any[] | null;
                    if (Array.isArray(snap) && snap.length > 0) {
                      const labels = snap.map((it: any) => String(it?.title || '').trim()).filter(Boolean);
                      if (labels.length > 0) return labels.join(', ').slice(0, 128);
                    }
                  } catch {}
                  return 'Оплата услуг';
                })();
                const useFull = isToday;
                try {
                  const prev = (await readText('.data/ofd_create_attempts.log')) || '';
                  const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'ofd_branch_choice', party: 'org', userId, taskId, orderId: sale.orderId, reason: useFull ? 'is_today' : 'not_today', fin, paidDateMsk, endDateMsk });
                  await writeText('.data/ofd_create_attempts.log', prev + line + '\n');
                } catch {}
                if (useFull) {
                  const invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (invoiceIdFull) {
                    // Pre-check by InvoiceId to avoid duplicate creation
                    try {
                      let existingUrl: string | undefined;
                      let existingId: string | undefined;
                      try {
                        const stPre = await fermaGetReceiptStatus(String(invoiceIdFull), { baseUrl, authToken: tokenOfd });
                        const objPre = stPre.rawText ? JSON.parse(stPre.rawText) : {};
                        const fnPre = objPre?.Data?.Fn || objPre?.Fn;
                        const fdPre = objPre?.Data?.Fd || objPre?.Fd;
                        const fpPre = objPre?.Data?.Fp || objPre?.Fp;
                        const directPre = objPre?.Data?.Device?.OfdReceiptUrl as string | undefined;
                        if (typeof directPre === 'string' && directPre.length > 0) existingUrl = directPre;
                        else if (fnPre && fdPre != null && fpPre != null) existingUrl = buildReceiptViewUrl(fnPre, fdPre, fpPre);
                        existingId = (objPre?.Data?.ReceiptId as string | undefined) ?? (objPre?.ReceiptId as string | undefined);
                      } catch {}
                      if (existingId || existingUrl) {
                        const numOrderPre = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                        await updateSaleOfdUrlsByOrderId(userId, numOrderPre, { ofdFullId: existingId || null, ...(existingUrl ? { ofdFullUrl: existingUrl } : {}) });
                        return NextResponse.json({ ok: true });
                      }
                    } catch {}
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
                          const out = await fetchTextWithTimeout(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                          const txt = out.text;
                          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                          const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                          if (nm) { supplierName = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                        }
                      }
                    } catch {}
                    let itemsParamOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; const products = await listProductsForOrg(orgInn); const fromSnap = Array.isArray(snap) && snap.length>0 ? snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }) : []; if (fromSnap.length>0) return fromSnap; try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_snapshot_empty', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} try { const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null; if (!code) { try { const prev2 = (await readText('.data/ofd_create_attempts.log')) || ''; const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_no_linkcode', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n'); } catch {} return undefined; } const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${req.headers.get('x-forwarded-proto')||'http'}://${req.headers.get('x-forwarded-host')||req.headers.get('host')||'localhost:3000'}`).toString(), { cache: 'no-store', headers: { 'x-user-id': userId } })).json().catch(()=>null); const cart = Array.isArray(link?.cartItems) ? link.cartItems : []; if (cart.length===0) { try { const prev3 = (await readText('.data/ofd_create_attempts.log')) || ''; const line3 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_cart_empty', userId, taskId, orderId: sale.orderId, linkCode: code }); await writeText('.data/ofd_create_attempts.log', prev3 + line3 + '\n'); } catch {} return undefined; } try { const prev4 = (await readText('.data/ofd_create_attempts.log')) || ''; const line4 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_from_link', userId, taskId, orderId: sale.orderId, linkCode: code, count: cart.length }); await writeText('.data/ofd_create_attempts.log', prev4 + line4 + '\n'); } catch {} return cart.map((c:any)=>{ const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null; return { label: String(c.title||''), price: Number(c.price||0), qty: Number(c.qty||1), vatRate: ((prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { try { const prev5 = (await readText('.data/ofd_create_attempts.log')) || ''; const line5 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_fetch_failed', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev5 + line5 + '\n'); } catch {} return undefined; } } catch { return undefined; } })();
                    if (!Array.isArray(itemsParamOrg) || itemsParamOrg.length === 0) {
                      try { const snap2 = (sale as any)?.itemsSnapshot as any[] | null; if (Array.isArray(snap2) && snap2.length > 0) { itemsParamOrg = snap2.map((it:any)=>({ label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: usedVat })); try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_fallback_naive', party: 'org', userId, taskId, orderId: sale.orderId, count: itemsParamOrg.length }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} } } catch {}
                    }
                    try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_final', party: 'org', userId, taskId, orderId: sale.orderId, branch: 'full', count: Array.isArray(itemsParamOrg) ? itemsParamOrg.length : 0 }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {}
                    const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabelOrg, amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName }, items: itemsParamOrg });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    try {
                      const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdFull, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                      await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                    } catch {}
                    { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                    // defer URL resolve with retries: 7x every 10s
                    (async () => {
                      let built: string | undefined;
                      for (let i = 0; i < 7; i += 1) {
                        try { await new Promise((r) => setTimeout(r, 10000)); } catch {}
                        try { built = await tryResolveUrl(created.id || null); } catch { built = undefined; }
                        if (built) {
                          const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          try { await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: built }); } catch {}
                          return;
                        }
                      }
                    })();
                  }
                } else {
                  const invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                  if (invoiceIdPrepay) {
                    // Pre-check by InvoiceId to avoid duplicate creation
                    try {
                      let existingUrl: string | undefined;
                      let existingId: string | undefined;
                      try {
                        const stPre = await fermaGetReceiptStatus(String(invoiceIdPrepay), { baseUrl, authToken: tokenOfd });
                        const objPre = stPre.rawText ? JSON.parse(stPre.rawText) : {};
                        const fnPre = objPre?.Data?.Fn || objPre?.Fn;
                        const fdPre = objPre?.Data?.Fd || objPre?.Fd;
                        const fpPre = objPre?.Data?.Fp || objPre?.Fp;
                        const directPre = objPre?.Data?.Device?.OfdReceiptUrl as string | undefined;
                        if (typeof directPre === 'string' && directPre.length > 0) existingUrl = directPre;
                        else if (fnPre && fdPre != null && fpPre != null) existingUrl = buildReceiptViewUrl(fnPre, fdPre, fpPre);
                        existingId = (objPre?.Data?.ReceiptId as string | undefined) ?? (objPre?.ReceiptId as string | undefined);
                      } catch {}
                      if (existingId || existingUrl) {
                        const numOrderPre = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                        await updateSaleOfdUrlsByOrderId(userId, numOrderPre, { ofdPrepayId: existingId || null, ...(existingUrl ? { ofdUrl: existingUrl } : {}) });
                        // Existing found; skip creation
                        return NextResponse.json({ ok: true });
                      }
                    } catch {}
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
                          const out = await fetchTextWithTimeout(accUrl, { headers: { Authorization: `Bearer ${tok2}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                          const txt = out.text;
                          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                          const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                          if (nm) { supplierName2 = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                        }
                      }
                    } catch {}
                    let itemsParamAOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; const products = await listProductsForOrg(orgInn); const fromSnap = Array.isArray(snap) && snap.length>0 ? snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }) : []; if (fromSnap.length>0) return fromSnap; try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_snapshot_empty', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} try { const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null; if (!code) { try { const prev2 = (await readText('.data/ofd_create_attempts.log')) || ''; const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_no_linkcode', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n'); } catch {} return undefined; } const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${req.headers.get('x-forwarded-proto')||'http'}://${req.headers.get('x-forwarded-host')||req.headers.get('host')||'localhost:3000'}`).toString(), { cache: 'no-store', headers: { 'x-user-id': userId } })).json().catch(()=>null); const cart = Array.isArray(link?.cartItems) ? link.cartItems : []; if (cart.length===0) { try { const prev3 = (await readText('.data/ofd_create_attempts.log')) || ''; const line3 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_cart_empty', userId, taskId, orderId: sale.orderId, linkCode: code }); await writeText('.data/ofd_create_attempts.log', prev3 + line3 + '\n'); } catch {} return undefined; } try { const prev4 = (await readText('.data/ofd_create_attempts.log')) || ''; const line4 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_from_link', userId, taskId, orderId: sale.orderId, linkCode: code, count: cart.length }); await writeText('.data/ofd_create_attempts.log', prev4 + line4 + '\n'); } catch {} return cart.map((c:any)=>{ const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null; return { label: String(c.title||''), price: Number(c.price||0), qty: Number(c.qty||1), vatRate: ((prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { try { const prev5 = (await readText('.data/ofd_create_attempts.log')) || ''; const line5 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_link_fetch_failed', userId, taskId, orderId: sale.orderId }); await writeText('.data/ofd_create_attempts.log', prev5 + line5 + '\n'); } catch {} return undefined; } } catch { return undefined; } })();
                    if (!Array.isArray(itemsParamAOrg) || itemsParamAOrg.length === 0) {
                      try { const snap2 = (sale as any)?.itemsSnapshot as any[] | null; if (Array.isArray(snap2) && snap2.length > 0) { itemsParamAOrg = snap2.map((it:any)=>({ label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: usedVat })); try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_fallback_naive', party: 'org', userId, taskId, orderId: sale.orderId, branch: 'prepay', count: itemsParamAOrg.length }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {} } } catch {}
                    }
                    try { const prev = (await readText('.data/ofd_create_attempts.log')) || ''; const line = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'items_final', party: 'org', userId, taskId, orderId: sale.orderId, branch: 'prepay', count: Array.isArray(itemsParamAOrg) ? itemsParamAOrg.length : 0 }); await writeText('.data/ofd_create_attempts.log', prev + line + '\n'); } catch {}
                    const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabelOrg, amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierName2 }, items: itemsParamAOrg });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    try {
                      const prev2 = (await readText('.data/ofd_create_attempts.log')) || '';
                      const line2 = JSON.stringify({ ts: new Date().toISOString(), src: 'postback', stage: 'create_result', party: 'org', userId, taskId, orderId: sale.orderId, invoiceId: invoiceIdPrepay, id: created.id, rawStatus: created.rawStatus, statusText: created.status });
                      await writeText('.data/ofd_create_attempts.log', prev2 + line2 + '\n');
                    } catch {}
                    { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                    // defer URL resolve with retries: 7x every 10s
                    (async () => {
                      let built: string | undefined;
                      for (let i = 0; i < 7; i += 1) {
                        try { await new Promise((r) => setTimeout(r, 10000)); } catch {}
                        try { built = await tryResolveUrl(created.id || null); } catch { built = undefined; }
                        if (built) {
                          const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                          try { await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdUrl: built }); } catch {}
                          return;
                        }
                      }
                    })();
                    if (sale.serviceEndDate) {
                      startOfdScheduleWorker();
                      const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
                      { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: 'org', description: itemLabelOrg, amountRub, vatRate: usedVat, buyerEmail: sale.clientEmail || defaultEmail }); }
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
                // MSK-aware comparison: paid date vs service end date
                const paidIso2 = (sale as any)?.paidAt ? String((sale as any).paidAt) : new Date().toISOString();
                const endDate = sale.serviceEndDate || null;
                const isToday = Boolean(ymdMoscow(paidIso2) && ymdMoscow(endDate ? `${endDate}T00:00:00Z` : null) && ymdMoscow(paidIso2) === ymdMoscow(endDate ? `${endDate}T00:00:00Z` : null));
                const callbackUrl = `${callbackBase}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;
                const itemsParam = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap) || snap.length === 0) return undefined; const orgInn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const products = orgInn ? await listProductsForOrg(orgInn) : []; return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || (usedVat as any)), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })();
                const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
                if (isToday) {
                  const invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (invoiceIdFull) {
                    const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: innNow, description: 'Оплата услуг', amountRub: amountNet, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: sale.clientEmail || defaultEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: innNow, SupplierName: 'Исполнитель' }, items: itemsParam });
                    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                    const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                    await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null });
                  }
                } else {
                  const invoiceIdPrepay = (sale as any).invoiceIdPrepay || null;
                  // Extra guard: do not create prepay if full receipt already exists OR paid date equals service date in MSK
                  const hasFullAlready = Boolean((sale as any)?.ofdFullUrl || (sale as any)?.ofdFullId);
                  const paidIsoMsk = (sale as any)?.paidAt ? String((sale as any).paidAt) : new Date().toISOString();
                  const endDateMsk = sale.serviceEndDate || null;
                  const equalMsk = Boolean(ymdMoscow(paidIsoMsk) && ymdMoscow(endDateMsk ? `${endDateMsk}T00:00:00Z` : null) && ymdMoscow(paidIsoMsk) === ymdMoscow(endDateMsk ? `${endDateMsk}T00:00:00Z` : null));
                  if (invoiceIdPrepay && !hasFullAlready && !equalMsk) {
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








