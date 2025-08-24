import { NextResponse } from 'next/server';
import { upsertOrganization, addMemberToOrg, setUserOrgToken } from '@/server/orgStore';
import { readText, writeText } from '@/server/storage';
import { getDecryptedApiToken } from '@/server/secureStore';
import { createHash } from 'crypto';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    // Protect with ADMIN_SECRET
    const admin = req.headers.get('x-admin-secret') || '';
    if (!admin || admin !== (process.env.ADMIN_SECRET || '')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') !== '0';
    const assign = url.searchParams.get('assign') === '1';

    // Gather existing users and their legacy tokens
    const usersRaw = await readText('.data/users.json');
    const users = usersRaw ? (JSON.parse(usersRaw) as any)?.users ?? [] : [];

    const result: Array<{ userId: string; inn: string | null; name: string | null; action: string }> = [];

    for (const u of users) {
      const userId: string = u?.id;
      if (!userId) continue;
      // Try to fetch account info with user's legacy token (if any) to resolve org
      let token: string | null = null;
      try { token = await getDecryptedApiToken(userId); } catch { token = null; }
      if (!token) { continue; }
      let orgInn: string | null = null;
      let orgName: string | null = null;
      try {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
        const r = await fetch(accUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await r.text();
        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
        orgName = (d?.company_name as string | undefined) ?? null;
        const gotInn: string | undefined = (d?.inn as string | undefined) ?? (d?.company_inn as string | undefined) ?? undefined;
        orgInn = (gotInn || '').replace(/\D/g, '') || null;
      } catch {}
      if (!orgInn) { result.push({ userId, inn: null, name: null, action: 'skip_no_inn' }); continue; }
      if (!dry) {
        try {
          await upsertOrganization(orgInn, orgName);
          await addMemberToOrg(orgInn, userId);
          await setUserOrgToken(orgInn, userId, token!);
        } catch {}
      }
      result.push({ userId, inn: orgInn, name: orgName, action: dry ? 'would_link' : 'linked' });

      // Optional: assign orgInn and rwTokenFp to existing entities for this user
      if (!dry && assign && orgInn && token) {
        const fp = createHash('sha256').update(token, 'utf8').digest('hex');
        // sales: .data/tasks.json
        try {
          const rawTasks = await readText('.data/tasks.json');
          if (rawTasks) {
            const store = JSON.parse(rawTasks) as any;
            if (Array.isArray(store?.sales)) {
              let changed = false;
              for (const s of store.sales) {
                if (s && s.userId === userId) {
                  const orgVal = (s.orgInn == null || String(s.orgInn) === 'неизвестно');
                  const fpMissing = (s.rwTokenFp == null || String(s.rwTokenFp).length === 0);
                  if (orgVal) { s.orgInn = orgInn; changed = true; }
                  if (fpMissing) { s.rwTokenFp = fp; changed = true; }
                }
              }
              if (changed) {
                await writeText('.data/tasks.json', JSON.stringify(store, null, 2));
              }
            }
          }
        } catch {}
        // partners: .data/partners.json
        try {
          const rawP = await readText('.data/partners.json');
          if (rawP) {
            const store = JSON.parse(rawP) as any;
            const arr = Array.isArray(store?.users?.[userId]) ? store.users[userId] : null;
            if (Array.isArray(arr)) {
              let changed = false;
              for (const p of arr) {
                if (p && (p.orgInn == null || String(p.orgInn) === 'неизвестно')) { p.orgInn = orgInn; changed = true; }
              }
              if (changed) await writeText('.data/partners.json', JSON.stringify(store, null, 2));
            }
          }
        } catch {}
        // payment links: .data/payment_links.json
        try {
          const rawL = await readText('.data/payment_links.json');
          if (rawL) {
            const store = JSON.parse(rawL) as any;
            if (Array.isArray(store?.items)) {
              let changed = false;
              for (const it of store.items) {
                if (it && it.userId === userId && (it.orgInn == null || String(it.orgInn) === 'неизвестно')) { it.orgInn = orgInn; changed = true; }
              }
              if (changed) await writeText('.data/payment_links.json', JSON.stringify(store, null, 2));
            }
          }
        } catch {}
      }
    }

    // Persist a small report for auditing
    try { await writeText('.data/backfill_last.json', JSON.stringify({ ts: new Date().toISOString(), dry, assign, result }, null, 2)); } catch {}

    return NextResponse.json({ ok: true, dry, assign, items: result }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


