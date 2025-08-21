import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

async function getFermaStatusByKey(key: string | number) {
  const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
  const st = await fermaGetReceiptStatus(String(key), { baseUrl, authToken: token });
  const obj = st.rawText ? JSON.parse(st.rawText) : {};
  const type = (obj?.Data?.Request?.Type || obj?.Request?.Type || '').toString();
  const direct: string | undefined = obj?.Data?.Device?.OfdReceiptUrl;
  const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
  const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
  return { type, url } as const;
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
      // Prefer explicit receipt ids if present
      if ((s as any).ofdPrepayId) {
        try {
          const st = await getFermaStatusByKey((s as any).ofdPrepayId!);
          if (/IncomePrepayment/i.test(st.type) && st.url) patch.ofdUrl = st.url;
        } catch {}
      }
      if ((s as any).ofdFullId) {
        try {
          const st = await getFermaStatusByKey((s as any).ofdFullId!);
          if ((/(^|[^A-Za-z])Income($|[^A-Za-z])/i.test(st.type)) && st.url) patch.ofdFullUrl = st.url;
        } catch {}
      }
      // If still missing or misfiled, try by InvoiceId
      if (!patch.ofdUrl || !patch.ofdFullUrl) {
        try {
          const { getInvoiceIdString } = await import('@/server/orderStore');
          const invoiceId = await getInvoiceIdString(s.orderId);
          const st2 = await getFermaStatusByKey(invoiceId);
          if (/IncomePrepayment/i.test(st2.type) && st2.url) patch.ofdUrl = st2.url;
          else if ((/(^|[^A-Za-z])Income($|[^A-Za-z])/i.test(st2.type)) && st2.url) patch.ofdFullUrl = st2.url;
        } catch {}
      }
      if (Object.keys(patch).length > 0) {
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


