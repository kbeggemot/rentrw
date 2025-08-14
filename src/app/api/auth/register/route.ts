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
    // Step 1: ensure email unique across users
    if (await isEmailInUse(email)) {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 400 });
    }
    // Step 2: send code and store pending
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await upsertPending({ phone, email, password, code, expiresAt: Date.now() + 15 * 60 * 1000 });
    const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
    await sendEmail({ to: email, subject: 'Подтверждение регистрации RentRW', text: `Код подтверждения: ${code}`, html: `<p>Код подтверждения: <b>${code}</b></p><p>Если вы не запрашивали регистрацию, проигнорируйте это письмо.</p>` });
    return NextResponse.json({ ok: true, step: 'confirm', phone, email });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


