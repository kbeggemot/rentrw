import { NextResponse } from 'next/server';
import { getMaskedToken, saveApiToken, deleteApiToken, getDecryptedApiToken } from '@/server/secureStore';
import { setUserOrgName } from '@/server/userStore';
import { enqueueSubscriptionJob, ensureSubscriptions, startSubscriptionWorker } from '@/server/subscriptionWorker';

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
    const masked = await getMaskedToken(userId);
    return NextResponse.json({ token: masked });
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
    const token: string | undefined = body?.token;
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }
    // 1) Validate token against account endpoint BEFORE saving subscriptions
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    try {
      const ping = await fetch(new URL('account', base.endsWith('/') ? base : base + '/').toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (ping.status === 401) {
        return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
      }
      if (!ping.ok) {
        return NextResponse.json({ error: 'TECH_ERROR' }, { status: 502 });
      }
    } catch {
      return NextResponse.json({ error: 'TECH_ERROR' }, { status: 502 });
    }

    // 2) Save token (it's valid)
    await saveApiToken(userId, token);
    // After saving token, ensure Rocket Work webhook subscriptions are created
    try {
      const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
      const cbBaseProto = req.headers.get('x-forwarded-proto') || 'http';
      const cbBaseHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const callbackBase = `${cbBaseProto}://${cbBaseHost}`;
      const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();

      const plain = await getDecryptedApiToken(userId);
      const headers = { Authorization: `Bearer ${plain}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;

      // Helper to upsert a subscription for a stream
      async function upsert(stream: 'tasks' | 'executors') {
        // list existing subscriptions
        try {
          const listUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
          const res = await fetch(listUrl, { method: 'GET', headers, cache: 'no-store' });
          const txt = await res.text();
          const d = txt ? JSON.parse(txt) : {};
          const arr = Array.isArray(d?.subscriptions) ? d.subscriptions : (Array.isArray(d?.postbacks) ? d.postbacks : []);
          const exists = Array.isArray(arr) && arr.some((p: any) => {
            const subs = Array.isArray(p?.subscribed_on) ? p.subscribed_on.map((x: any) => String(x)) : [];
            const uri = String(p?.callback_url ?? p?.uri ?? '');
            return subs.includes(stream) && uri === callbackUrl;
          });
          if (exists) return;
        } catch {}
        // create
        try {
          const createUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
          const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } as any;
          await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
        } catch {}
      }
      await upsert('tasks');
      await upsert('executors');
      // fetch org name for payout, save to user
      try {
        const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
        const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${plain}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await r.text();
        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
        const orgName: string | undefined = (d?.company_name as string | undefined) ?? undefined;
        try { await setUserOrgName(userId, orgName ?? null); } catch {}
      } catch {}
    } catch {}

    // 3) Fire-and-forget background assurance for a week if initial creation failed
    try {
      const proto = req.headers.get('x-forwarded-proto') || 'http';
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const baseUrl = `${proto}://${host}`;
      startSubscriptionWorker();
      const ok = await ensureSubscriptions(userId, baseUrl);
      if (!ok) await enqueueSubscriptionJob(userId, baseUrl);
    } catch {}
    const masked = await getMaskedToken(userId);
    return NextResponse.json({ token: masked }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    await deleteApiToken(userId);
    try { await setUserOrgName(userId, null); } catch {}
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


