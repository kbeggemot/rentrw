import { NextResponse } from 'next/server';
import { getInvoiceIdString } from '@/server/orderStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, fermaGetReceiptStatusDetailed } from '@/server/ofdFerma';
import { listSales } from '@/server/taskStore';

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
    const url = new URL(req.url);
    const userId = getUserId(req);
    const orderParam = url.searchParams.get('order');
    if (!orderParam) return NextResponse.json({ error: 'NO_ORDER' }, { status: 400 });
    const orderId = Number(orderParam);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });

    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });

    // Prefer ReceiptId from local store if available
    if (userId) {
      try {
        const sale = (await listSales(userId)).find((s) => Number(s.orderId) === Number(orderId));
        const rid = (sale as any)?.ofdFullId || (sale as any)?.ofdPrepayId || null;
        if (rid) {
          // Try detailed first using created/end dates to maximize chance of full receipt
          const createdAt = sale?.createdAtRw || sale?.createdAt;
          const endDate = sale?.serviceEndDate || undefined;
          const startUtc = (createdAt ? new Date(createdAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 19);
          const endUtc = (endDate ? new Date(`${endDate}T23:59:59Z`) : new Date()).toISOString().slice(0, 19);
          let byRid = await fermaGetReceiptStatusDetailed(String(rid), { startUtc, endUtc, startLocal: startUtc, endLocal: endUtc }, { baseUrl, authToken: token });
          // Fallback to minimal if still not full
          if (byRid.rawStatus === 404 || !byRid.rawText || byRid.rawText.indexOf('CustomerReceipt') === -1) {
            byRid = await fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token });
          }
          return NextResponse.json(byRid, { status: byRid.rawStatus || 200 });
        }
      } catch {}
    }

    // Fallback to InvoiceId
    const invoiceId = await getInvoiceIdString(orderId);
    const resp = await fermaGetReceiptStatus(invoiceId, { baseUrl, authToken: token });
    return NextResponse.json(resp, { status: resp.rawStatus || 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


