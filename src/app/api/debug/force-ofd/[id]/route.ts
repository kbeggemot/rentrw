import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from '@/server/ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from '@/server/userStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const taskId = decodeURIComponent(segs[segs.length - 1] || '');
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const mode = (url.searchParams.get('mode') || 'full').toLowerCase(); // full | prepay
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });

    // Fetch RW task for description/order/partner
    const tUrl = new URL(`tasks/${encodeURIComponent(taskId)}`, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    const txt = await res.text();
    if (!res.ok) return NextResponse.json({ error: 'RW_ERROR', details: txt }, { status: 502 });
    let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    const task = (data && typeof data === 'object' && 'task' in data) ? (data.task as any) : data;
    const orderIdRaw = task?.acquiring_order?.order;
    const orderId = typeof orderIdRaw === 'string' ? Number(orderIdRaw) : (typeof orderIdRaw === 'number' ? orderIdRaw : 0);
    const description = String(task?.services?.[0]?.description || task?.description?.[0] || 'Оплата услуги');
    const amountRub = Number(task?.amount_gross || 0);

    // Build payload (org by default)
    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
    const host = process.env.BASE_HOST || process.env.VERCEL_URL || process.env.RENDER_EXTERNAL_URL || '';
    const secret = process.env.OFD_CALLBACK_SECRET || '';
    const callbackUrl = host ? `https://${host}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}` : undefined;
    const usedVat: any = 'none';
    const party = (url.searchParams.get('party') || 'org').toLowerCase();

    let payload: any = null;
    if (party === 'partner') {
      const partnerInn = url.searchParams.get('partnerInn') || (task?.executor?.inn as string | undefined) || '';
      if (!partnerInn) return NextResponse.json({ error: 'NO_PARTNER_INN' }, { status: 400 });
      if (mode === 'prepay') {
        payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId, docType: 'IncomePrepayment', buyerEmail: null, invoiceId: String(orderId), callbackUrl, withPrepaymentItem: true });
      } else {
        payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId, docType: 'Income', buyerEmail: null, invoiceId: String(orderId), callbackUrl });
      }
    } else {
      const orgInn = await getUserOrgInn(userId);
      const orgData = await getUserPayoutRequisites(userId);
      if (!orgInn) return NextResponse.json({ error: 'NO_ORG_INN' }, { status: 400 });
      if (mode === 'prepay') {
        payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId, docType: 'IncomePrepayment', buyerEmail: null, invoiceId: String(orderId), callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
      } else {
        payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId, docType: 'Income', buyerEmail: null, invoiceId: String(orderId), callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
      }
    }

    const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
    return NextResponse.json({ ok: true, receiptId: created.id || null, rawStatus: created.rawStatus, rawText: created.rawText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


