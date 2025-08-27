import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';

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
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const urlObj = new URL(req.url);
    const ensure = urlObj.searchParams.get('ensure') === '1';
    if (ensure) {
      // Perform upsert just like POST, then list
      try {
        const cbProto = req.headers.get('x-forwarded-proto') || 'http';
        const cbHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
        const callbackBase = `${cbProto}://${cbHost}`;
        const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;
        for (const path of ['postback_subscriptions', 'postbacks']) {
          try {
            const createUrl = new URL(path, base.endsWith('/') ? base : base + '/').toString();
            const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: ['tasks', 'executors'] } as any;
            await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' });
          } catch {}
        }
      } catch {}
    }
    async function list(urlPath: string) {
      const url = new URL(urlPath, base.endsWith('/') ? base : base + '/').toString();
      const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: res.ok, status: res.status, data, text } as const;
    }
    let out = await list('postback_subscriptions');
    if (!out.ok) {
      const alt = await list('postbacks');
      if (alt.ok) out = alt;
    }
    if (!out.ok) return NextResponse.json({ error: out.data?.error || out.text || 'External API error' }, { status: out.status });
    const arr = Array.isArray(out.data?.subscriptions) ? out.data.subscriptions : (Array.isArray(out.data?.postbacks) ? out.data.postbacks : out.data);
    return NextResponse.json({ subscriptions: arr });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const cbBaseProto = req.headers.get('x-forwarded-proto') || 'http';
    const cbBaseHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const callbackBase = `${cbBaseProto}://${cbBaseHost}`;
    const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;

    async function upsert(stream: 'tasks' | 'executors') {
      // list existing (try both endpoints)
      let exists = false;
      try {
        for (const path of ['postback_subscriptions', 'postbacks']) {
          try {
            const listUrl = new URL(path, base.endsWith('/') ? base : base + '/').toString();
            const res = await fetch(listUrl, { method: 'GET', headers, cache: 'no-store' });
            const txt = await res.text();
            const d = txt ? JSON.parse(txt) : {};
            const arr = Array.isArray(d?.subscriptions) ? d.subscriptions : (Array.isArray(d?.postbacks) ? d.postbacks : []);
            exists = Array.isArray(arr) && arr.some((p: any) => {
              const subs = Array.isArray(p?.subscribed_on) ? p.subscribed_on.map((x: any) => String(x)) : [];
              const uri = String(p?.callback_url ?? p?.uri ?? '');
              return subs.includes(stream) && uri === callbackUrl;
            });
            if (exists) break;
          } catch {}
        }
      } catch {}
      if (exists) return;
      // create (first try canonical, then fallback)
      for (const path of ['postback_subscriptions', 'postbacks']) {
        try {
          const createUrl = new URL(path, base.endsWith('/') ? base : base + '/').toString();
          const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } as any;
          const res = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
          if (res.ok) return;
        } catch {}
      }
    }

    await upsert('tasks');
    await upsert('executors');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


