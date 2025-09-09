import { NextResponse } from 'next/server';
import { rebuildSalesIndexesFromLegacy } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';

export const runtime = 'nodejs';

async function requireSuperadmin(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  const username = m ? decodeURIComponent(m[1]) : null;
  if (!username) return null;
  try {
    const user = await getAdminByUsername(username);
    if (!user || user.role !== 'superadmin') return null;
    return username;
  } catch { return null; }
}

async function handle(req: Request) {
  const username = await requireSuperadmin(req);
  if (!username) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const { processed, errors } = await rebuildSalesIndexesFromLegacy();
  try { await appendAdminEntityLog('sale', ['rebuild-indexes'], { source: 'manual', message: 'rebuild', data: { processed, errors, by: username } }); } catch {}
  return NextResponse.json({ ok: true, processed, errors });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }


