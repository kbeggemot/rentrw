import { NextResponse } from 'next/server';
import { createPaymentLink, listPaymentLinks, listPaymentLinksForOrg, listAllPaymentLinksForOrg } from '@/server/paymentLinkStore';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { getSelectedOrgInn } from '@/server/orgContext';
import { partnerExists, upsertPartnerFromValidation } from '@/server/partnerStore';

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
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    const items = inn ? (showAll ? await listAllPaymentLinksForOrg(inn) : await listPaymentLinksForOrg(userId, inn)) : await listPaymentLinks(userId);
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const inn = getSelectedOrgInn(req);
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim();
    const sumMode = (body?.sumMode === 'fixed' ? 'fixed' : 'custom') as 'custom' | 'fixed';
    const amountRub = sumMode === 'fixed' ? Number(body?.amountRub || 0) : null;
    const vatRate = (['none','0','10','20'].includes(String(body?.vatRate)) ? String(body?.vatRate) : 'none') as 'none'|'0'|'10'|'20';
    const isAgent = !!body?.isAgent;
    const commissionType = isAgent && (body?.commissionType === 'fixed' || body?.commissionType === 'percent') ? body?.commissionType : null;
    const commissionValue = isAgent && typeof body?.commissionValue === 'number' ? Number(body?.commissionValue) : null;
    const partnerPhone = isAgent ? (String(body?.partnerPhone || '').trim() || null) : null;
    const method = (body?.method === 'qr' || body?.method === 'card') ? body?.method : 'any';
    if (!title) return NextResponse.json({ error: 'TITLE_REQUIRED' }, { status: 400 });
    if (!description) return NextResponse.json({ error: 'DESCRIPTION_REQUIRED' }, { status: 400 });
    if (sumMode === 'fixed' && (!Number.isFinite(amountRub) || Number(amountRub) <= 0)) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 });
    // Validate agent fields and partner in RW when isAgent
    if (isAgent) {
      if (!commissionType) return NextResponse.json({ error: 'COMMISSION_TYPE_REQUIRED' }, { status: 400 });
      if (commissionValue == null || !Number.isFinite(commissionValue)) return NextResponse.json({ error: 'COMMISSION_VALUE_REQUIRED' }, { status: 400 });
      if (commissionType === 'percent' && (commissionValue < 0 || commissionValue > 100)) return NextResponse.json({ error: 'COMMISSION_PERCENT_RANGE' }, { status: 400 });
      if (commissionType === 'fixed' && commissionValue <= 0) return NextResponse.json({ error: 'COMMISSION_FIXED_POSITIVE' }, { status: 400 });
      if (!partnerPhone) return NextResponse.json({ error: 'PARTNER_PHONE_REQUIRED' }, { status: 400 });
      // Check partner via RW similar to main flow
      try {
        const inn = getSelectedOrgInn(req);
        const { token } = await resolveRwTokenWithFingerprint(req, userId, inn, null);
        if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const digits = String(partnerPhone).replace(/\D/g, '');
        // invite best-effort
        try { await fetch(new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ phone: digits, with_framework_agreement: false }), cache: 'no-store' }); } catch {}
        const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await res.text();
        let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
        if (res.status === 404 || (typeof data === 'object' && data && ((data.error && /not\s*found/i.test(String(data.error))) || data.executor == null || (data.executor && data.executor.inn == null)))) {
          return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
        }
        if (!res.ok) {
          return NextResponse.json({ error: (data?.error as string) || 'RW_ERROR' }, { status: 400 });
        }
        const status: string | undefined = (data?.executor?.selfemployed_status as string | undefined) ?? (data?.selfemployed_status as string | undefined);
        if (!status) return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
        if (status !== 'validated') return NextResponse.json({ error: 'PARTNER_NOT_VALIDATED' }, { status: 400 });
        const paymentInfo = (data?.executor?.payment_info ?? data?.payment_info ?? null);
        if (!paymentInfo) return NextResponse.json({ error: 'PARTNER_NO_PAYMENT_INFO' }, { status: 400 });
        
        // Auto-add/update partner if validation successful
        await upsertPartnerFromValidation(userId, digits, data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'CHECK_ERROR';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    const item = await createPaymentLink(userId, { title, description, sumMode, amountRub: amountRub ?? undefined, vatRate, isAgent, commissionType: commissionType as any, commissionValue: commissionValue ?? undefined, partnerPhone, method, orgInn: inn ?? undefined } as any);
    const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const protoHdr = req.headers.get('x-forwarded-proto') || (hostHdr.startsWith('localhost') ? 'http' : 'https');
    const url = `${protoHdr}://${hostHdr}/link/${encodeURIComponent(item.code)}`;
    return NextResponse.json({ ok: true, link: url, item }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


