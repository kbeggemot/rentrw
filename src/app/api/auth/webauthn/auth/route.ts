import { NextResponse } from 'next/server';
import { startAuth, finishAuth, startLoginAnonymous, finishLoginAnonymous } from '@/server/webauthn';
import { randomBytes } from 'crypto';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  try {
    const bodyStr = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!bodyStr) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body: bodyStr });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  const url = new URL(req.url);
  const hdrOrigin = req.headers.get('origin') || undefined;
  const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const hdrProto = req.headers.get('x-forwarded-proto') || (hdrOrigin ? new URL(hdrOrigin).protocol.replace(':','') : 'http');
  const computedOrigin = hdrOrigin || `${hdrProto}://${hdrHost}`;
  const computedRpID = hdrHost.split(':')[0];
  const { options, rpID, origin } = userId ? await startAuth(userId, { rpID: computedRpID, origin: computedOrigin }) : await startLoginAnonymous({ rpID: computedRpID, origin: computedOrigin });
  // Ensure options are JSON-serializable strings for IDs
  try {
    const toB64 = (v: any): string | undefined => {
      if (typeof v === 'string') return v;
      if (v && ArrayBuffer.isView(v)) return Buffer.from(v as Uint8Array).toString('base64url');
      if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v)).toString('base64url');
      return undefined;
    };
    let ch = toB64((options as any).challenge);
    if (!ch || ch.length === 0) ch = randomBytes(32).toString('base64url');
    (options as any).challenge = ch;
    if (Array.isArray((options as any).allowCredentials)) {
      (options as any).allowCredentials = (options as any).allowCredentials
        .map((c: any) => ({ ...c, id: toB64(c?.id), type: c?.type || 'public-key' }))
        .filter((c: any) => typeof c.id === 'string' && c.id.length > 0);
      if ((options as any).allowCredentials.length === 0) delete (options as any).allowCredentials;
    }
  } catch {}
  return NextResponse.json({ options, rpID, origin });
}

export async function PUT(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  const body = await req.json().catch(() => null);
  const { response, rpID, origin } = body || {};
  if (!response || !rpID || !origin) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  if (!userId) {
    const resAnon = await finishLoginAnonymous(response, rpID, origin);
    const out = NextResponse.json(resAnon, { status: resAnon.verified ? 200 : 400 });
    if (resAnon.verified && resAnon.userId) {
      out.headers.set('Set-Cookie', `session_user=${encodeURIComponent(resAnon.userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);
    }
    return out;
  } else {
    const resUser = await finishAuth(userId, response, rpID, origin);
    return NextResponse.json(resUser, { status: resUser.verified ? 200 : 400 });
  }
}


