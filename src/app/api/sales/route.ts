import { NextResponse } from 'next/server';
import { listSales, updateSaleFromStatus, updateSaleOfdUrlsByOrderId, setSaleCreatedAtRw, setSaleHidden } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { getDecryptedApiToken } from '@/server/secureStore';
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
    if (shouldRefresh) {
      const token = await getDecryptedApiToken(userId);
      if (token) {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        // Берём только продажи, инициированные нашим UI (source === 'ui')
        const current = (await listSales(userId)).filter((s: any) => (s as any).source === 'ui');
        // Decide which sales to refresh
        const toRefresh = current.filter((s) => {
          const st = (s.status || '').toLowerCase();
          // a) always refresh pending, paying, paid
          const needA = st === 'pending' || st === 'paying' || st === 'paid';
          // b) refresh transferred/transfered only if receipts are missing
          const missingReceipts = (!s.ofdUrl && !s.ofdFullUrl) || (s.isAgent && (!s.additionalCommissionOfdUrl || !s.npdReceiptUri));
          const needB = (st === 'transferred' || st === 'transfered') && missingReceipts;
          // c) also refresh any sale that lacks createdAtRw to retrieve RW creation time
          const needC = !s.createdAtRw;
          return needA || needB || needC;
        });
        for (const s of toRefresh) {
          try {
            const taskUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            let res = await fetch(taskUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            let text = await res.text();
            let data: unknown = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = text; }
            let normalized: RocketworkTask = (data && typeof data === 'object' && 'task' in (data as Record<string, unknown>)) ? ((data as any).task as RocketworkTask) : (data as RocketworkTask);
            // In case a sale is missing for an externally created task, ensure presence
            try { const { ensureSaleFromTask } = await import('@/server/taskStore'); await ensureSaleFromTask({ userId, taskId: s.taskId, task: normalized as any }); } catch {}
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
              const createdAt = (normalized as any)?.created_at || s.createdAtRw || s.createdAt;
              const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
              const endStr = (s.serviceEndDate || '') as string;
              if (createdDate && endStr && createdDate === endStr) patch.ofdFullUrl = ofdUrl; else patch.ofdUrl = ofdUrl;
            }
            await updateSaleFromStatus(userId, s.taskId, patch);
            // Force-exclusive placement: if we classified RW ofd_url, clear the opposite column
            if (ofdUrl) {
              try { (global as any).__OFD_SOURCE__ = 'refresh'; } catch {}
              try {
                const createdAt = (normalized as any)?.created_at || s.createdAtRw || s.createdAt;
                const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
                const endStr = (s.serviceEndDate || '') as string;
                if (createdDate && endStr && createdDate === endStr) {
                  await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullUrl: ofdUrl, ofdUrl: null });
                } else {
                  await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdUrl: ofdUrl, ofdFullUrl: null });
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
              // If agent and transferred, but no NPD receipt yet, keep trying (trigger pay)
              if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed' && !npdReceipt) {
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
                if (!s.ofdFullUrl && (s as any).ofdFullId) {
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
                  await updateSaleOfdUrlsByOrderId(userId, s.orderId, patch);
                }
              }
              // Fallback: try by InvoiceId when a receipt link is missing
              if (!s.ofdFullUrl || !s.ofdUrl) {
                try {
                  const { getInvoiceIdString } = await import('@/server/orderStore');
                  const invoiceIdFull = await getInvoiceIdString(s.orderId);
                  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
                  const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
                  const st = await fermaGetReceiptStatus(invoiceIdFull, { baseUrl, authToken: tokenOfd });
                  const obj = st.rawText ? JSON.parse(st.rawText) : {};
                  const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                  const rid = obj?.Data?.ReceiptId as string | undefined;
                  const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
                  const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
                  if (url) {
                    const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
                    const endStr = (s.serviceEndDate || '') as string;
                    // если дата окончания услуги уже наступила (<= сегодня по МСК) — считаем это полным расчётом
                    const isFull = endStr && endStr <= mskToday;
                    const patch2: any = {};
                    if (isFull) { patch2.ofdFullUrl = url; if (rid) patch2.ofdFullId = rid; }
                    else { patch2.ofdUrl = url; if (rid) patch2.ofdPrepayId = rid; }
                    await updateSaleOfdUrlsByOrderId(userId, s.orderId, patch2);
                  }
                } catch {}
              }
            } catch {}
          } catch {}
        }
      }
    }
    const sales = await listSales(userId);
    return NextResponse.json({ sales });
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


