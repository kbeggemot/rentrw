import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const url = new URL(req.url);
    const orderParam = url.searchParams.get('order');
    if (!orderParam) return NextResponse.json({ error: 'NO_ORDER' }, { status: 400 });
    const orderId = Number(orderParam);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });

    const sale = (await listSales(userId)).find((s) => Number(s.orderId) === Number(orderId));
    if (!sale) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    let changed = false;
    if (sale.ofdUrl && sale.ofdFullUrl && sale.ofdUrl === sale.ofdFullUrl) {
      try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
      await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: null });
      changed = true;
    }
    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


