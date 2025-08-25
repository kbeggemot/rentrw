import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { listAllSales } from '@/server/taskStore';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    // Run immediate repair for all users once
    try {
      const all = await listAllSales();
      const uids = Array.from(new Set(all.map((s) => s.userId)));
      await Promise.all(uids.map((u) => repairUserSales(u).catch(() => void 0)));
    } catch {}
    // Ensure background worker is running
    try { startOfdRepairWorker(); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


