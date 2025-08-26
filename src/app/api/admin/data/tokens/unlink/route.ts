import { NextResponse } from 'next/server';
import { removeUserFromOrgToken } from '@/server/orgStore';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const ct = req.headers.get('content-type') || '';
  let inn='', fp='', userId='', back='', confirm='';
  if (ct.includes('application/json')) {
    const b = await req.json().catch(()=>({} as any));
    inn = String((b as any)?.inn || '').trim();
    fp = String((b as any)?.fingerprint || '').trim();
    userId = String((b as any)?.userId || '').trim();
    back = String((b as any)?.back || '').trim();
    confirm = String((b as any)?.confirm || '').trim();
  } else {
    const fd = await req.formData();
    inn = String(fd.get('inn') || '').trim();
    fp = String(fd.get('fingerprint') || '').trim();
    userId = String(fd.get('userId') || '').trim();
    back = String(fd.get('back') || '').trim();
    confirm = String(fd.get('confirm') || '').trim();
  }
  if (!inn || !fp || !userId) {
    if (ct.includes('application/json')) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const r = NextResponse.redirect(makeBackUrl(req, back || '/admin?tab=tokens'), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Не хватает полей (inn, fingerprint, userId)' }), { path: '/' });
    return r;
  }
  if (confirm !== 'yes') {
    if (ct.includes('application/json')) return NextResponse.json({ error: 'CONFIRM_REQUIRED' }, { status: 400 });
    const r = NextResponse.redirect(makeBackUrl(req, back || '/admin?tab=tokens'), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Нужно подтверждение удаления' }), { path: '/' });
    return r;
  }
  const ok = await removeUserFromOrgToken(inn, fp, userId);

  if (ct.includes('application/json')) return NextResponse.json({ ok });
  const r = NextResponse.redirect(makeBackUrl(req, back || '/admin?tab=tokens'), 303);
  r.cookies.set('flash', JSON.stringify({ kind: ok ? 'success' : 'error', msg: ok ? 'Токен отвязан' : 'Нечего отвязывать' }), { path: '/' });
  return r;
}

function makeBackUrl(req: Request, back: string): string {
  try {
    if (back && /^https?:\/\//i.test(back)) return back;
    const h = req.headers;
    const proto = h.get('x-forwarded-proto') || 'https';
    const host = h.get('x-forwarded-host') || h.get('host') || '';
    const path = back || (req.headers.get('referer') || '/admin?tab=tokens');
    if (!host) return path; // relative fallback
    const rel = path.startsWith('/') ? path : new URL(path).pathname;
    return `${proto}://${host}${rel}`;
  } catch {
    return back || '/admin?tab=tokens';
  }
}


