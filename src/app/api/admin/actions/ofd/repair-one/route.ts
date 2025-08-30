import { NextResponse } from 'next/server';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';
import { getAdminByUsername } from '@/server/adminStore';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const admin = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!admin || admin.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const url = new URL(req.url);
    const userId = url.searchParams.get('user');
    const orderParam = url.searchParams.get('order');
    const orderId = orderParam ? Number(String(orderParam).replace(/[^0-9]/g, '')) : NaN;
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 400 });
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });

    await repairUserSales(userId, orderId);
    try { startOfdRepairWorker(); } catch {}
    return NextResponse.json({ ok: true, processed: [orderId] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


