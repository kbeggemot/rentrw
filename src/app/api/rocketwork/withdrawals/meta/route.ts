import { NextResponse } from 'next/server';
import { listAllWithdrawalsForOrg, listWithdrawals } from '@/server/withdrawalStore';
import { getSelectedOrgInn } from '@/server/orgContext';

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
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    const items = inn && showAll ? await listAllWithdrawalsForOrg(inn) : await listWithdrawals(userId, inn || undefined);
    return NextResponse.json({ total: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


