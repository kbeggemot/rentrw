import { NextResponse } from 'next/server';
import { writeText } from '@/server/storage';
import { getDecryptedApiToken } from '@/server/secureStore';
import { fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

async function getRwToken(req: Request, userId: string): Promise<string | null> {
  const hdr = req.headers.get('x-rw-token');
  if (hdr && hdr.trim().length > 0) return hdr.trim();
  return await getDecryptedApiToken(userId);
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const token = await getRwToken(req, userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const urlObj = new URL(req.url);
    const ensure = urlObj.searchParams.get('ensure') === '1';
    const streamParamRaw = urlObj.searchParams.get('stream');
    const normalizedStream = streamParamRaw && /^(tasks|executors)$/i.test(streamParamRaw) ? (streamParamRaw.toLowerCase() as 'tasks' | 'executors') : null;
    if (ensure) {
      // Perform upsert just like POST, then list
      try {
        const rawProto = (urlObj.protocol && urlObj.protocol.replace(/:$/, '')) || req.headers.get('x-forwarded-proto') || 'http';
        const cbHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
        const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(cbHost);
        const cbProto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
        const callbackBase = `${cbProto}://${cbHost}`;
        const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;
        const attempts: Array<{ stream: 'tasks' | 'executors'; path: string; payload: Record<string, unknown> }> = [];
        const streams: Array<'tasks' | 'executors'> = normalizedStream ? [normalizedStream] : (['tasks','executors'] as const);
        for (const stream of streams) {
          attempts.push({ stream, path: 'postback_subscriptions', payload: { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } });
        }
        const ensureLogs: any[] = [];
        for (const a of attempts) {
          try {
            const createUrl = new URL(a.path, base.endsWith('/') ? base : base + '/').toString();
            const out = await fetchTextWithTimeout(createUrl, { method: 'POST', headers, body: JSON.stringify(a.payload), cache: 'no-store' }, 15_000);
            ensureLogs.push({ kind: 'create', stream: a.stream, request: { path: a.path, payload: a.payload }, response: { status: out.res.status, text: out.text } });
          } catch (e) {
            ensureLogs.push({ kind: 'create', stream: a.stream, request: { path: a.path, payload: a.payload }, error: String((e as Error)?.message || e) });
          }
        }
        // Additionally, try to update existing subscriptions that have empty or foreign URI
        try {
          const listUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
          const out = await fetchTextWithTimeout(listUrl, { method: 'GET', headers, cache: 'no-store' }, 15_000);
          const txt = out.text;
          let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
          const arr = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
          for (const it of arr) {
            const id = it?.id;
            if (!id) continue;
            const uriNow = String(it?.callback_url ?? it?.uri ?? '');
            const subs = Array.isArray(it?.subscribed_on) ? it.subscribed_on.map((x: any) => String(x)) : [];
            const needsUpdate = !uriNow || !uriNow.includes(cbHost);
            if (!needsUpdate) continue;
            for (const method of ['PUT','PATCH','POST']) {
              for (const f of [
                { callback_url: callbackUrl, subscribed_on: subs },
                { uri: callbackUrl, subscribed_on: subs },
              ]) {
                try {
                  const updUrl = new URL(`postback_subscriptions/${encodeURIComponent(String(id))}`, base.endsWith('/') ? base : base + '/').toString();
                  const out2 = await fetchTextWithTimeout(updUrl, { method, headers, body: JSON.stringify(f), cache: 'no-store' }, 15_000);
                  ensureLogs.push({ kind: 'update', id, request: { method, payload: f }, response: { status: out2.res.status, text: out2.text } });
                } catch {}
              }
            }
          }
        } catch {}
        try { await writeText('.data/postback_ensure_last.json', JSON.stringify({ ts: new Date().toISOString(), ensure, userId, callbackUrl, attempts: ensureLogs }, null, 2)); } catch {}
      } catch {}
    }
    async function list(urlPath: string) {
      const url = new URL(urlPath, base.endsWith('/') ? base : base + '/').toString();
      const out = await fetchTextWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
      const res = out.res;
      const text = out.text;
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: res.ok, status: res.status, data, text } as const;
    }
    let out = await list('postback_subscriptions');
    if (!out.ok) {
      const alt = await list('postbacks');
      if (alt.ok) out = alt;
    }
    try { await writeText('.data/postback_list_last.json', JSON.stringify({ ts: new Date().toISOString(), out }, null, 2)); } catch {}
    if (!out.ok) return NextResponse.json({ error: out.data?.error || out.text || 'External API error' }, { status: out.status });
    const arr = Array.isArray(out.data?.subscriptions) ? out.data.subscriptions : (Array.isArray(out.data?.postbacks) ? out.data.postbacks : out.data);
    // Persist per-user cache for local existence checks (to avoid redundant ensures on task creation)
    try {
      const rawProto = (urlObj.protocol && urlObj.protocol.replace(/:$/, '')) || req.headers.get('x-forwarded-proto') || 'http';
      const cbHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(cbHost);
      const cbProto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
      const callbackBase = `${cbProto}://${cbHost}`;
      const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
      await writeText(`.data/postback_cache_${userId}.json`, JSON.stringify({ ts: new Date().toISOString(), callbackUrl, subscriptions: arr }, null, 2));
    } catch {}
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
    const token = await getRwToken(req, userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const urlObj = new URL(req.url);
    const rawProto = (urlObj.protocol && urlObj.protocol.replace(/:$/, '')) || req.headers.get('x-forwarded-proto') || 'http';
    const cbBaseHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(cbBaseHost);
    const cbBaseProto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
    const callbackBase = `${cbBaseProto}://${cbBaseHost}`;
    const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;

    async function upsert(stream: 'tasks' | 'executors') {
      // list existing
      let exists = false;
      try {
        const listUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
        const out = await fetchTextWithTimeout(listUrl, { method: 'GET', headers, cache: 'no-store' }, 15_000);
        const txt = out.text;
        const d = txt ? JSON.parse(txt) : {};
        const arr = Array.isArray(d?.subscriptions) ? d.subscriptions : [];
        exists = Array.isArray(arr) && arr.some((p: any) => {
          const subs = Array.isArray(p?.subscribed_on) ? p.subscribed_on.map((x: any) => String(x)) : [];
          const uri = String(p?.callback_url ?? p?.uri ?? '');
          return subs.includes(stream) && uri === callbackUrl;
        });
      } catch {}
      if (exists) return;
      // create (canonical endpoint only)
      try {
        const createUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
        const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } as any;
        const out = await fetchTextWithTimeout(createUrl, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' }, 15_000);
        if (out.res.ok) return;
      } catch {}
    }

    await upsert('tasks');
    await upsert('executors');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


