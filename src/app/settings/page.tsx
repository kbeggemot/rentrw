import { cookies, headers } from 'next/headers';
import SettingsClient, { type SettingsPrefetch } from './SettingsClient';

export default async function SettingsPage() {
  try {
    const cookieStore = await cookies();
    const h = await headers();
    const userId = cookieStore.get('session_user')?.value || '';
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; ');

    const hostFromEnv = process.env.BASE_HOST || '';
    const hostFromHdr = h.get('x-forwarded-host') || h.get('host') || '';
    const host = hostFromEnv || hostFromHdr || 'localhost:3000';
    const protoHdr = h.get('x-forwarded-proto') || '';
    const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : (protoHdr || 'https');
    const baseUrl = `${proto}://${host}`;
    const [tRes, eRes, aRes, sRes, kRes, pRes] = await Promise.all([
      fetch(`${baseUrl}/api/settings/token`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
      fetch(`${baseUrl}/api/settings/email`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
      fetch(`${baseUrl}/api/settings/account`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
      fetch(`${baseUrl}/api/settings/agent`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
      fetch(`${baseUrl}/api/auth/webauthn/list`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
      fetch(`${baseUrl}/api/settings/payout`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
    ]);
    const [t, e, a, s, k, p] = await Promise.all([
      tRes.json().catch(() => ({})),
      eRes.json().catch(() => ({})),
      aRes.json().catch(() => ({})),
      sRes.json().catch(() => ({})),
      kRes.json().catch(() => ({})),
      pRes.json().catch(() => ({})),
    ]);
    const initial: SettingsPrefetch = {
      tokenMasked: t?.token ?? null,
      emailMasked: e?.email ?? null,
      emailVerified: !!e?.verified,
      accountPhone: a?.phone ?? null,
      agentDescription: typeof s?.agentDescription === 'string' ? s.agentDescription : '',
      defaultCommission: s?.defaultCommission ?? null,
      keys: Array.isArray(k?.items) ? k.items : [],
      payoutBik: p?.bik ?? null,
      payoutAccount: p?.account ?? null,
      payoutOrgName: p?.orgName ?? null,
    };

    return (
      <>
        <h1 className="md:hidden sr-only">Настройки</h1>
        <SettingsClient initial={initial} userId={userId} />
      </>
    );
  } catch {
    // SSR fallback to prevent crash: render with empty initial and let client fill softly
    const initial: SettingsPrefetch = {
      tokenMasked: null,
      emailMasked: null,
      emailVerified: false,
      accountPhone: null,
      agentDescription: '',
      defaultCommission: null,
      keys: [],
      payoutBik: null,
      payoutAccount: null,
      payoutOrgName: null,
    };
    return (
      <>
        <h1 className="md:hidden sr-only">Настройки</h1>
        <SettingsClient initial={initial} />
      </>
    );
  }
}


