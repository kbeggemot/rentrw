import { NextResponse } from 'next/server';
import { ensureRootAdmin, validateAdmin } from '@/server/adminStore';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

function setCookie(res: NextResponse, name: string, value: string, opts?: { maxAge?: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts?.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.headers.append('Set-Cookie', parts.join('; '));
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  // Accept JSON payload via header x-fallback-payload (base64 JSON) and route through POST logic.
  try {
    const body = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!body) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureRootAdmin();
    const body = await req.json().catch(() => ({} as any));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    const u = await validateAdmin(username, password);
    if (!u) return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
    const res = NextResponse.json({ ok: true });
    setCookie(res, 'admin_user', username, { maxAge: 60 * 60 * 12 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', 'admin_user=; Path=/; Max-Age=0; SameSite=Lax');
  return res;
}


