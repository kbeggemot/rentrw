import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { listPartners, upsertPartner } from '@/server/partnerStore';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    const current = await listPartners(userId);

    async function getExecutorById(id: string) {
      const url = new URL(`executors/${encodeURIComponent(id)}`, base.endsWith('/') ? base : base + '/').toString();
      const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { res, data };
    }

    let updated = 0;
    for (const p of current) {
      try {
        const digits = p.phone.replace(/\D/g, '');
        let chosen = await getExecutorById(digits);
        if (!chosen.res.ok && chosen.res.status !== 404) {
          chosen = await getExecutorById(p.phone);
        }
        if (chosen.res.ok) {
          const pick = (...vals: Array<unknown>) => {
            for (const v of vals) {
              if (typeof v === 'string') {
                const s = v.trim();
                if (s.length > 0 && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined') return s;
              }
            }
            return null as string | null;
          };
          const last = pick(chosen.data?.executor?.last_name, chosen.data?.last_name);
          const first = pick(chosen.data?.executor?.first_name, chosen.data?.first_name);
          const second = pick(chosen.data?.executor?.second_name, chosen.data?.second_name);
          const fioFromParts = pick([last, first, second].filter(Boolean).join(' ').trim());
          const fio = fioFromParts ?? pick(
            chosen.data?.executor?.full_name,
            chosen.data?.executor?.name,
            chosen.data?.executor?.fio,
            chosen.data?.full_name,
            chosen.data?.name,
            chosen.data?.fio,
          );
          const status = (chosen.data?.selfemployed_status as string | undefined)
            ?? (chosen.data?.executor?.selfemployed_status as string | undefined)
            ?? null;
          await upsertPartner(userId, { phone: p.phone, fio, status, updatedAt: new Date().toISOString() });
          updated += 1;
        }
      } catch {}
    }

    return NextResponse.json({ ok: true, updated }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


