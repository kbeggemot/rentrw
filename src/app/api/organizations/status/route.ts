import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('uid') || null;
    const orgParam = url.searchParams.get('org') || null;
    if (!userId) return NextResponse.json({ hasToken: false });

    // Fallback to cookie org if not provided
    const cookie = req.headers.get('cookie') || '';
    const mOrg = /(?:^|;\s*)org_inn=([^;]+)/.exec(cookie);
    const orgInn = orgParam || (mOrg ? decodeURIComponent(mOrg[1]) : null);

    let has = false;
    try {
      const { listActiveTokensForOrg } = await import('@/server/orgStore');
      if (orgInn) {
        const tokens = await listActiveTokensForOrg(orgInn, userId);
        has = tokens.length > 0;
      }
    } catch {}
    return NextResponse.json({ hasToken: has });
  } catch {
    return NextResponse.json({ hasToken: false });
  }
}


