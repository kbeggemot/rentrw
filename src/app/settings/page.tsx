import { cookies, headers } from 'next/headers';
import SettingsClient, { type SettingsPrefetch } from './SettingsClient';

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');

  const [tRes, eRes, aRes, sRes, kRes] = await Promise.all([
    fetch(`${baseUrl}/api/settings/token`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
    fetch(`${baseUrl}/api/settings/email`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
    fetch(`${baseUrl}/api/settings/account`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
    fetch(`${baseUrl}/api/settings/agent`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
    fetch(`${baseUrl}/api/auth/webauthn/list`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
  ]);

  const [t, e, a, s, k] = await Promise.all([
    tRes.json().catch(() => ({})),
    eRes.json().catch(() => ({})),
    aRes.json().catch(() => ({})),
    sRes.json().catch(() => ({})),
    kRes.json().catch(() => ({})),
  ]);

  const initial: SettingsPrefetch = {
    tokenMasked: t?.token ?? null,
    emailMasked: e?.email ?? null,
    emailVerified: !!e?.verified,
    accountPhone: a?.phone ?? null,
    agentDescription: typeof s?.agentDescription === 'string' ? s.agentDescription : '',
    defaultCommission: s?.defaultCommission ?? null,
    keys: Array.isArray(k?.items) ? k.items : [],
  };

  return <SettingsClient initial={initial} />;
}


