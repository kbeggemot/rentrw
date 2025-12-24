import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { getSelectedOrgInn } from '@/server/orgContext';
import { fetchWithTimeout, fireAndForgetFetch } from '@/server/http';

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
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    
    const body = await req.json().catch(() => null);
    const phone = String(body?.phone || '').trim();
    if (!phone) return NextResponse.json({ error: 'NO_PHONE' }, { status: 400 });
    
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const digits = phone.replace(/\D/g, '');
    const orgInn = getSelectedOrgInn(req);
    const { token } = await resolveRwTokenWithFingerprint(req, userId, orgInn, null);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
    const commonHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    };
    
    // invite best-effort
    try { 
      fireAndForgetFetch(new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString(), { 
        method: 'POST', 
        headers: { ...commonHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ phone: digits, with_framework_agreement: false }), 
        cache: 'no-store' 
      }, 15_000); 
    } catch {}
    
    const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { cache: 'no-store', headers: commonHeaders }, 15_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `NETWORK_ERROR: ${msg}` }, { status: 502 });
    }
    const txt = await res.text();
    // Persist last executor validate response for debugging
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, 'last_executor_validate.json'), JSON.stringify({ ts: new Date().toISOString(), url, status: res.status, text: txt }, null, 2), 'utf8');
    } catch {}
    let executorData: any = null; 
    try { executorData = txt ? JSON.parse(txt) : null; } catch { executorData = txt; }
    
    // Extract fields defensively from various possible RW shapes
    const raw: any = executorData && typeof executorData === 'object' ? executorData : {};
    const ex = (raw.executor && typeof raw.executor === 'object') ? raw.executor : raw;
    const status: string | undefined = (ex?.selfemployed_status as string | undefined)
      ?? (raw?.selfemployed_status as string | undefined)
      ?? (ex?.status as string | undefined)
      ?? (raw?.status as string | undefined);
    const employmentKindRaw: string | undefined = (ex?.employment_kind as string | undefined) ?? (raw?.employment_kind as string | undefined);
    const isSelfEmployedValidated = Boolean(status && status === 'validated' && ((employmentKindRaw ?? 'selfemployed') === 'selfemployed'));
    const isEntrepreneur = (employmentKindRaw === 'entrepreneur');
    const paymentReadiness: string | undefined = (ex?.payment_readiness as string | undefined) ?? (raw?.payment_readiness as string | undefined);
    const partnerInn = ex?.inn ?? raw?.inn ?? null;
    const fio = ex ? [ex.last_name, ex.first_name, ex.second_name].filter(Boolean).join(' ').trim() || null : null;

    // Check registration first (HTTP 404 or completely empty payload)
    if (res.status === 404 || executorData == null) {
      return NextResponse.json({ 
        error: 'PARTNER_NOT_REGISTERED',
        partnerData: { phone: digits, fio: null, status: null, inn: null, updatedAt: new Date().toISOString() }
      }, { status: 400 });
    }
    
    // Check if RW returned an error
    if (!res.ok) {
      return NextResponse.json({ 
        error: (executorData?.error as string) || 'RW_ERROR',
        partnerData: { phone: digits, fio, status, inn: partnerInn, updatedAt: new Date().toISOString() }
      }, { status: 400 });
    }
    
    // Unified readiness-based gate
    const readiness = paymentReadiness ? String(paymentReadiness).toLowerCase() : undefined;
    if (readiness === 'no_payments') {
      return NextResponse.json({ 
        error: 'PARTNER_NOT_REGISTERED',
        partnerData: { phone: digits, fio, status: status ?? null, inn: partnerInn, updatedAt: new Date().toISOString() }
      }, { status: 400 });
    }
    if (readiness === 'no_requisites') {
      return NextResponse.json({ 
        error: 'PARTNER_NO_PAYMENT_INFO',
        partnerData: { phone: digits, fio, status: status ?? null, inn: partnerInn, updatedAt: new Date().toISOString() }
      }, { status: 400 });
    }
    if (!(readiness === 'all_is_well' || readiness === 'no_tax_payment')) {
      // Fallback to previous logic if readiness is missing in RW payload
      if (!(isSelfEmployedValidated || isEntrepreneur)) {
        const ek = (employmentKindRaw ?? 'selfemployed');
        if (ek === 'selfemployed' && status && status !== 'validated') {
          return NextResponse.json({ 
            error: 'PARTNER_NOT_VALIDATED',
            partnerData: { phone: digits, fio, status: status ?? null, inn: partnerInn, updatedAt: new Date().toISOString() }
          }, { status: 400 });
        }
        return NextResponse.json({ 
          error: status ? 'PARTNER_NOT_VALIDATED_OR_NOT_SE_IP' : 'PARTNER_NOT_REGISTERED',
          partnerData: { phone: digits, fio, status: status ?? null, inn: partnerInn, updatedAt: new Date().toISOString() }
        }, { status: 400 });
      }
    }
    // If readiness allows pay, do not require payment_info even for SE
    
    return NextResponse.json({ ok: true, executor: executorData?.executor || executorData, status, inn: partnerInn, employmentKind: employmentKindRaw ?? null, partnerData: { phone: digits, fio, status, inn: partnerInn, updatedAt: new Date().toISOString(), employmentKind: employmentKindRaw ?? null } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
