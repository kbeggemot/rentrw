import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl, fermaGetReceiptExtended, fermaGetReceiptStatusDetailed } from '@/server/ofdFerma';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

async function classifySaleWithOfd(sale: any): Promise<Array<{ pm?: number; pt?: number; url?: string; rid: string }>> {
  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });

  const createdAt = sale?.createdAtRw || sale?.createdAt;
  const endDate = sale?.serviceEndDate || undefined;
  const startBase = createdAt ? new Date(createdAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endBase = endDate ? new Date(`${endDate}T23:59:59Z`) : new Date();
  const startExt = new Date(startBase.getTime() - 24 * 60 * 60 * 1000);
  const endExt = new Date(endBase.getTime() + 24 * 60 * 60 * 1000);
  function formatMsk(d: Date): string {
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
    const map: Record<string, string> = {}; for (const p of parts) { if (p.type !== 'literal') map[p.type] = p.value; }
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  }
  const dateFromIncl = formatMsk(startExt).replace(/\u00A0/g, ' ').trim();
  const dateToIncl = formatMsk(endExt).replace(/\u00A0/g, ' ').trim();

  async function byRid(rid: string): Promise<{ pm?: number; pt?: number; url?: string; rid: string }> {
    const [ext, det, min] = await Promise.all([
      fermaGetReceiptExtended({ receiptId: String(rid), dateFromIncl, dateToIncl }, { baseUrl, authToken: token }).catch(() => ({ rawStatus: 0, rawText: '' })),
      fermaGetReceiptStatusDetailed(String(rid), { startUtc: dateFromIncl.replace(' ', 'T'), endUtc: dateToIncl.replace(' ', 'T'), startLocal: dateFromIncl.replace(' ', 'T'), endLocal: dateToIncl.replace(' ', 'T') }, { baseUrl, authToken: token }).catch(() => ({ rawStatus: 0, rawText: '' } as any)),
      fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token }).catch(() => ({ rawStatus: 0, rawText: '' } as any)),
    ]);
    let pm: number | undefined; let pt: number | undefined; let url: string | undefined; let outRid: string | undefined;
    try { const o = ext.rawText ? JSON.parse(ext.rawText) : {}; const item = o?.Data?.Receipts?.[0]?.Items?.[0]; if (item && typeof item.CalculationMethod === 'number') pm = item.CalculationMethod; } catch {}
    try { const o = det.rawText ? JSON.parse(det.rawText) : {}; const cr = o?.Data?.[0]?.Receipt?.CustomerReceipt ?? o?.Data?.CustomerReceipt; const it = cr?.Items?.[0]; if (it && typeof it.PaymentMethod === 'number') pm = pm ?? it.PaymentMethod; const pi = Array.isArray(cr?.PaymentItems) ? cr.PaymentItems[0] : undefined; if (pi && typeof pi.PaymentType === 'number') pt = pi.PaymentType; } catch {}
    try { const o = min.rawText ? JSON.parse(min.rawText) : {}; outRid = o?.Data?.ReceiptId || o?.ReceiptId || outRid; const direct: string | undefined = o?.Data?.Device?.OfdReceiptUrl; const fn = o?.Data?.Fn || o?.Fn; const fd = o?.Data?.Fd || o?.Fd; const fp = o?.Data?.Fp || o?.Fp; url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : url); } catch {}
    return { pm, pt, url, rid: (outRid || rid) };
  }

  const ridList: string[] = [];
  if (sale?.ofdFullId) ridList.push(String(sale.ofdFullId));
  if (sale?.ofdPrepayId) ridList.push(String(sale.ofdPrepayId));
  const uniq = Array.from(new Set(ridList));
  if (uniq.length > 0) {
    const results = await Promise.all(uniq.map(byRid));
    return results;
  }

  // Fallback by InvoiceId: get minimal to resolve ReceiptId then repeat
  try {
    const { getInvoiceIdString } = await import('@/server/orderStore');
    const invoiceId = await getInvoiceIdString(sale.orderId);
    const min = await fermaGetReceiptStatus(String(invoiceId), { baseUrl, authToken: token });
    const obj = min.rawText ? JSON.parse(min.rawText) : {};
    const direct: string | undefined = obj?.Data?.Device?.OfdReceiptUrl; const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
    const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
    rid = (obj?.Data?.ReceiptId || obj?.ReceiptId) as string | undefined;
    if (rid) {
      const rest = await byRid(rid);
      return [{ pm: rest.pm, pt: rest.pt, url: rest.url || url, rid: rest.rid || rid }];
    }
    return url ? [{ url, rid: 'unknown' }] : [];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => ({} as any));
    const onlyOrder = body?.order as number | string | undefined;
    const salesAll = await listSales(userId);
    const sales = onlyOrder ? salesAll.filter((s) => String(s.orderId) === String(onlyOrder)) : salesAll;
    let fixed = 0;
    for (const s of sales) {
      const patch: any = {};
      const results = await classifySaleWithOfd(s);
      for (const r of results) {
        if (typeof r.pm === 'number' && r.url) {
          if (r.pm === 1) {
            patch.ofdUrl = patch.ofdUrl ?? r.url;
            if (r.rid && !patch.ofdPrepayId) patch.ofdPrepayId = r.rid;
          } else if (r.pm === 4) {
            patch.ofdFullUrl = patch.ofdFullUrl ?? r.url;
            if (r.rid && !patch.ofdFullId) patch.ofdFullId = r.rid;
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        try { (global as any).__OFD_SOURCE__ = 'reclassify'; } catch {}
        await updateSaleOfdUrlsByOrderId(userId, s.orderId, patch);
        fixed += 1;
      }
    }
    return NextResponse.json({ ok: true, fixed, processed: sales.map((x) => x.orderId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // convenience GET wrapper for manual run
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const url = new URL(req.url);
    const order = url.searchParams.get('order');
    const r = await POST(new Request(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify({ order }) }));
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


