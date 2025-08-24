import { NextResponse } from 'next/server';
import { listUserOrganizations, getMaskedTokenForOrg } from '@/server/orgStore';

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
    const orgs = await listUserOrganizations(userId);
    // attach masked token presence for each org to show banner logic on client
    const enriched = await Promise.all(orgs.map(async (o) => ({ ...o, maskedToken: await getMaskedTokenForOrg(o.inn, userId) })));
    return NextResponse.json({ items: enriched }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null) as { inn?: string } | null;
    const inn = (body?.inn || '').replace(/\D/g, '');
    if (!inn) return NextResponse.json({ error: 'NO_INN' }, { status: 400 });
    // Set cookie to select active org context
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.headers.set('Set-Cookie', `org_inn=${encodeURIComponent(inn)}; Path=/; SameSite=Lax; Max-Age=31536000`);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Public status endpoint: check if user/org has any active token. Accepts either cookie org or ?uid
export async function OPTIONS() { return NextResponse.json({ ok: true }); }

export async function PUT(req: Request) { return NextResponse.json({ error: 'NOT_ALLOWED' }, { status: 405 }); }

export async function DELETE(req: Request) { return NextResponse.json({ error: 'NOT_ALLOWED' }, { status: 405 }); }

export async function PATCH(req: Request) { return NextResponse.json({ error: 'NOT_ALLOWED' }, { status: 405 }); }

export async function HEAD(req: Request) { return NextResponse.json({ ok: true }); }

export async function POST_status() {}

export async function GET_status(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('uid') || ((): string | null => {
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
      return m ? decodeURIComponent(m[1]) : null;
    })();
    if (!userId) return NextResponse.json({ hasToken: false });
    const orgFromQuery = url.searchParams.get('org') || null;
    const orgCookie = ((): string | null => {
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(cookie);
      return m ? decodeURIComponent(m[1]) : null;
    })();
    let has = false;
    try {
      const { getTokenForOrg, listActiveTokensForOrg } = await import('@/server/orgStore');
      const targetOrg = orgFromQuery || orgCookie;
      if (targetOrg) {
        const tokens = await listActiveTokensForOrg(targetOrg, userId);
        has = tokens.length > 0;
      }
    } catch {}
    return NextResponse.json({ hasToken: has });
  } catch (e) {
    return NextResponse.json({ hasToken: false });
  }
}


