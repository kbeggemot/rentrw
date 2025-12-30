import { NextResponse } from 'next/server';
import { listUserOrganizations, getMaskedTokenForOrg } from '@/server/orgStore';
import { readFallbackJsonBody } from '@/server/getFallback';

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
    // Fallback: allow POST via GET (when ?via=get and x-fallback-payload provided)
    try {
      const url = new URL(req.url);
      if (url.searchParams.get('via') === 'get') {
        const bodyStr = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
        if (!bodyStr) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
        const headers = new Headers(req.headers);
        headers.set('content-type', 'application/json');
        try { headers.delete('content-length'); } catch {}
        const req2 = new Request(url.toString(), { method: 'POST', headers, body: bodyStr });
        const res = await POST(req2);
        try { res.headers.set('Cache-Control', 'no-store'); } catch {}
        return res;
      }
    } catch {}
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


