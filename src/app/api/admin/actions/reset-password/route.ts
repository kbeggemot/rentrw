import { NextResponse } from 'next/server';
import { getUserById } from '@/server/userStore';
import { createResetToken } from '@/server/resetStore';
import { sendEmail } from '@/server/email';
import { renderPasswordResetEmail } from '@/server/emailTemplates';
import { writeText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

function makeBackUrl(req: Request, back?: string | null): string {
  try {
    const hdrProto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    if (back) {
      if (/^https?:\/\//i.test(back)) return back;
      if (hdrHost) return `${hdrProto}://${hdrHost}${back.startsWith('/') ? back : '/' + back}`;
      return back;
    }
    if (hdrHost) return `${hdrProto}://${hdrHost}/admin?tab=lk_users`;
    return '/admin?tab=lk_users';
  } catch { return '/admin?tab=lk_users'; }
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress (HTML form submits).
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const id = String(url.searchParams.get('id') || '').trim();
  const back = String(url.searchParams.get('back') || '').trim();
  if (!id) {
    const r = NextResponse.redirect(makeBackUrl(req, back), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Не указан пользователь' }), { path: '/' });
    try { r.headers.set('Cache-Control', 'no-store'); } catch {}
    return r;
  }
  try {
    const user = await getUserById(id);
    if (!user || !user.email) {
      const r = NextResponse.redirect(makeBackUrl(req, back), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'У пользователя не задан email' }), { path: '/' });
      try { r.headers.set('Cache-Control', 'no-store'); } catch {}
      return r;
    }
    const token = (await import('crypto')).randomBytes(24).toString('hex');
    const ttl = 1000 * 60 * 60 * 24;
    const hdrProto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const origin = process.env.NEXT_PUBLIC_BASE_URL || (hdrHost ? `${hdrProto}://${hdrHost}` : new URL(req.url).origin);
    const fullLink = `${origin}/auth/reset/${token}`;
    await createResetToken({ userId: user.id, email: user.email, token, expiresAt: Date.now() + ttl });
    const html = renderPasswordResetEmail({ resetUrl: fullLink, expiresHours: 24 });
    await sendEmail({ to: user.email, subject: 'Сброс пароля в YPLA', html });
    try { await writeText('.data/last_reset_email_admin.json', JSON.stringify({ userId: user.id, to: user.email, link: fullLink, ts: new Date().toISOString() }, null, 2)); } catch {}
    const r = NextResponse.redirect(makeBackUrl(req, back), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Письмо для сброса отправлено' }), { path: '/' });
    try { r.headers.set('Cache-Control', 'no-store'); } catch {}
    return r;
  } catch {
    const r = NextResponse.redirect(makeBackUrl(req, back), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Ошибка отправки письма' }), { path: '/' });
    try { r.headers.set('Cache-Control', 'no-store'); } catch {}
    return r;
  }
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const ct = req.headers.get('content-type') || '';
  let id='';
  let back='';
  try {
    if (ct.includes('application/json')) {
      const b = await req.json();
      id = String((b as any)?.id || '').trim();
      back = String((b as any)?.back || '').trim();
    } else {
      const fd = await req.formData();
      id = String(fd.get('id') || '').trim();
      back = String(fd.get('back') || '').trim();
    }
    if (!id) {
      const err = { error: 'MISSING_ID' };
      if (ct.includes('application/json')) return NextResponse.json(err, { status: 400 });
      const r = NextResponse.redirect(makeBackUrl(req, back), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Не указан пользователь' }), { path: '/' });
      return r;
    }
    const user = await getUserById(id);
    if (!user || !user.email) {
      if (ct.includes('application/json')) return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });
      const r = NextResponse.redirect(makeBackUrl(req, back), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'У пользователя не задан email' }), { path: '/' });
      return r;
    }
    const token = (await import('crypto')).randomBytes(24).toString('hex');
    const ttl = 1000 * 60 * 60 * 24;
    const hdrProto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const origin = process.env.NEXT_PUBLIC_BASE_URL || (hdrHost ? `${hdrProto}://${hdrHost}` : new URL(req.url).origin);
    const fullLink = `${origin}/auth/reset/${token}`;
    await createResetToken({ userId: user.id, email: user.email, token, expiresAt: Date.now() + ttl });
    const html = renderPasswordResetEmail({ resetUrl: fullLink, expiresHours: 24 });
    await sendEmail({ to: user.email, subject: 'Сброс пароля в YPLA', html });
    try { await writeText('.data/last_reset_email_admin.json', JSON.stringify({ userId: user.id, to: user.email, link: fullLink, ts: new Date().toISOString() }, null, 2)); } catch {}
    if (ct.includes('application/json')) return NextResponse.json({ ok: true });
    const r = NextResponse.redirect(makeBackUrl(req, back), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Письмо для сброса отправлено' }), { path: '/' });
    return r;
  } catch (e: any) {
    if (ct.includes('application/json')) return NextResponse.json({ error: e?.message || 'ERROR' }, { status: 500 });
    const r = NextResponse.redirect(makeBackUrl(req, back), 303);
    r.cookies.set('flash', JSON.stringify({ kind: 'error', msg: 'Ошибка отправки письма' }), { path: '/' });
    return r;
  }
}


