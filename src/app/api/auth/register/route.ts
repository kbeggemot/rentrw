import { NextResponse } from 'next/server';
import { createUser, isEmailInUse } from '@/server/userStore';
import { upsertPending } from '@/server/registrationStore';
import { sendEmail } from '@/server/email';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone: string | undefined = body?.phone;
    const password: string | undefined = body?.password;
    const email: string | undefined = body?.email;
    if (!phone || !password || !email) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    // Флаг: требовать подтверждение email (по умолчанию выключено)
    const requireEmail = String(process.env.EMAIL_VERIFICATION_REQUIRED || '').trim() === '1';
    if (!requireEmail) {
      // упрощённая регистрация: без подтверждения email, сразу создаём пользователя
      if (await isEmailInUse(email)) {
        return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 400 });
      }
      const user = await createUser(phone, password, email);
      const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
      res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);
      return res;
    }

    // Требуем подтверждение email: отправляем код, сохраняем pending
    if (await isEmailInUse(email)) {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 400 });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await upsertPending({ phone, email, password, code, expiresAt: Date.now() + 15 * 60 * 1000 });
    try {
      await sendEmail({ to: email, subject: 'Подтверждение регистрации RentRW', text: `Код подтверждения: ${code}`, html: `<p>Код подтверждения: <b>${code}</b></p><p>Если вы не запрашивали регистрацию, проигнорируйте это письмо.</p>` });
      return NextResponse.json({ ok: true, step: 'confirm', phone, email });
    } catch {
      return NextResponse.json({ error: 'EMAIL_SEND_FAILED' }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


