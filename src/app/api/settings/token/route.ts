import { NextResponse } from 'next/server';
import { getMaskedToken, saveApiToken, deleteApiToken, getDecryptedApiToken } from '@/server/secureStore';
import { setUserOrgName, setUserOrgInn } from '@/server/userStore';
import { enqueueSubscriptionJob, ensureSubscriptions, startSubscriptionWorker } from '@/server/subscriptionWorker';
import { upsertOrganization, addMemberToOrg, setUserOrgToken, deleteUserOrgToken, userHasTokenForOrg } from '@/server/orgStore';
import { getSelectedOrgInn } from '@/server/orgContext';

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
    // If org is selected, prefer token masked for that org; otherwise fallback to per-user store
    const innCookie = getSelectedOrgInn(req);
    if (innCookie) {
      try {
        const { getMaskedTokenForOrg } = await import('@/server/orgStore');
        const masked = await getMaskedTokenForOrg(innCookie, userId);
        // В контексте выбранной организации не показываем legacy-токен пользователя
        return NextResponse.json({ token: masked ?? null });
      } catch {}
      return NextResponse.json({ token: null });
    } else {
      const masked = await getMaskedToken(userId);
      return NextResponse.json({ token: masked });
    }
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
    // 1) Try to validate token against account endpoint.
    //    If 401 → reject. If network/other error → continue to save (degraded mode).
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
      // Non-OK but not 401 → allow save, continue in degraded mode
    } catch {
      // Network error → allow save, continue in degraded mode
    }

    // 2) Determine org by calling account; keep degraded behavior if fails
    let orgInn: string | null = null;
    let orgName: string | null = null;
    try {
      const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
      const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      const txt = await r.text();
      let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
      orgName = (d?.company_name as string | undefined) ?? null;
      const gotInn: string | undefined = (d?.inn as string | undefined) ?? (d?.company_inn as string | undefined) ?? undefined;
      orgInn = (gotInn || '').replace(/\D/g, '') || null;
    } catch {}

    // 2a) If org info is available: upsert org, add membership, assign token to user within that org
    if (orgInn) {
      try {
        await upsertOrganization(orgInn, orgName);
        await addMemberToOrg(orgInn, userId);
        // Reject if this user already имеет токен для этой организации
        const already = await userHasTokenForOrg(orgInn, userId);
        if (already) {
          // переключим контекст на эту организацию и вернём ошибку для тоста
          const res = NextResponse.json({ error: 'ORG_ALREADY_ADDED', inn: orgInn }, { status: 409 });
          res.headers.set('Set-Cookie', `org_inn=${encodeURIComponent(orgInn)}; Path=/; SameSite=Lax; Max-Age=31536000`);
          return res;
        }
        await setUserOrgToken(orgInn, userId, token);
        // persist last known org info for user profile (read-only hints)
        try { await setUserOrgName(userId, orgName); } catch {}
        try { await setUserOrgInn(userId, orgInn); } catch {}
      } catch {}
    }
    // 2b) Save token in legacy per-user store for backward compatibility (non-org flows)
    await saveApiToken(userId, token);
    // After saving token, ensure Rocket Work webhook subscriptions are created
    try {
      const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
      const rawProto = req.headers.get('x-forwarded-proto') || 'http';
      const cbBaseHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(cbBaseHost);
      const cbBaseProto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
      const callbackBase = `${cbBaseProto}://${cbBaseHost}`;
      const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();

      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;

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
        // create (Rocketwork v2: postback_subscriptions with 'uri')
        try {
          const createUrl = new URL('postback_subscriptions', base.endsWith('/') ? base : base + '/').toString();
          const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } as any;
          const res = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' });
          if (res.ok) return;
        } catch {}
      }
      await upsert('tasks');
      await upsert('executors');
      // fetch org name for payout, save to user
      try {
        const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
        const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await r.text();
        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
        const orgName: string | undefined = (d?.company_name as string | undefined) ?? undefined;
        const orgInn: string | undefined = (d?.inn as string | undefined) ?? (d?.company_inn as string | undefined) ?? undefined;
        try { await setUserOrgName(userId, orgName ?? null); } catch {}
        try { await setUserOrgInn(userId, orgInn ?? null); } catch {}
      } catch {}
      // trigger ensure endpoint to log subscription attempts and current list (per-stream to avoid лишние попытки)
      try {
        const ensureProto = req.headers.get('x-forwarded-proto') || 'http';
        const ensureHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
        const ensureBase = `${ensureProto}://${ensureHost}`;
        // дергаем только те стримы, которые реально создавали выше
        await fetch(new URL('/api/rocketwork/postbacks?ensure=1&stream=tasks', ensureBase).toString(), { method: 'GET', headers: { cookie: `session_user=${encodeURIComponent(userId)}`, 'x-user-id': userId }, cache: 'no-store' });
        await fetch(new URL('/api/rocketwork/postbacks?ensure=1&stream=executors', ensureBase).toString(), { method: 'GET', headers: { cookie: `session_user=${encodeURIComponent(userId)}`, 'x-user-id': userId }, cache: 'no-store' });
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
    const last4 = token.slice(-4);
    const masked = `••••••••${last4}`;
    // Если добавили новую организацию — переключаем контекст на неё
    const res = NextResponse.json({ token: masked, inn: orgInn }, { status: 201 });
    if (orgInn) {
      res.headers.set('Set-Cookie', `org_inn=${encodeURIComponent(orgInn)}; Path=/; SameSite=Lax; Max-Age=31536000`);
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const inn = getSelectedOrgInn(req);
    if (inn) {
      try { await deleteUserOrgToken(inn, userId); } catch {}
      // Do not delete legacy token to avoid impacting other orgs; gating will hide UI without org token
      return NextResponse.json({ ok: true, scope: 'org' });
    } else {
      await deleteApiToken(userId);
      try { await setUserOrgName(userId, null); } catch {}
      return NextResponse.json({ ok: true, scope: 'user' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


