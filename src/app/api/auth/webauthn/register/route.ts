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
  const url = new URL(req.url);
  const hdrOrigin = req.headers.get('origin') || undefined;
  const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const hdrProto = req.headers.get('x-forwarded-proto') || (hdrOrigin ? new URL(hdrOrigin).protocol.replace(':','') : 'http');
  const computedOrigin = hdrOrigin || `${hdrProto}://${hdrHost}`;
  const computedRpID = hdrHost.split(':')[0];
  const { options, rpID, origin } = await startRegistration(user, { rpID: computedRpID, origin: computedOrigin });
  // Ограничим только платформенными аутентификаторами и потребуем residentKey/userVerification
  try {
    (options as any).authenticatorSelection = { userVerification: 'required', residentKey: 'required', authenticatorAttachment: 'platform' };
  } catch {}
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


