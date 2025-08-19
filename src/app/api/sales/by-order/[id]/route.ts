import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';

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
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const idStr = decodeURIComponent(segs[segs.length - 1] || '');
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });
    const sales = await listSales(userId);
    const sale = sales.find((s) => s.orderId === orderId) || null;
    if (sale) {
      const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
      const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
      const patch: any = {};
      // If have ids but no URLs yet — query Ferma directly
      if (!sale.ofdUrl && sale.ofdPrepayId) {
        try {
          const st = await fermaGetReceiptStatus(sale.ofdPrepayId, { baseUrl, authToken: token });
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const fn = obj?.Data?.Fn || obj?.Fn;
          const fd = obj?.Data?.Fd || obj?.Fd;
          const fp = obj?.Data?.Fp || obj?.Fp;
          if (fn && fd != null && fp != null) { patch.ofdUrl = buildReceiptViewUrl(fn, fd, fp); }
        } catch {}
      }
      if (!sale.ofdFullUrl && sale.ofdFullId) {
        try {
          const st = await fermaGetReceiptStatus(sale.ofdFullId, { baseUrl, authToken: token });
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const fn = obj?.Data?.Fn || obj?.Fn;
          const fd = obj?.Data?.Fd || obj?.Fd;
          const fp = obj?.Data?.Fp || obj?.Fp;
          if (fn && fd != null && fp != null) { patch.ofdFullUrl = buildReceiptViewUrl(fn, fd, fp); }
        } catch {}
      }
      if (Object.keys(patch).length > 0) {
        try { await updateSaleOfdUrlsByOrderId(userId, orderId, patch); } catch {}
        // merge into local response
        (sale as any).ofdUrl = typeof patch.ofdUrl === 'string' ? patch.ofdUrl : sale.ofdUrl;
        (sale as any).ofdFullUrl = typeof patch.ofdFullUrl === 'string' ? patch.ofdFullUrl : sale.ofdFullUrl;
      }
    }
    if (!sale) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ sale }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


