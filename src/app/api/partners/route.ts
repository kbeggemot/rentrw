import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { listPartners, listPartnersForOrg, upsertPartner, softDeletePartner, upsertPartnerFromValidation, listAllPartnersForOrg } from '@/server/partnerStore';
import { getSelectedOrgInn } from '@/server/orgContext';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    let limit = Number(limitParam);
    if (!Number.isFinite(limit) || limit <= 0) limit = 15;
    if (limit > 200) limit = 200;
    const cursor = url.searchParams.get('cursor'); // format: updatedAt|phone

    const all = inn ? (showAll ? await listAllPartnersForOrg(inn) : await listPartnersForOrg(userId, inn)) : await listPartners(userId);
    // Sort by updatedAt desc, then phone asc for stable order
    all.sort((a: any, b: any) => {
      const at = Date.parse(a?.updatedAt || a?.createdAt || 0);
      const bt = Date.parse(b?.updatedAt || b?.createdAt || 0);
      if (Number.isNaN(at) && Number.isNaN(bt)) return (a.phone || '').localeCompare(b.phone || '');
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      if (bt !== at) return bt - at; // latest first
      return String(a.phone || '').localeCompare(String(b.phone || ''));
    });

    let startIndex = 0;
    if (cursor) {
      const [curAt, curPhone] = cursor.split('|');
      const exactIdx = all.findIndex((x) => String(x.phone) === String(curPhone) && String(x.updatedAt || x.createdAt) === String(curAt));
      if (exactIdx !== -1) startIndex = exactIdx + 1;
      else if (curAt) {
        const curTs = Date.parse(curAt);
        startIndex = all.findIndex((x) => {
          const ts = Date.parse(x.updatedAt || x.createdAt);
          if (!Number.isNaN(ts) && !Number.isNaN(curTs)) {
            if (ts < curTs) return true; // list is desc
            if (ts === curTs) return String(x.phone) > String(curPhone); // ensure stable order
            return false;
          }
          if ((x.updatedAt || x.createdAt) < curAt) return true;
          if ((x.updatedAt || x.createdAt) === curAt) return String(x.phone) > String(curPhone);
          return false;
        });
        if (startIndex === -1) startIndex = all.length;
      }
    }
    const items = all.slice(startIndex, startIndex + limit);
    let nextCursor: string | null = null;
    if (startIndex + limit < all.length && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = `${last.updatedAt || last.createdAt}|${last.phone}`;
    }
    // Back-compat: also return 'partners' for existing clients
    return NextResponse.json({ items, nextCursor, partners: items }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const body = await req.json() as { phone?: string };
    const inn = getSelectedOrgInn(req);
    const phone = String(body?.phone || '').trim();
    if (!phone) return NextResponse.json({ error: 'Введите телефон' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;

    // 1) Invite (best-effort; offline ok)
    try {
      const inviteUrl = new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString();
      await fetch(inviteUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone, with_framework_agreement: false }),
        cache: 'no-store',
      });
    } catch {}

    // 2) Validate by fetching executor info
    const phoneDigits = phone.replace(/\D/g, '');
    async function getExecutorById(id: string) {
      const url = new URL(`executors/${encodeURIComponent(id)}`, base.endsWith('/') ? base : base + '/').toString();
      const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { res, data };
    }
    const resDigits = await getExecutorById(phoneDigits);
    let chosen = resDigits;
    if (!resDigits.res.ok && resDigits.res.status !== 404) {
      const resRaw = await getExecutorById(phone);
      chosen = resRaw;
    }
    if (chosen.res.status === 404) {
      return NextResponse.json({ error: 'Партнёр не найден в РВ' }, { status: 404 });
    }
    if (!chosen.res.ok) {
      const msg = (chosen.data?.error as string | undefined) || 'Ошибка RW';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

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
    const employmentKind: string | null = (chosen.data?.executor?.employment_kind as string | undefined)
      ?? (chosen.data?.employment_kind as string | undefined)
      ?? null;

    await upsertPartnerFromValidation(userId, phone, chosen.data, inn ?? null);

    return NextResponse.json({ ok: true, partner: { phone, fio, status, employmentKind } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const phone = url.searchParams.get('phone');
    if (!phone) return NextResponse.json({ error: 'NO_PHONE' }, { status: 400 });
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    await softDeletePartner(userId, phone);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


