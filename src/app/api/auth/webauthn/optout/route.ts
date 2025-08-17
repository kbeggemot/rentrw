import { NextResponse } from 'next/server';
import { setWebauthnOptOut } from '@/server/userStore';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const value = !!body?.optOut;
  await setWebauthnOptOut(userId, value);
  return NextResponse.json({ ok: true, optOut: value });
}


