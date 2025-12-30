import { NextResponse } from 'next/server';
import { consumePending } from '@/server/registrationStore';
import { createUser, setUserEmailVerified } from '@/server/userStore';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  try {
    const bodyStr = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!bodyStr) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body: bodyStr });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone: string | undefined = body?.phone;
    const code: string | undefined = body?.code;
    if (!phone || !code) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const pending = await consumePending(phone, code);
    if (!pending) return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
    const user = await createUser(pending.phone, pending.password, pending.email);
    await setUserEmailVerified(user.id, true);
    const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
    res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);
    // Очистить выбранную организацию после подтверждения регистрации
    res.headers.append('Set-Cookie', `org_inn=; Path=/; Max-Age=0; SameSite=Lax`);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


