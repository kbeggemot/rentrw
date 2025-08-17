import { NextResponse } from 'next/server';
import { findUserByPhoneLoose, verifyPassword } from '@/server/userStore';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phoneRaw: string | undefined = body?.phone;
    const passwordRaw: string | undefined = body?.password;
    const phone = (phoneRaw ?? '').trim();
    const password = (passwordRaw ?? '').trim();
    if (!phone || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const user = await findUserByPhoneLoose(phone);
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const ok = verifyPassword(password, user.passSalt, user.passHash);
    if (!ok) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
    res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


