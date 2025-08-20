import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';
import { getInvoiceIdString } from '@/server/orderStore';

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
    const url = new URL(req.url);
    const onlyOrder = url.searchParams.get('order');
    const salesAll = await listSales(userId);
    const sales = onlyOrder ? salesAll.filter((s) => String(s.orderId) === String(onlyOrder)) : salesAll;
    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
    let updated = 0;
    for (const s of sales) {
      if (s.ofdFullUrl) continue;
      try {
        let st;
        if ((s as any).ofdFullId) {
          st = await fermaGetReceiptStatus((s as any).ofdFullId!, { baseUrl, authToken: tokenOfd });
        } else {
          const invoiceId = await getInvoiceIdString(s.orderId);
          st = await fermaGetReceiptStatus(invoiceId, { baseUrl, authToken: tokenOfd });
        }
        const obj = st.rawText ? JSON.parse(st.rawText) : {};
        const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
        const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
        const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
        if (url) {
          await updateSaleOfdUrlsByOrderId(userId, s.orderId, { ofdFullUrl: url });
          updated += 1;
        }
      } catch {}
    }
    return NextResponse.json({ ok: true, updated, processed: sales.map((x) => x.orderId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


