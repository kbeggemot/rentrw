import { NextResponse } from 'next/server';
import { getUserById, updateUserEmail } from '@/server/userStore';
import { sendEmail } from '@/server/email';
import { writeText } from '@/server/storage';

export const runtime = 'nodejs';

function maskEmail(email: string): string {
  const [local, domainFull] = email.split('@');
  if (!domainFull) return email;
  const [domain, ...rest] = domainFull.split('.');
  const tld = rest.join('.');
  const localMasked = local.length <= 2 ? local[0] + '*' : local[0] + '*'.repeat(Math.max(1, local.length - 2)) + local[local.length - 1];
  const domainMasked = domain.length <= 2 ? domain[0] + '*' : domain[0] + '*'.repeat(Math.max(1, domain.length - 2)) + domain[domain.length - 1];
  return tld ? `${localMasked}@${domainMasked}.${tld}` : `${localMasked}@${domainMasked}`;
}

export async function GET(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const user = await getUserById(userId);
    const masked = user?.email ? maskEmail(user.email) : null;
    return NextResponse.json({ email: masked, verified: !!user?.emailVerified });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const body = await req.json().catch(() => null);
    const incoming: string | undefined = body?.email;
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const isMasked = (v: string) => v.includes('*');
    let targetEmail: string | null = null;
    if (incoming) {
      const candidate = String(incoming).trim();
      if (isMasked(candidate)) {
        return NextResponse.json({ error: 'MASKED_EMAIL' }, { status: 400 });
      }
      if (!emailRegex.test(candidate)) {
        return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 });
      }
      targetEmail = candidate;
      await updateUserEmail(userId, candidate);
    } else {
      const user = await getUserById(userId);
      targetEmail = user?.email ?? null;
      if (!targetEmail) return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });
      if (isMasked(targetEmail) || !emailRegex.test(targetEmail)) {
        return NextResponse.json({ error: 'MASKED_EMAIL' }, { status: 400 });
      }
    }
    // issue verification code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await writeText(`.data/email_code_${userId}.txt`, JSON.stringify({ email: targetEmail, code, ts: Date.now() }));
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const ui = base ? `${base}/settings` : '/settings';
    try {
      await sendEmail({
        to: targetEmail!,
        subject: 'Подтверждение email в RentRW',
        text: `Ваш код подтверждения: ${code}\n\nЕсли вы его не запрашивали, просто проигнорируйте это письмо.`,
      });
    } catch (e) {
      return NextResponse.json({ error: 'EMAIL_SEND_FAILED', debug: {
        host: process.env.SMTP_HOST ? 'set' : 'missing',
        port: process.env.SMTP_PORT ? 'set' : 'missing',
        secure: process.env.SMTP_SECURE ?? 'unset',
        user: process.env.SMTP_USER ? 'set' : 'missing',
        from: process.env.SMTP_FROM ? 'set' : 'missing',
      } }, { status: 502 });
    }
    return NextResponse.json({ email: maskEmail(targetEmail!), verification: 'sent', debug: {
      host: process.env.SMTP_HOST ? 'set' : 'missing',
      port: process.env.SMTP_PORT ? 'set' : 'missing',
      secure: process.env.SMTP_SECURE ?? 'unset',
      user: process.env.SMTP_USER ? 'set' : 'missing',
      from: process.env.SMTP_FROM ? 'set' : 'missing',
    } }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



