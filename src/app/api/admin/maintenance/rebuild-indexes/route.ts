import { NextResponse } from 'next/server';
import { rebuildSalesIndexesFromLegacy } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';

export const runtime = 'nodejs';

function isAuthedSuperadmin(req: Request): boolean {
  try {
    const cookie = req.headers.get('cookie') || '';
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
    const username = m ? decodeURIComponent(m[1]) : null;
    if (!username) return false;
    // sync wait for user
    const user = (global as any).__ADMIN_CACHE__?.[username];
    if (user && user.role === 'superadmin') return true;
  } catch {}
  return false;
}

export async function POST(req: Request) {
  try {
    // Check superadmin with server lookup
    const cookie = req.headers.get('cookie') || '';
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
    const username = m ? decodeURIComponent(m[1]) : null;
    if (!username) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const user = await getAdminByUsername(username);
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const { processed, errors } = await rebuildSalesIndexesFromLegacy();
    try { await appendAdminEntityLog('sale', ['rebuild-indexes'], { source: 'manual', message: 'rebuild', data: { processed, errors, by: username } }); } catch {}
    return NextResponse.json({ ok: true, processed, errors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


