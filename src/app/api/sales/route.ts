import { NextResponse } from 'next/server';
import { listSales, listSalesForOrg, updateSaleFromStatus, updateSaleOfdUrlsByOrderId, setSaleCreatedAtRw, setSaleHidden, listAllSalesForOrg } from '@/server/taskStore';
import { getSelectedOrgInn } from '@/server/orgContext';
import type { RocketworkTask } from '@/types/rocketwork';
import { getDecryptedApiToken } from '@/server/secureStore';
import { readUserIndex } from '@/server/salesIndex';
import { readText } from '@/server/storage';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';
import { startOfdScheduleWorker } from '@/server/ofdScheduleWorker';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    // Ensure background OFD worker is running when sales endpoint is hit
    try { startOfdScheduleWorker(); } catch {}
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const urlObj = new URL(req.url);
    const shouldRefresh = urlObj.searchParams.get('refresh') === '1';
    const ordersParam = urlObj.searchParams.get('orders');
    const onlyOrders: number[] | null = ordersParam ? ordersParam.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n)) : null;
    if (shouldRefresh) {
      const token = await getDecryptedApiToken(userId);
      if (token) {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        // Берём только продажи, инициированные нашим UI (source === 'ui')
        const inn = getSelectedOrgInn(req);
        const all = await listSales(userId);
        let current = all.filter((s: any) => (s as any).source === 'ui' && (
          !inn || String((s as any).orgInn || 'неизвестно') === inn || (s as any).orgInn == null || String((s as any).orgInn) === 'неизвестно'
        ));
        if (onlyOrders && onlyOrders.length > 0) {
          const set = new Set(onlyOrders.map((n) => Number(n)));
          current = current.filter((s) => set.has(Number(s.orderId)));
        }
        // Decide which sales to refresh — строго по правилам дат и агентским требованиям
        const toRefresh = current.filter((s) => {
          // Если корневой статус задачи финально неуспешен — не трогаем её в массовых опросах
          const root = String(((s as any).rootStatus || '') as string).toLowerCase();
          if (root === 'error' || root === 'canceled' || root === 'cancelled') return false;
          const st = String(s.status || '').toLowerCase();
          const isEarly = st === 'pending' || st === 'paying';
          const createdAt = (s.createdAtRw || s.createdAt) as string | null;
          const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
          const endStr = (s.serviceEndDate || '') as string;
          const endDate = endStr ? String(endStr).slice(0, 10) : null;
          const isSameDay = Boolean(createdDate && endDate && createdDate === endDate);
          const agentExtrasMissing = s.isAgent && (!s.additionalCommissionOfdUrl || !s.npdReceiptUri);
          const receiptsMissing = isSameDay ? (!s.ofdFullUrl) : (!s.ofdUrl || !s.ofdFullUrl);
          const needReceipts = receiptsMissing || agentExtrasMissing;
          const needCreatedAt = !s.createdAtRw;
          // Рефрешим если задача ранняя, либо не хватает требуемых полей, либо нет createdAtRw
          return isEarly || needReceipts || needCreatedAt;
        });
        for (const s of toRefresh) {
          try {
            const taskUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            let res = await fetch(taskUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            let text = await res.text();
            let data: unknown = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = text; }
            let normalized: RocketworkTask = (data && typeof data === 'object' && 'task' in (data as Record<string, unknown>)) ? ((data as any).task as RocketworkTask) : (data as RocketworkTask);
            // In case a sale is missing for an externally created task, ensure presence (preserve org context)
            try { const { ensureSaleFromTask } = await import('@/server/taskStore'); await ensureSaleFromTask({ userId, taskId: s.taskId, task: normalized as any, orgInn: inn || null }); } catch {}
            // If paid/transferred but no receipts, try a few times
            let tries = 0;
            const status = normalized?.acquiring_order?.status as string | undefined;
            while ((status === 'paid' || status === 'transferred' || status === 'transfered') && tries < 4 && (!normalized?.receipt_uri || (s.isAgent && !normalized?.additional_commission_ofd_url))) {
              await new Promise((r) => setTimeout(r, 1200));
              res = await fetch(taskUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
              text = await res.text();
              try { data = text ? JSON.parse(text) : null; } catch { data = text; }
              normalized = (data && typeof data === 'object' && 'task' in (data as Record<string, unknown>)) ? ((data as any).task as RocketworkTask) : (data as RocketworkTask);
              tries += 1;
            }
            const ofdUrl = (normalized?.ofd_url as string | undefined)
              ?? (normalized?.acquiring_order?.ofd_url as string | undefined)
              ?? null;
            const addOfd = (normalized?.additional_commission_ofd_url as string | undefined)
              ?? null;
            const npdReceipt = (normalized?.receipt_uri as string | undefined) ?? null;
            // Classify RW ofd_url using creation date vs service end date
            const patch: any = { status: normalized?.acquiring_order?.status, additionalCommissionOfdUrl: addOfd, npdReceiptUri: npdReceipt };
            if (ofdUrl) {
              const toMskDate = (iso: string | null | undefined): string | null => {
                if (!iso) return null;
                const d = new Date(iso);
                if (!Number.isFinite(d.getTime())) return null;
                const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
                const parts = fmt.formatToParts(d);
                const dd = parts.find((p) => p.type === 'day')?.value || '';
                const mm = parts.find((p) => p.type === 'month')?.value || '';
                const yy = parts.find((p) => p.type === 'year')?.value || '';
                return (yy && mm && dd) ? `${yy}-${mm}-${dd}` : null;
              };
              const createdAt = (normalized as any)?.created_at || s.createdAtRw || s.createdAt;
              const createdDate = toMskDate(createdAt);
              const endStr = (s.serviceEndDate || '') as string;
              if (createdDate && endStr && createdDate === endStr) patch.ofdFullUrl = ofdUrl; else patch.ofdUrl = ofdUrl;
            }
            await updateSaleFromStatus(userId, s.taskId, patch);
            // Force-exclusive placement: if we classified RW ofd_url, clear the opposite column
            if (ofdUrl) {
              try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
              try {
                const toMskDate = (iso: string | null | undefined): string | null => {
                  if (!iso) return null;
                  const d = new Date(iso);
                  if (!Number.isFinite(d.getTime())) return null;
                  const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
                  const parts = fmt.formatToParts(d);
                  const dd = parts.find((p) => p.type === 'day')?.value || '';
                  const mm = parts.find((p) => p.type === 'month')?.value || '';
                  const yy = parts.find((p) => p.type === 'year')?.value || '';
                  return (yy && mm && dd) ? `${yy}-${mm}-${dd}` : null;
                };
                const createdAt = (normalized as any)?.created_at || s.createdAtRw || s.createdAt;
                const createdDate = toMskDate(createdAt);
                const endStr = (s.serviceEndDate || '') as string;
                if (createdDate && endStr && createdDate === endStr) {
                  { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullUrl: ofdUrl }); }
                } else {
                  { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdUrl: ofdUrl }); }
                }
              } catch {}
            }
            try {
              const createdAtRw: string | undefined = (normalized as any)?.created_at || undefined;
              if (createdAtRw) await setSaleCreatedAtRw(userId, s.taskId, createdAtRw);
            } catch {}

            try {
              const aoStatus = String(normalized?.acquiring_order?.status || '').toLowerCase();
              const rootStatus = String(normalized?.status || '').toLowerCase();
              const hasAgent = Boolean(normalized?.additional_commission_value);
              const { findSaleByTaskId } = await import('@/server/taskStore');
              const rec = await findSaleByTaskId(userId, s.taskId);
              const saleHasFull = Boolean(rec?.ofdFullUrl);
              // Trigger pay only if agent, transferred, completed, and ofdFullUrl exists in store
              if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed' && saleHasFull && !npdReceipt) {
                const payUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
                await fetch(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
                // And poll a few times specifically for NPD receipt
                let extra = 0;
                while (extra < 5) {
                  await new Promise((r) => setTimeout(r, 1200));
                  const r2 = await fetch(taskUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
                  const t2 = await r2.text();
                  let d2: any = null; try { d2 = t2 ? JSON.parse(t2) : null; } catch { d2 = t2; }
                  const n2 = d2 && typeof d2 === 'object' && 'task' in d2 ? (d2 as any).task : d2;
                  const npd2 = (n2?.receipt_uri as string | undefined) ?? null;
                  if (npd2) {
                    await updateSaleFromStatus(userId, s.taskId, { npdReceiptUri: npd2 });
                    break;
                  }
                  extra += 1;
                }
              }
            } catch {}
            // Fallback path: if final AND receipt missing — create OFD receipt(s) ourselves (same logic as tasks/[id])
            try {
              const aoFin = String(normalized?.acquiring_order?.status || '').toLowerCase();
              if (aoFin === 'paid' || aoFin === 'transfered' || aoFin === 'transferred') {
                const { findSaleByTaskId } = await import('@/server/taskStore');
                const sale = await findSaleByTaskId(userId, s.taskId);
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
                  const tokenOfd = await (await import('@/server/ofdFerma')).fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
                  const rawProto = req.headers.get('x-forwarded-proto') || 'http';
                  const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
                  const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(hostHdr);
                  const protoHdr = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
                  const secret = process.env.OFD_CALLBACK_SECRET || '';
                  const callbackUrl = `${protoHdr}://${hostHdr}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;
                  if (isToday) {
                    if (!sale.ofdFullUrl && !sale.ofdFullId) {
                      if (sale.isAgent) {
                        const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                        if (partnerInn) {
                          const { getInvoiceIdForFull } = await import('@/server/orderStore');
                          const invoiceIdFull = await getInvoiceIdForFull(Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN));
                          const partnerName = ((normalized as any)?.executor && [
                            (normalized as any)?.executor?.last_name,
                            (normalized as any)?.executor?.first_name,
                            (normalized as any)?.executor?.second_name,
                          ].filter(Boolean).join(' ').trim()) || undefined;
                          const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || (process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com');
                          const payload = (await import('@/app/api/ofd/ferma/build-payload')).buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: (await import('@/app/api/ofd/ferma/build-payload')).PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' } });
                          const created = await (await import('@/server/ofdFerma')).fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                          try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
                          { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                        }
                      } else {
                        const orgInn = (sale.orgInn && String(sale.orgInn).trim().length > 0 && String(sale.orgInn) !== 'неизвестно') ? String(sale.orgInn).replace(/\D/g, '') : null;
                        if (orgInn) {
                          const { getInvoiceIdForFull } = await import('@/server/orderStore');
                          const invoiceIdFull = await getInvoiceIdForFull(Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN));
                          const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || (process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com');
                          let supplierNameOrg: string | undefined;
                          try {
                            const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                            const rec = await findOrgByInn(orgInn);
                            supplierNameOrg = (rec?.name && rec.name.trim().length > 0) ? rec.name.trim() : undefined;
                            if (!supplierNameOrg) {
                              const tok = await getTokenForOrg(orgInn, userId);
                              if (tok) {
                                const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                                const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                                const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' });
                                const txt = await r.text();
                                let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                                const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                                if (nm) { supplierNameOrg = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                              }
                            }
                          } catch {}
                          const payload = (await import('@/app/api/ofd/ferma/build-payload')).buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: (await import('@/app/api/ofd/ferma/build-payload')).PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierNameOrg }, items: await (async()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if(!Array.isArray(snap)||snap.length===0) return undefined; const products = await (await import('@/server/productsStore')).listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || usedVat), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })() });
                          const created = await (await import('@/server/ofdFerma')).fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                          try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
                          { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                        }
                      }
                    }
                  } else {
                    if (!sale.ofdUrl && !sale.ofdPrepayId) {
                      if (sale.isAgent) {
                        const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                        if (partnerInn) {
                          const { getInvoiceIdForPrepay } = await import('@/server/orderStore');
                          const invoiceIdPrepay = await getInvoiceIdForPrepay(Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN));
                          const partnerName2 = ((normalized as any)?.executor && [
                            (normalized as any)?.executor?.last_name,
                            (normalized as any)?.executor?.first_name,
                            (normalized as any)?.executor?.second_name,
                          ].filter(Boolean).join(' ').trim()) || undefined;
                          const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || (process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com');
                          const payload = (await import('@/app/api/ofd/ferma/build-payload')).buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: (await import('@/app/api/ofd/ferma/build-payload')).PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName2 || 'Исполнитель' } });
                          const created = await (await import('@/server/ofdFerma')).fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                          try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
                          { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                        }
                      } else {
                        const orgInn = (sale.orgInn && String(sale.orgInn).trim().length > 0 && String(sale.orgInn) !== 'неизвестно') ? String(sale.orgInn).replace(/\D/g, '') : null;
                        if (orgInn) {
                          const { getInvoiceIdForPrepay } = await import('@/server/orderStore');
                          const invoiceIdPrepay = await getInvoiceIdForPrepay(Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN));
                          const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || (process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com');
                          let supplierNameOrg2: string | undefined;
                          try {
                            const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                            const rec = await findOrgByInn(orgInn);
                            supplierNameOrg2 = (rec?.name && rec.name.trim().length > 0) ? rec.name.trim() : undefined;
                            if (!supplierNameOrg2) {
                              const tok = await getTokenForOrg(orgInn, userId);
                              if (tok) {
                                const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                                const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                                const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' });
                                const txt = await r.text();
                                let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                                const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                                if (nm) { supplierNameOrg2 = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                              }
                            }
                          } catch {}
                          const payload = (await import('@/app/api/ofd/ferma/build-payload')).buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: (await import('@/app/api/ofd/ferma/build-payload')).PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdPrepay, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierNameOrg2 }, items: await (async()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if(!Array.isArray(snap)||snap.length===0) return undefined; const products = await (await import('@/server/productsStore')).listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat = (['none','0','5','7','10','20'].includes(String(it?.vat)) ? String(it.vat) : undefined) as any; return { label: String(it.title||''), price: Number(it.price||0), qty: Number(it.qty||1), vatRate: (snapVat || (prod?.vat as any) || usedVat), unit: (prod?.unit as any), kind: (prod?.kind as any) } as any; }); } catch { return undefined; } })() });
                          const created = await (await import('@/server/ofdFerma')).fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                          try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
                          { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                          if (sale.serviceEndDate) {
                            try { (await import('@/server/ofdScheduleWorker')).startOfdScheduleWorker(); } catch {}
                            const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
                            { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await (await import('@/server/ofdScheduleWorker')).enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: 'org', description: 'Оплата услуги', amountRub, vatRate: usedVat, buyerEmail: bEmail }); }
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch {}
            // Also try refreshing OFD receipts directly by stored ReceiptId if present
            try {
              if ((s as any).ofdPrepayId || (s as any).ofdFullId) {
                const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
                const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
                const patch: any = {};
                if (!s.ofdUrl && (s as any).ofdPrepayId) {
                  const st = await fermaGetReceiptStatus((s as any).ofdPrepayId, { baseUrl, authToken: tokenOfd });
                  try {
                    const obj = st.rawText ? JSON.parse(st.rawText) : {};
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    if (fn && fd != null && fp != null) { patch.ofdUrl = buildReceiptViewUrl(fn, fd, fp); }
                    if (!patch.ofdUrl) {
                      const direct = obj?.Data?.Device?.OfdReceiptUrl;
                      if (typeof direct === 'string' && direct.length > 0) { patch.ofdUrl = direct; }
                    }
                  } catch {}
                }
                // Fix cases where ofdFullUrl был записан ссылкой предоплаты: перезапрашиваем по ofdFullId,
                // если он есть и (ссылка отсутствует ИЛИ совпадает с ofdUrl)
                if ((s as any).ofdFullId && (!s.ofdFullUrl || s.ofdFullUrl === s.ofdUrl)) {
                  try {
                    const st = await fermaGetReceiptStatus((s as any).ofdFullId, { baseUrl, authToken: tokenOfd });
                    const obj = st.rawText ? JSON.parse(st.rawText) : {};
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    if (fn && fd != null && fp != null) { patch.ofdFullUrl = buildReceiptViewUrl(fn, fd, fp); }
                    if (!patch.ofdFullUrl) {
                      let tries = 0;
                      while (!patch.ofdFullUrl && tries < 20) {
                        const st2 = await fermaGetReceiptStatus((s as any).ofdFullId, { baseUrl, authToken: tokenOfd });
                        const obj2 = st2.rawText ? JSON.parse(st2.rawText) : {};
                        const fn2 = obj2?.Data?.Fn || obj2?.Fn;
                        const fd2 = obj2?.Data?.Fd || obj2?.Fd;
                        const fp2 = obj2?.Data?.Fp || obj2?.Fp;
                        if (fn2 && fd2 != null && fp2 != null) { patch.ofdFullUrl = buildReceiptViewUrl(fn2, fd2, fp2); break; }
                        tries += 1;
                        await new Promise((r) => setTimeout(r, 1000));
                      }
                    }
                  } catch {}
                }
                if (Object.keys(patch).length > 0) {
                  const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
                  await updateSaleOfdUrlsByOrderId(userId, numOrder, patch);
                }
              }
              // Fallback: ONLY use stored InvoiceId variants when a receipt link is missing
              if ((!s.ofdFullUrl || !s.ofdUrl) && ((s as any).invoiceIdPrepay || (s as any).invoiceIdOffset || (s as any).invoiceIdFull)) {
                try {
                  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
                  const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
                  const invoiceIds = [s.invoiceIdPrepay, s.invoiceIdOffset, s.invoiceIdFull].filter(Boolean) as string[];
                  for (const inv of invoiceIds) {
                    const st = await fermaGetReceiptStatus(inv, { baseUrl, authToken: tokenOfd });
                    const obj = st.rawText ? JSON.parse(st.rawText) : {};
                    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                    const rid = obj?.Data?.ReceiptId as string | undefined;
                    const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
                    const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
                    if (url) {
                      const patch2: any = {};
                      if (/\-C\-?\d+$/.test(inv) || /\-B\-?\d+$/.test(inv)) { patch2.ofdFullUrl = url; if (rid) patch2.ofdFullId = rid; }
                      else { patch2.ofdUrl = url; if (rid) patch2.ofdPrepayId = rid; }
                      { const numOrder = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, patch2); }
                      break;
                    }
                  }
                } catch {}
              }
            } catch {}
          } catch {}
        }
      }
    }
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    // Fast-path pagination via indexes: when limit is provided and no link filter
    const limitRaw = urlObj.searchParams.get('limit');
    const limit = (() => { const n = Number(limitRaw); return Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(1, Math.floor(n))) : 0; })();
    const cursorRaw = urlObj.searchParams.get('cursor');
    const linkCode = urlObj.searchParams.get('link');
    const onlySuccess = urlObj.searchParams.get('success') === '1';
    const taskIdsRaw = urlObj.searchParams.get('taskIds');

    // Parse filter params for server-side filtering
    const filter = {
      query: (urlObj.searchParams.get('q') || '').trim(),
      status: (urlObj.searchParams.get('status') || '').trim(),
      agent: urlObj.searchParams.get('agent'), // 'yes' | 'no' | null
      prepay: urlObj.searchParams.get('prepay'),
      full: urlObj.searchParams.get('full'),
      commission: urlObj.searchParams.get('commission'),
      npd: urlObj.searchParams.get('npd'),
      showHidden: urlObj.searchParams.get('showHidden') || 'no',
      saleFrom: urlObj.searchParams.get('saleFrom'),
      saleTo: urlObj.searchParams.get('saleTo'),
      endFrom: urlObj.searchParams.get('endFrom'),
      endTo: urlObj.searchParams.get('endTo'),
      amountMin: urlObj.searchParams.get('amountMin'),
      amountMax: urlObj.searchParams.get('amountMax'),
    } as const;

    const hasAnyFilter = [filter.query, filter.status, filter.agent, filter.prepay, filter.full, filter.commission, filter.npd, filter.saleFrom, filter.saleTo, filter.endFrom, filter.endTo, filter.amountMin, filter.amountMax].some((v) => v && String(v).trim().length > 0) || filter.showHidden === 'yes';

    const saleMatches = (s: any): boolean => {
      // showHidden: default 'no'
      if (filter.showHidden !== 'all') {
        const isHidden = Boolean(s.hidden);
        if (filter.showHidden === 'no' && isHidden) return false;
        if (filter.showHidden === 'yes' && !isHidden) return false;
      }
      if (filter.query) {
        const q = filter.query;
        if (!(String(s.taskId).includes(q) || String(s.orderId).includes(q))) return false;
      }
      if (filter.status) {
        const st = String(s.status || '').toLowerCase();
        if (st !== String(filter.status).toLowerCase()) return false;
      }
      if (filter.agent === 'yes' && !s.isAgent) return false;
      if (filter.agent === 'no' && s.isAgent) return false;
      const hasPrepay = Boolean(s.ofdUrl);
      const hasFull = Boolean(s.ofdFullUrl);
      const hasComm = Boolean(s.additionalCommissionOfdUrl);
      const hasNpd = Boolean(s.npdReceiptUri);
      if (filter.prepay === 'yes' && !hasPrepay) return false; if (filter.prepay === 'no' && hasPrepay) return false;
      if (filter.full === 'yes' && !hasFull) return false; if (filter.full === 'no' && hasFull) return false;
      if (filter.commission === 'yes' && !hasComm) return false; if (filter.commission === 'no' && hasComm) return false;
      // Чек НПД: учитывать как поля на самой продаже, так и в связанных (на всякий случай)
      if (filter.npd === 'yes' && !hasNpd) return false; if (filter.npd === 'no' && hasNpd) return false;
      if (filter.saleFrom || filter.saleTo) {
        const base = s.createdAtRw || s.createdAt;
        const ts = base ? Date.parse(base) : NaN;
        if (filter.saleFrom && !(Number.isFinite(ts) && ts >= Date.parse(String(filter.saleFrom)))) return false;
        if (filter.saleTo && !(Number.isFinite(ts) && ts <= (Date.parse(String(filter.saleTo)) + 24*60*60*1000 - 1))) return false;
      }
      if (filter.endFrom || filter.endTo) {
        const e = s.serviceEndDate ? Date.parse(String(s.serviceEndDate)) : NaN;
        if (filter.endFrom && !(Number.isFinite(e) && e >= Date.parse(String(filter.endFrom)))) return false;
        if (filter.endTo && !(Number.isFinite(e) && e <= (Date.parse(String(filter.endTo)) + 24*60*60*1000 - 1))) return false;
      }
      const min = filter.amountMin ? Number(String(filter.amountMin).replace(',', '.')) : null;
      const max = filter.amountMax ? Number(String(filter.amountMax).replace(',', '.')) : null;
      if (min != null && !(Number(s.amountGrossRub || 0) >= min)) return false;
      if (max != null && !(Number(s.amountGrossRub || 0) <= max)) return false;
      return true;
    };

    function compareRows(a: any, b: any): number {
      const at = Date.parse(a?.createdAt || 0);
      const bt = Date.parse(b?.createdAt || 0);
      if (bt !== at) return bt - at;
      // tie-breaker by taskId desc
      return String(b.taskId || '').localeCompare(String(a.taskId || ''));
    }

    if (taskIdsRaw && taskIdsRaw.trim().length > 0) {
      // Fast lookup of specific tasks by IDs using indexes — читаем файлы параллельно
      let rows: any[] = [];
      // Если выбрана организация — используем её индекс всегда
      if (inn) {
        try {
          const idxRaw = await readText(`.data/sales/${inn.replace(/\D/g,'')}/index.json`);
          rows = idxRaw ? JSON.parse(idxRaw) : [];
        } catch { rows = []; }
      } else {
        try { rows = await readUserIndex(userId); } catch { rows = []; }
      }
      const byTask = new Map<string, any>();
      for (const r of Array.isArray(rows) ? rows : []) byTask.set(String(r?.taskId), r);
      const ids = taskIdsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const paths = ids.map((id) => {
        const meta = byTask.get(String(id));
        if (!meta) return null;
        const innDigits = String((meta as any).inn || inn || '').replace(/\D/g,'');
        return innDigits ? `.data/sales/${innDigits}/sales/${String(meta.taskId)}.json` : null;
      }).filter(Boolean) as string[];
      const sales: any[] = [];
      const chunkSize = 24;
      for (let i = 0; i < paths.length; i += chunkSize) {
        const chunk = paths.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map(async (p) => {
          try {
            const raw = await readText(p);
            if (!raw) return null;
            const s = JSON.parse(raw);
            // Если режим "все данные" не включен — фильтруем по userId
            if (!showAll && s.userId !== userId) return null;
            return s;
          } catch { return null; }
        }));
        for (const r of results) { if (r.status === 'fulfilled' && r.value) sales.push(r.value); }
      }
      return NextResponse.json({ sales, nextCursor: null });
    }

    if (limit > 0 && !linkCode) {
      let rows: any[] = [];
      // Prefer org index when org is selected; fall back to user index
      if (inn) {
        try {
          const idxRaw = await readText(`.data/sales/${inn.replace(/\D/g,'')}/index.json`);
          rows = idxRaw ? JSON.parse(idxRaw) : [];
        } catch { rows = []; }
      } else {
        try { rows = await readUserIndex(userId); } catch { rows = []; }
      }
      rows = Array.isArray(rows) ? rows.slice() : [];
      rows = Array.isArray(rows) ? rows.slice() : [];
      // If filters provided, scan rows in order and short-circuit after page is filled
      if (hasAnyFilter) {
        rows.sort(compareRows);
        let startIndex = 0;
        if (cursorRaw) {
          const [ts, tid] = String(cursorRaw).split('|');
          const idx = rows.findIndex((r) => String((r as any)?.createdAt || '') === ts && String((r as any)?.taskId || '') === String(tid));
          if (idx >= 0) startIndex = idx + 1;
        }
        const page: any[] = [];
        const chunkSize = 24;
        for (let i = startIndex; i < rows.length && page.length < Math.max(1, limit || 50); i += chunkSize) {
          const slice = rows.slice(i, Math.min(rows.length, i + chunkSize));
          const results = await Promise.allSettled(slice.map(async (r) => {
            try {
              const d = String((r as any).inn || inn || '').replace(/\D/g,'');
              const p = d ? `.data/sales/${d}/sales/${String(r.taskId)}.json` : '';
              const raw = await readText(p);
              if (!raw) return null;
              const s = JSON.parse(raw);
              if (!showAll && s.userId !== userId) return null;
              if (onlySuccess) {
                const st = String(s.status || '').toLowerCase();
                if (!(st === 'paid' || st === 'transfered' || st === 'transferred')) return null;
              }
              return saleMatches(s) ? s : null;
            } catch { return null; }
          }));
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) page.push(r.value);
          }
        }
        // если страницу набрать не удалось (строгие фильтры) — продолжим сканирование ещё двумя чанками, чтобы не оставлять пользователя с 0 строк
        if (page.length === 0 && startIndex < rows.length) {
          const extraEnd = Math.min(rows.length, startIndex + (chunkSize * 3));
          for (let i = startIndex + chunkSize; i < extraEnd && page.length < Math.max(1, limit || 50); i += chunkSize) {
            const slice = rows.slice(i, Math.min(rows.length, i + chunkSize));
            const results = await Promise.allSettled(slice.map(async (r) => {
              try {
                const d = String((r as any).inn || inn || '').replace(/\D/g,'');
                const p = d ? `.data/sales/${d}/sales/${String(r.taskId)}.json` : '';
                const raw = await readText(p);
                if (!raw) return null;
                const s = JSON.parse(raw);
                if (!showAll && s.userId !== userId) return null;
                if (onlySuccess) {
                  const st = String(s.status || '').toLowerCase();
                  if (!(st === 'paid' || st === 'transfered' || st === 'transferred')) return null;
                }
                return saleMatches(s) ? s : null;
              } catch { return null; }
            }));
            for (const r of results) { if (r.status === 'fulfilled' && r.value) page.push(r.value); }
          }
        }
        const nextCursor = page.length > 0 ? `${String(page[page.length-1].createdAt)}|${String(page[page.length-1].taskId)}` : null;
        return NextResponse.json({ sales: page, nextCursor });
      } else {
        // default fast path (no filters): use index paging and read only page items
        rows.sort(compareRows);
        let start = 0;
        if (cursorRaw) {
          const [ts, tid] = String(cursorRaw).split('|');
          const idx = rows.findIndex((r) => String(r?.createdAt||'') === ts && String(r?.taskId||'') === String(tid));
          if (idx >= 0) start = idx + 1;
        }
        const pageRows = rows.slice(start, start + limit);
        const sales: any[] = [];
        for (const r of pageRows) {
          try {
            const d = String((r as any).inn || inn || '').replace(/\D/g,'');
            const p = d ? `.data/sales/${d}/sales/${String(r.taskId)}.json` : '';
            const raw = await readText(p);
            if (!raw) continue;
            const s = JSON.parse(raw);
            if (!showAll && s.userId !== userId) continue;
            sales.push(s);
          } catch {}
        }
        const nextCursor = (start + limit) < rows.length && pageRows.length > 0 ? `${String(pageRows[pageRows.length-1].createdAt)}|${String(pageRows[pageRows.length-1].taskId)}` : null;
        return NextResponse.json({ sales, nextCursor });
      }
    }

    // Fallback: full read then paginate/filter (legacy path)
    // Если выбрана организация — читаем все её продажи (для скорости), но ниже отфильтруем по userId при необходимости
    const allSales = inn ? await listAllSalesForOrg(inn) : await listSales(userId);
    let sales = inn ? allSales.filter((s: any) => String((s as any).orgInn || 'неизвестно') === inn || (s as any).orgInn == null || String((s as any).orgInn) === 'неизвестно') : allSales;
    if (!showAll) sales = sales.filter((s: any) => (s as any).userId === userId);
    if (linkCode) sales = sales.filter((s: any) => (s as any).linkCode === linkCode);
    if (onlySuccess) sales = sales.filter((s: any) => { const st = String((s as any)?.status || '').toLowerCase(); return st === 'paid' || st === 'transfered' || st === 'transferred'; });
    try {
      // Background: attempt instant email when receipts are ready
      // Fire-and-forget; do not await to keep API fast
      (async () => {
        try {
          const ready = sales.filter((s: any) => {
            const want = Boolean((s as any).itemsSnapshot && (s as any).isAgent ? ((s as any).additionalCommissionOfdUrl) : true);
            const hasPurchase = Boolean((s as any).ofdUrl || (s as any).ofdFullUrl);
            const needAgent = Boolean((s as any).isAgent);
            const hasAgent = needAgent ? Boolean((s as any).additionalCommissionOfdUrl) : true;
            const notSent = (s as any).instantEmailStatus !== 'sent' && (s as any).instantEmailStatus !== 'failed';
            return notSent && hasPurchase && hasAgent && want;
          });
          for (const s of ready) {
            try {
              const { sendInstantDeliveryIfReady } = await import('@/server/instantDelivery');
              await sendInstantDeliveryIfReady(userId, s);
            } catch {}
          }
        } catch {}
      })();
    } catch {}
    // Pagination: limit & cursor (createdAt|taskId)
    // These were already parsed above as limit/cursorRaw
    let page = sales;
    let nextCursor: string | null = null;
    if (limit > 0) {
      // ensure desc by createdAt then taskId desc
      const sorted = [...sales].sort((a: any, b: any) => {
        if (a.createdAt === b.createdAt) return String(a.taskId) < String(b.taskId) ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
      let start = 0;
      if (cursorRaw) {
        const [ts, tid] = cursorRaw.split('|');
        const idx = sorted.findIndex((s: any) => String(s.createdAt) === ts && String(s.taskId) === String(tid));
        if (idx >= 0) start = idx + 1;
      }
      page = sorted.slice(start, start + limit);
      if (start + limit < sorted.length && page.length > 0) {
        const last = page[page.length - 1] as any;
        nextCursor = `${String(last.createdAt)}|${String(last.taskId)}`;
      }
    }
    return NextResponse.json({ sales: page, nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => ({} as any));
    const taskId = body?.taskId;
    const hidden = body?.hidden;
    if (typeof taskId === 'undefined') return NextResponse.json({ error: 'NO_TASK' }, { status: 400 });
    await setSaleHidden(userId, taskId, Boolean(hidden));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


