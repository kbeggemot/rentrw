import { cookies, headers } from 'next/headers';
import SettingsClient, { type SettingsPrefetch } from './SettingsClient';
import { getMaskedToken } from '@/server/secureStore';
import { getUserById, getUserAgentSettings, getUserPayoutRequisites } from '@/server/userStore';

export default async function SettingsPage() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('session_user')?.value || '';
    const maskedToken = userId ? await getMaskedToken(userId) : null;
    const user = userId ? await getUserById(userId) : null;
    const agent = userId ? await getUserAgentSettings(userId) : { agentDescription: null, defaultCommission: null };
    const payout = userId ? await getUserPayoutRequisites(userId) : { bik: null, account: null, orgName: null };

    let initial: SettingsPrefetch = {
      tokenMasked: maskedToken,
      emailMasked: user?.email ?? null,
      emailVerified: Boolean(user?.emailVerified),
      accountPhone: user?.phone ?? null,
      agentDescription: agent.agentDescription ?? '',
      defaultCommission: agent.defaultCommission ?? null,
      // Ключи подтянутся на клиенте, чтобы не тянуть лишнее на SSR
      keys: [],
      payoutBik: payout.bik,
      payoutAccount: payout.account,
      payoutOrgName: payout.orgName,
    };

    // Fallback: if everything looks empty on prod (e.g., data in S3 under a different prefix), try internal APIs
    const looksEmpty = !initial.tokenMasked && !initial.emailMasked && !initial.accountPhone && !initial.payoutBik && !initial.payoutAccount && !initial.payoutOrgName && !initial.agentDescription && !initial.defaultCommission;
    if (looksEmpty) {
      try {
        const h = await headers();
        const cookieHeader = (await cookies()).getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
        const hostFromEnv = process.env.BASE_HOST || '';
        const hostFromHdr = h.get('x-forwarded-host') || h.get('host') || '';
        const host = hostFromEnv || hostFromHdr || 'localhost:3000';
        const protoHdr = h.get('x-forwarded-proto') || '';
        const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : (protoHdr || 'https');
        const baseUrl = `${proto}://${host}`;
        const [tRes, eRes, aRes, sRes, pRes] = await Promise.all([
          fetch(`${baseUrl}/api/settings/token`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
          fetch(`${baseUrl}/api/settings/email`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
          fetch(`${baseUrl}/api/settings/account`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
          fetch(`${baseUrl}/api/settings/agent`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
          fetch(`${baseUrl}/api/settings/payout`, { cache: 'no-store', headers: { cookie: cookieHeader } }),
        ]);
        const [t, e, a, s, p] = await Promise.all([
          tRes.json().catch(() => ({})),
          eRes.json().catch(() => ({})),
          aRes.json().catch(() => ({})),
          sRes.json().catch(() => ({})),
          pRes.json().catch(() => ({})),
        ]);
        initial = {
          tokenMasked: t?.token ?? null,
          emailMasked: e?.email ?? null,
          emailVerified: !!e?.verified,
          accountPhone: a?.phone ?? null,
          agentDescription: typeof s?.agentDescription === 'string' ? s.agentDescription : '',
          defaultCommission: s?.defaultCommission ?? null,
          keys: [],
          payoutBik: p?.bik ?? null,
          payoutAccount: p?.account ?? null,
          payoutOrgName: p?.orgName ?? null,
        };
      } catch {}
    }

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


