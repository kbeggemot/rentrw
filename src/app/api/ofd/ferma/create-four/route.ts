import { NextResponse } from 'next/server';
import { fermaCreateReceipt, fermaCreateAuthToken } from '@/server/ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_FULL_PAYMENT, PAYMENT_METHOD_PREPAY_FULL, VatRate } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from '@/server/userStore';
import { headers } from 'next/headers';
import { getDecryptedApiToken } from '@/server/secureStore';
import { listPartners } from '@/server/partnerStore';

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
    const body = await req.json().catch(() => ({}));
    const {
      description,
      amountRub,
      vatRate,
      orderId,
      partnerInn,
      partnerPhone,
      advanceOffsetRub,
    } = body as { description?: string; amountRub?: number; vatRate?: VatRate; orderId?: string | number; partnerInn?: string; partnerPhone?: string; advanceOffsetRub?: number };

    const orgInn = await getUserOrgInn(userId);
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG_INN' }, { status: 400 });
    let resolvedPartnerInn = partnerInn || null;
    // Resolve partner INN by phone via RocketWork
    try {
      const phone = (partnerPhone || '').trim() || '+79851679287';
      if (!resolvedPartnerInn && phone) {
        const token = await getDecryptedApiToken(userId);
        if (token) {
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const phoneDigits = phone.replace(/\D/g, '');
          async function getExecutorById(id: string) {
            const url = new URL(`executors/${encodeURIComponent(id)}`, base.endsWith('/') ? base : base + '/').toString();
            const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            const txt = await res.text();
            let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
            return { res, data } as const;
          }
          let chosen = await getExecutorById(phoneDigits);
          if (!chosen.res.ok && chosen.res.status !== 404) {
            chosen = await getExecutorById(phone);
          }
          const inn: string | undefined = (chosen.data?.executor?.inn as string | undefined) ?? (chosen.data?.inn as string | undefined);
          if (inn) resolvedPartnerInn = inn;
        }
      }
    } catch {}
    // Fallback to local partners store
    if (!resolvedPartnerInn && partnerPhone) {
      try {
        const all = await listPartners(userId);
        const p = all.find((x) => x.phone === partnerPhone);
        if (p?.inn) resolvedPartnerInn = p.inn || null;
      } catch {}
    }
    if (!resolvedPartnerInn) return NextResponse.json({ error: 'NO_PARTNER_INN' }, { status: 400 });

    const usedDescription = description || 'Тестовая услуга';
    const usedAmount = typeof amountRub === 'number' ? amountRub : 10;
    const usedVat: VatRate = (vatRate as VatRate) || 'none';
    const makeUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
    });
    const h = await headers();
    const proto = h.get('x-forwarded-proto') || 'http';
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
    const callbackUrl = (body?.callbackUrl && typeof body.callbackUrl === 'string' && body.callbackUrl.trim().length > 0)
      ? String(body.callbackUrl)
      : `${proto}://${host}/api/ofd/ferma/callback`;
    // Получим ФИО/телефон партнёра для SupplierName/SupplierPhone (best-effort)
    let supplierName: string | undefined;
    let supplierPhoneOut: string | undefined;
    try {
      const token = await getDecryptedApiToken(userId);
      const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
      const phoneDigits = (partnerPhone || '').replace(/\D/g, '') || '79851679287';
      if (token) {
        const url = new URL(`executors/${encodeURIComponent(phoneDigits)}`, base.endsWith('/') ? base : base + '/').toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const text = await res.text();
        const data: any = text ? JSON.parse(text) : null;
        const ex = data?.executor ?? data;
        const last = String(ex?.last_name || '').trim();
        const first = String(ex?.first_name || '').trim();
        const second = String(ex?.second_name || '').trim();
        const fio = [last, first, second].filter(Boolean).join(' ').trim();
        supplierName = fio || undefined;
        supplierPhoneOut = (ex?.phone as string | undefined) || partnerPhone || undefined;
      }
    } catch {}

    const prepayPartner = buildFermaReceiptPayload({
      party: 'partner',
      partyInn: resolvedPartnerInn,
      description: usedDescription,
      amountRub: usedAmount,
      vatRate: usedVat,
      methodCode: PAYMENT_METHOD_PREPAY_FULL,
      orderId,
      docType: 'IncomePrepayment',
      buyerEmail: body?.buyerEmail || null,
      invoiceId: makeUuid(),
      callbackUrl,
      paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: resolvedPartnerInn, SupplierName: supplierName, SupplierPhone: supplierPhoneOut },
      withPrepaymentItem: true,
    });
    const fullPartner = buildFermaReceiptPayload({ party: 'partner', partyInn: resolvedPartnerInn, description: usedDescription, amountRub: usedAmount, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId, docType: 'Income', buyerEmail: body?.buyerEmail || null, invoiceId: makeUuid(), withAdvanceOffset: true, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: resolvedPartnerInn, SupplierName: supplierName } });
    // ЮЛ — предоплата: поставщик — наша организация по токену
    const prepayOrg = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: usedDescription, amountRub: usedAmount, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId, docType: 'IncomePrepayment', buyerEmail: body?.buyerEmail || null, invoiceId: makeUuid(), callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: (await getUserPayoutRequisites(userId)).orgName || 'Организация' }, withPrepaymentItem: true });
    const fullOrg = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: usedDescription, amountRub: usedAmount, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId, docType: 'Income', buyerEmail: body?.buyerEmail || null, invoiceId: makeUuid(), withAdvanceOffset: true, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: (await getUserPayoutRequisites(userId)).orgName || 'Организация' } });

    // Obtain AuthToken first (native protocol), fallback to env values
    const baseUrl = 'https://ferma-test.ofd.ru/';
    const login = (body as any)?.login || process.env.FERMA_LOGIN || 'fermatest2';
    const password = (body as any)?.password || process.env.FERMA_PASSWORD || 'Go2999483Mb';
    const auth = await fermaCreateAuthToken(login, password, { baseUrl });
    if (!auth.authToken) {
      return NextResponse.json({ error: 'FERMA_AUTH_FAILED', details: auth.rawText, status: auth.rawStatus }, { status: 502 });
    }
    const authOpts = { baseUrl, authToken: auth.authToken } as const;
    const only = typeof (body as any)?.only === 'string' ? String((body as any).only) : null;
    type Simple = { rawStatus: number; rawText: string };
    let results: Simple[] = [];
    if (only === 'partnerOffset') {
      const r = await fermaCreateReceipt(fullPartner, authOpts);
      results = [{ rawStatus: r.rawStatus || 0, rawText: r.rawText || '' }];
    } else if (only === 'partnerPrepay') {
      const r = await fermaCreateReceipt(prepayPartner, authOpts);
      results = [{ rawStatus: r.rawStatus || 0, rawText: r.rawText || '' }];
    } else if (only === 'orgPrepay') {
      const r = await fermaCreateReceipt(prepayOrg, authOpts);
      results = [{ rawStatus: r.rawStatus || 0, rawText: r.rawText || '' }];
    } else if (only === 'orgOffset') {
      const r = await fermaCreateReceipt(fullOrg, authOpts);
      results = [{ rawStatus: r.rawStatus || 0, rawText: r.rawText || '' }];
    } else {
      const arr = await Promise.all([
        fermaCreateReceipt(prepayPartner, authOpts),
        fermaCreateReceipt(fullPartner, authOpts),
        fermaCreateReceipt(prepayOrg, authOpts),
        fermaCreateReceipt(fullOrg, authOpts),
      ]);
      results = arr.map((r) => ({ rawStatus: r.rawStatus || 0, rawText: r.rawText || '' }));
    }

    // Persist ids for callback lookup convenience
    try {
      const dir = (await import('path')).default.join(process.cwd(), '.data');
      const fs = (await import('fs')).promises;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile((await import('path')).default.join(dir, 'ofd_created_ids.json'), JSON.stringify({ ts: new Date().toISOString(), results }, null, 2), 'utf8');
    } catch {}
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


