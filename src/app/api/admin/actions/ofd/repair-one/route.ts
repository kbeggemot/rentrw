import { NextResponse } from 'next/server';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const url = new URL(req.url);
    const userId = url.searchParams.get('user');
    const orderParam = url.searchParams.get('order');
    const orderId = orderParam ? Number(orderParam) : NaN;
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 400 });
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });
    await repairUserSales(userId, orderId);
    try { startOfdRepairWorker(); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


