import { NextResponse } from 'next/server';
import { findUserByPhoneLoose, verifyPassword } from '@/server/userStore';
import { listUserOrganizations } from '@/server/orgStore';
import { fireAndForgetFetch } from '@/server/http';
import { ensureLeaderLease, getInstanceId } from '@/server/leaderLease';
import { startWatchdog } from '@/server/watchdog';

export const runtime = 'nodejs';

function b64ToUtf8(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // tolerate base64url
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? norm + '='.repeat(4 - (norm.length % 4)) : norm;
  return Buffer.from(pad, 'base64').toString('utf8');
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable/blocked at ingress:
  // accept credentials via Authorization: Basic base64(phone:password)
  try {
    const auth = req.headers.get('authorization') || '';
    const m = /^Basic\s+(.+)$/i.exec(auth.trim());
    if (!m) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const decoded = b64ToUtf8(m[1]);
    const idx = decoded.indexOf(':');
    const phone = idx >= 0 ? decoded.slice(0, idx) : '';
    const password = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (!phone || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const headers = new Headers(req.headers);
    try { headers.delete('authorization'); } catch {}
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}

    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, password }),
    });
    return await POST(req2);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    try { startWatchdog(); } catch {}
    // Multi-instance mitigation: in S3 mode route auth through the elected API leader to avoid "half-dead" replicas.
    if (process.env.S3_ENABLED === '1') {
      try {
        const ok = await ensureLeaderLease('apiLeader', 30_000);
        if (!ok) {
          const instanceId = getInstanceId();
          const r = NextResponse.json({ error: 'NOT_LEADER', instanceId }, { status: 503 });
          r.headers.set('Retry-After', '1');
          r.headers.set('X-Instance-Id', instanceId);
          return r;
        }
      } catch {}
    }

    const body = await req.json().catch(() => null);
    const phoneRaw: string | undefined = body?.phone;
    const passwordRaw: string | undefined = body?.password;
    const phone = (phoneRaw ?? '').trim();
    const password = (passwordRaw ?? '').trim();
    if (!phone || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const user = await findUserByPhoneLoose(phone);
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const ok = verifyPassword(password, user.passSalt, user.passHash);
    if (!ok) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
    res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);

    // Корректно устанавливаем org_inn: сохраняем, если cookie принадлежит этому пользователю; иначе выбираем первую доступную
    try {
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(cookie);
      const current = m ? decodeURIComponent(m[1]) : null;
      const orgs = await listUserOrganizations(user.id);
      const innList = new Set(orgs.map((o) => o.inn));
      if (current && innList.has(current)) {
        // оставить как есть — не трогаем org_inn
      } else if (orgs.length > 0) {
        res.headers.append('Set-Cookie', `org_inn=${encodeURIComponent(orgs[0].inn)}; Path=/; SameSite=Lax; Max-Age=31536000`);
      } else {
        // у пользователя нет организаций — сбрасываем org_inn
        res.headers.append('Set-Cookie', `org_inn=; Path=/; Max-Age=0; SameSite=Lax`);
      }
    } catch {
      // на случай ошибки не ломаем логин
    }

    // Одноразовый фоновый рефреш всех продаж по всем организациям пользователя после логина
    try {
      const orgs = await listUserOrganizations(user.id);
      const proto = req.headers.get('x-forwarded-proto') || 'http';
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const isPublic = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(host);
      const scheme = (proto === 'http' && isPublic) ? 'https' : proto;
      const url = `${scheme}://${host}/api/sales?refresh=1`;
      for (const o of orgs) {
        // IMPORTANT: drain response to avoid undici socket leaks; also enforce a timeout
        fireAndForgetFetch(
          url,
          { method: 'GET', cache: 'no-store', headers: { cookie: `session_user=${encodeURIComponent(user.id)}; org_inn=${encodeURIComponent(o.inn)}` } },
          15_000
        );
      }
    } catch {}
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


