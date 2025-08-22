import { NextResponse } from 'next/server';
import { getInvoiceIdString } from '@/server/orderStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, fermaGetReceiptStatusDetailed, fermaGetReceiptExtended } from '@/server/ofdFerma';
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
          const startBase = createdAt ? new Date(createdAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const endBase = endDate ? new Date(`${endDate}T23:59:59Z`) : new Date();
          const startExt = new Date(startBase.getTime() - 24 * 60 * 60 * 1000); // minus 1 day
          const endExt = new Date(endBase.getTime() + 24 * 60 * 60 * 1000); // plus 1 day

          function formatMsk(d: Date): string {
            const parts = new Intl.DateTimeFormat('ru-RU', {
              timeZone: 'Europe/Moscow',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }).formatToParts(d);
            const map: Record<string, string> = {};
            for (const p of parts) { if (p.type !== 'literal') map[p.type] = p.value; }
            // ru-RU returns day/month/year; rebuild YYYY-MM-DD HH:mm:ss
            return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
          }
          const startMsk = formatMsk(startExt);
          const endMsk = formatMsk(endExt);
          const startParam = startMsk.replace(/\u00A0/g, ' ').trim();
          const endParam = endMsk.replace(/\u00A0/g, ' ').trim();
          // 1) Try extended GET first (returns CustomerReceipt)
          const ext = await fermaGetReceiptExtended({ receiptId: String(rid), dateFromIncl: startParam, dateToIncl: endParam, fn: (sale as any)?.fn, zn: (sale as any)?.zn }, { baseUrl, authToken: token });
          if (ext.rawStatus >= 200 && ext.rawStatus < 300 && ext.rawText && ext.rawText.indexOf('CustomerReceipt') !== -1) {
            // Also fetch minimal status to return direct link alongside extended body
            const mini = await fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token });
            return NextResponse.json({ extended: ext, status: mini }, { status: ext.rawStatus });
          }
          // 2) Fallback to detailed POST
          let byRid = await fermaGetReceiptStatusDetailed(String(rid), { startUtc: startParam.replace(' ', 'T'), endUtc: endParam.replace(' ', 'T'), startLocal: startParam.replace(' ', 'T'), endLocal: endParam.replace(' ', 'T') }, { baseUrl, authToken: token });
          if (byRid.rawStatus >= 200 && byRid.rawStatus < 300 && byRid.rawText && byRid.rawText.indexOf('CustomerReceipt') !== -1) {
            return NextResponse.json(byRid, { status: byRid.rawStatus });
          }
          // 3) Fallback to minimal status
          byRid = await fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token });
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


