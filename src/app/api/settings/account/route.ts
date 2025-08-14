import { NextResponse } from 'next/server';
import { getUserById } from '@/server/userStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const user = await getUserById(userId);
    return NextResponse.json({ phone: user?.phone ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



