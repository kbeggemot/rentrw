import { NextResponse } from 'next/server';
import { validateUser } from '@/server/userStore';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone: string | undefined = body?.phone;
    const password: string | undefined = body?.password;
    if (!phone || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const user = await validateUser(phone, password);
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
    res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


