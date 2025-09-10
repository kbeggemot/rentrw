import { NextResponse } from 'next/server';
import { listAllPartnersForOrg, listPartners, listPartnersForOrg } from '@/server/partnerStore';
import { getSelectedOrgInn } from '@/server/orgContext';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    const items = inn ? (showAll ? await listAllPartnersForOrg(inn) : await listPartnersForOrg(userId, inn)) : await listPartners(userId);
    return NextResponse.json({ total: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


