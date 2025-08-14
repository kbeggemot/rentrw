import { NextResponse } from 'next/server';
import { getUserById, updateUserEmail } from '@/server/userStore';

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
    return NextResponse.json({ email: masked });
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
    const email: string | undefined = body?.email;
    if (!email || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 });
    }
    await updateUserEmail(userId, email);
    return NextResponse.json({ email: maskEmail(email) }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



