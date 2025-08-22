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
        const ridFull: string | null = (sale as any)?.ofdFullId || null;
        const ridPrepay: string | null = (sale as any)?.ofdPrepayId || null;
        const rid = ridFull || ridPrepay;
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
          async function triple(ridX: string) {
            const extP = fermaGetReceiptExtended({ receiptId: String(ridX), dateFromIncl: startParam, dateToIncl: endParam, fn: (sale as any)?.fn, zn: (sale as any)?.zn }, { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) }));
            const detP = fermaGetReceiptStatusDetailed(String(ridX), { startUtc: startParam.replace(' ', 'T'), endUtc: endParam.replace(' ', 'T'), startLocal: startParam.replace(' ', 'T'), endLocal: endParam.replace(' ', 'T') }, { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) } as any));
            const minP = fermaGetReceiptStatus(String(ridX), { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) } as any));
            const [extended, detailed, statusObj] = await Promise.all([extP, detP, minP]);
            return { receiptId: ridX, extended, detailed, status: statusObj };
          }
          const list = [ridFull, ridPrepay].filter((x): x is string => !!x);
          const uniq = Array.from(new Set(list));
          const receipts = await Promise.all(uniq.map(triple));
          if (receipts.length > 0) return NextResponse.json({ receipts }, { status: 200 });
          return NextResponse.json({ extended: null, detailed: null, status: null }, { status: 200 });
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


