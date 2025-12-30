import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { startOfdScheduleWorker, runDueOffsetJobs } from '@/server/ofdScheduleWorker';
import { readFallbackJsonBody } from '@/server/getFallback';

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
    try { startOfdScheduleWorker(); } catch {}
    try { await runDueOffsetJobs(); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  try {
    const body = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!body) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


