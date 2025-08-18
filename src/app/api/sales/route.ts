import { NextResponse } from 'next/server';
import { listSales, updateSaleFromStatus, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { getDecryptedApiToken } from '@/server/secureStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus } from '@/server/ofdFerma';

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
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const urlObj = new URL(req.url);
    const shouldRefresh = urlObj.searchParams.get('refresh') === '1';
    if (shouldRefresh) {
      const token = await getDecryptedApiToken(userId);
      if (token) {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const current = await listSales(userId);
        // Decide which sales to refresh
        const toRefresh = current.filter((s) => {
          const st = (s.status || '').toLowerCase();
          // a) always refresh pending, paying, paid
          const needA = st === 'pending' || st === 'paying' || st === 'paid';
          // b) refresh transferred/transfered only if receipts are missing
          const missingReceipts = !s.ofdUrl || (s.isAgent && (!s.additionalCommissionOfdUrl || !s.npdReceiptUri));
          const needB = (st === 'transferred' || st === 'transfered') && missingReceipts;
          return needA || needB;
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
            await updateSaleFromStatus(userId, s.taskId, { status: normalized?.acquiring_order?.status, ofdUrl, additionalCommissionOfdUrl: addOfd, npdReceiptUri: npdReceipt });

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
                    if (fn && fd != null && fp != null) {
                      patch.ofdUrl = `https://check-demo.ofd.ru/rec/${encodeURIComponent(fn)}/${encodeURIComponent(String(fd))}/${encodeURIComponent(String(fp))}`;
                    }
                  } catch {}
                }
                if (!s.ofdFullUrl && (s as any).ofdFullId) {
                  const st = await fermaGetReceiptStatus((s as any).ofdFullId, { baseUrl, authToken: tokenOfd });
                  try {
                    const obj = st.rawText ? JSON.parse(st.rawText) : {};
                    const fn = obj?.Data?.Fn || obj?.Fn;
                    const fd = obj?.Data?.Fd || obj?.Fd;
                    const fp = obj?.Data?.Fp || obj?.Fp;
                    if (fn && fd != null && fp != null) {
                      patch.ofdFullUrl = `https://check-demo.ofd.ru/rec/${encodeURIComponent(fn)}/${encodeURIComponent(String(fd))}/${encodeURIComponent(String(fp))}`;
                    }
                  } catch {}
                }
                if (Object.keys(patch).length > 0) {
                  await updateSaleOfdUrlsByOrderId(userId, s.orderId, patch);
                }
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


