import { NextResponse } from 'next/server';
import { getUserById, updateUserEmail } from '@/server/userStore';
import { sendEmail } from '@/server/email';
import { promises as fs } from 'fs';
import path from 'path';

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
    let targetEmail: string | null = null;
    if (incoming) {
      if (!/.+@.+\..+/.test(incoming)) {
        return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 });
      }
      targetEmail = incoming.trim();
      await updateUserEmail(userId, targetEmail);
    } else {
      const user = await getUserById(userId);
      targetEmail = user?.email ?? null;
      if (!targetEmail) return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });
    }
    // issue verification code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const dataDir = path.join(process.cwd(), '.data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, `email_code_${userId}.txt`), JSON.stringify({ email: targetEmail, code, ts: Date.now() }), 'utf8');
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const ui = base ? `${base}/settings` : '/settings';
    await sendEmail({
      to: targetEmail!,
      subject: 'Подтверждение e-mail в RentRW',
      text: `Ваш код подтверждения: ${code}\n\nВведите его на странице настроек: ${ui}`,
    });
    return NextResponse.json({ email: maskEmail(targetEmail!), verification: 'sent' }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



