import { cookies, headers } from 'next/headers';
import SettingsClient, { type SettingsPrefetch } from './SettingsClient';
import { getMaskedToken } from '@/server/secureStore';
import { getMaskedTokenForOrg } from '@/server/orgStore';
import { getUserById, getUserAgentSettings } from '@/server/userStore';
import { getOrgPayoutRequisites, findOrgByInn } from '@/server/orgStore';

export default async function SettingsPage() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('session_user')?.value || '';
    const orgInn = cookieStore.get('org_inn')?.value || '';
    // В контексте выбранной организации показываем токен только этой организации
    const maskedToken = userId ? (orgInn ? await getMaskedTokenForOrg(orgInn, userId) : await getMaskedToken(userId)) : null;
    const user = userId ? await getUserById(userId) : null;
    const agent = userId ? await getUserAgentSettings(userId) : { agentDescription: null, defaultCommission: null };
    const payout = orgInn ? await getOrgPayoutRequisites(orgInn) : { bik: null, account: null };
    // Переопределяем orgName названием выбранной организации (если есть)
    let orgNameFromOrg: string | null = null;
    if (orgInn) {
      try { const org = await findOrgByInn(orgInn); orgNameFromOrg = org?.name ?? null; } catch {}
    }

    function maskEmail(email: string): string {
      const [local, domainFull] = email.split('@');
      if (!domainFull) return email;
      const [domain, ...rest] = domainFull.split('.');
      const tld = rest.join('.');
      const localMasked = local.length <= 2 ? local[0] + '*' : local[0] + '*'.repeat(Math.max(1, local.length - 2)) + local[local.length - 1];
      const domainMasked = domain.length <= 2 ? domain[0] + '*' : domain[0] + '*'.repeat(Math.max(1, domain.length - 2)) + domain[domain.length - 1];
      return tld ? `${localMasked}@${domainMasked}.${tld}` : `${localMasked}@${domainMasked}`;
    }

    let initial: SettingsPrefetch = {
      tokenMasked: maskedToken,
      emailMasked: user?.email ? maskEmail(user.email) : null,
      emailVerified: Boolean(user?.emailVerified),
      accountPhone: user?.phone ?? null,
      agentDescription: agent.agentDescription ?? '',
      defaultCommission: agent.defaultCommission ?? null,
      // Ключи подтянутся на клиенте, чтобы не тянуть лишнее на SSR
      keys: [],
      payoutBik: payout.bik,
      payoutAccount: payout.account,
      payoutOrgName: orgNameFromOrg ?? null,
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


