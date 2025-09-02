import { NextResponse } from 'next/server';
import { getUserAgentSettings, updateUserAgentSettings } from '@/server/userStore';
import { getSelectedOrgInn } from '@/server/orgContext';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

function getOrgInnFromReq(req: Request): string | null {
  const hdrInn = req.headers.get('x-org-inn');
  if (hdrInn && hdrInn.trim().length > 0) return hdrInn.trim();
  return getSelectedOrgInn(req);
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const inn = getOrgInnFromReq(req);
    const s = await getUserAgentSettings(userId, inn || undefined);
    const res = NextResponse.json({ agentDescription: s.agentDescription, defaultCommission: s.defaultCommission });
    // Disable any caches along the way
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.headers.set('Pragma', 'no-cache');
    res.headers.set('Expires', '0');
    return res;
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
    const inn = getSelectedOrgInn(req);
    await updateUserAgentSettings(userId, { agentDescription, defaultCommission }, inn || undefined);
    const s = await getUserAgentSettings(userId, inn || undefined);
    const res = NextResponse.json({ agentDescription: s.agentDescription, defaultCommission: s.defaultCommission });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.headers.set('Pragma', 'no-cache');
    res.headers.set('Expires', '0');
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



