import { NextResponse } from 'next/server';
import { getUserAgentSettings, updateUserAgentSettings } from '@/server/userStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const s = await getUserAgentSettings(userId);
    return NextResponse.json({ agentDescription: s.agentDescription, defaultCommission: s.defaultCommission });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const agentDescription: string | undefined = body?.agentDescription;
    const defaultCommission: { type: 'percent' | 'fixed'; value: number } | undefined = body?.defaultCommission;
    if (defaultCommission && (defaultCommission.type !== 'percent' && defaultCommission.type !== 'fixed')) {
      return NextResponse.json({ error: 'INVALID_COMMISSION' }, { status: 400 });
    }
    await updateUserAgentSettings(userId, { agentDescription, defaultCommission });
    const s = await getUserAgentSettings(userId);
    return NextResponse.json({ agentDescription: s.agentDescription, defaultCommission: s.defaultCommission });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


