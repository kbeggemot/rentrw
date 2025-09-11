import { NextResponse } from 'next/server';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';
import { listAllSales } from '@/server/taskStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = process.env.CRON_SECRET || '';
    if (!expected || token !== expected) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    // Optional: scoped run
    const userId = url.searchParams.get('userId') || undefined;
    const orderIdStr = url.searchParams.get('orderId') || undefined;
    const orderId = orderIdStr ? Number(orderIdStr) : undefined;

    if (userId) {
      await repairUserSales(userId, Number.isFinite(orderId as any) ? (orderId as any) : undefined);
    } else {
      const all = await listAllSales();
      const uids = Array.from(new Set(all.map((s: any) => s.userId)));
      for (const uid of uids) {
        try { await repairUserSales(uid, Number.isFinite(orderId as any) ? (orderId as any) : undefined); } catch {}
      }
    }
    try { startOfdRepairWorker(); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


