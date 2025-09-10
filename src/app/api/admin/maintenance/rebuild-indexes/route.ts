import { NextResponse } from 'next/server';
// Fallback: dynamic import of helper to avoid hard compile dependency
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
  let processed = 0, errors = 0;
  try {
    const mod = await import('@/server/taskStore');
    const fn = (mod as any).rebuildSalesIndexesFromLegacy as (()=>Promise<{processed:number;errors:number}>) | undefined;
    if (typeof fn === 'function') {
      const res = await fn();
      processed = res?.processed ?? 0; errors = res?.errors ?? 0;
    } else {
      // Not available in this build
      return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 501 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'LOAD_ERROR' }, { status: 500 });
  }
  try { await appendAdminEntityLog('sale', ['rebuild-indexes'], { source: 'manual', message: 'rebuild', data: { processed, errors, by: username } }); } catch {}
  return NextResponse.json({ ok: true, processed, errors });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }


