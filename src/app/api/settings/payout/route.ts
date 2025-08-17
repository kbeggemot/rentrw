import { NextResponse } from 'next/server';
import { getUserPayoutRequisites, updateUserPayoutRequisites } from '@/server/userStore';

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
    const reqs = await getUserPayoutRequisites(userId);
    return NextResponse.json({ bik: reqs.bik, account: reqs.account, orgName: reqs.orgName });
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
    const bik: string | undefined = body?.bik;
    const account: string | undefined = body?.account;
    if (typeof bik === 'undefined' && typeof account === 'undefined') {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
    }
    await updateUserPayoutRequisites(userId, { bik, account });
    const reqs = await getUserPayoutRequisites(userId);
    return NextResponse.json({ bik: reqs.bik, account: reqs.account, orgName: reqs.orgName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


