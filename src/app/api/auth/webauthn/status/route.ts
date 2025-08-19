import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';
import { getUserById } from '@/server/userStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const raw = await readText('.data/webauthn_creds.json');
    const data = raw ? JSON.parse(raw || '{}') : {};
    const hasAny = Array.isArray(data?.[userId]) && data[userId].length > 0;
    const u = await getUserById(userId);
    const optOut = !!u?.webauthnOptOut;
    return NextResponse.json({ hasAny, optOut });
  } catch {
    return NextResponse.json({ hasAny: false, optOut: false });
  }
}


