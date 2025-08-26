import { NextResponse } from 'next/server';
import { appendWithdrawalLog, updateWithdrawal } from '@/server/withdrawalStore';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

function makeBackUrl(req: Request, path: string): string {
  try {
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    if (!host) return path;
    const rel = path.startsWith('/') ? path : '/' + path;
    return `${proto}://${host}${rel}`;
  } catch { return path; }
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const fd = await req.formData();
  const userId = String(fd.get('userId') || '').trim();
  const taskId = String(fd.get('taskId') || '').trim();
  const back = String(fd.get('back') || `/admin/withdrawals/${encodeURIComponent(taskId)}`);
  if (!userId || !taskId) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  // Trigger regular status check endpoint; reuse existing logic
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const base = `${proto}://${host}`;
  const url = `${base}/api/rocketwork/withdrawal-status/${encodeURIComponent(taskId)}`;
  try {
    const r = await fetch(url, { cache: 'no-store', headers: { cookie: req.headers.get('cookie') || '' } });
    const d = await r.json().catch(()=>({}));
    await appendWithdrawalLog(userId, taskId, `manual refresh -> ${JSON.stringify(d)}`, 'manual');
  } catch {}
  const res = NextResponse.redirect(makeBackUrl(req, back), 303);
  res.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Статус обновлён' }), { path: '/' });
  return res;
}


