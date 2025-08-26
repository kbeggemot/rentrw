import { NextResponse } from 'next/server';
import { updateOrgPayoutRequisites } from '@/server/orgStore';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

function makeBackUrl(req: Request, path: string): string {
  try {
    const proto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    if (!host) return path;
    const rel = path.startsWith('/') ? path : '/' + path;
    return `${proto}://${host}${rel}`;
  } catch { return path; }
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const fd = await req.formData();
  const inn = String(fd.get('inn') || '').replace(/\D/g, '');
  if (!inn) return NextResponse.json({ error: 'NO_INN' }, { status: 400 });
  await updateOrgPayoutRequisites(inn, { bik: null, account: null });
  const r = NextResponse.redirect(makeBackUrl(req, `/admin/orgs/${encodeURIComponent(inn)}`), 303);
  r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Реквизиты удалены' }), { path: '/' });
  return r;
}


