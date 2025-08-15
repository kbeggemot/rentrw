import { NextResponse } from 'next/server';
import { getUserById } from '@/server/userStore';
import { startRegistration, finishRegistration } from '@/server/webauthn';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { options, rpID, origin } = await startRegistration(user);
  try { console.log('webauthn.register.options', { hasChallenge: !!(options as any)?.challenge, userId: (options as any)?.user?.id, exclude: (options as any)?.excludeCredentials?.length }); } catch {}
  const res = NextResponse.json({ options, rpID, origin });
  res.headers.append('Set-Cookie', 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000');
  return res;
}

export async function PUT(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  const body = await req.json().catch(() => null);
  const { response, rpID, origin } = body || {};
  if (!userId || !response || !rpID || !origin) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const res = await finishRegistration(userId, response, rpID, origin);
  return NextResponse.json(res, { status: res.verified ? 200 : 400 });
}


