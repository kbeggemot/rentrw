import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function parsePayload(req: Request): Promise<{ userId: string; invoiceId: string }> {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    return { userId: String(url.searchParams.get('userId') || '').trim(), invoiceId: String(url.searchParams.get('invoiceId') || '').trim() };
  }
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({} as any));
    return { userId: String(body?.userId || '').trim(), invoiceId: String(body?.invoiceId || '').trim() };
  }
  const fd = await req.formData().catch(() => null);
  return {
    userId: String(fd?.get('userId') || url.searchParams.get('userId') || '').trim(),
    invoiceId: String(fd?.get('invoiceId') || url.searchParams.get('invoiceId') || '').trim(),
  };
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  return await POST(req);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const admin = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!admin || admin.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const { userId, invoiceId } = await parsePayload(req);
    if (!userId || !invoiceId) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const sales = await listSales(userId);
    const sale = sales.find((s) => s.invoiceIdPrepay === invoiceId || s.invoiceIdOffset === invoiceId || s.invoiceIdFull === invoiceId);
    if (!sale) return NextResponse.json({ error: 'SALE_NOT_FOUND' }, { status: 404 });
    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
    const st = await fermaGetReceiptStatus(invoiceId, { baseUrl, authToken: token });
    const obj = st.rawText ? JSON.parse(st.rawText) : {};
    const fn = obj?.Data?.Fn || obj?.Fn;
    const fd = obj?.Data?.Fd || obj?.Fd;
    const fp = obj?.Data?.Fp || obj?.Fp;
    const rid = obj?.Data?.ReceiptId || obj?.ReceiptId;
    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
    const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
    if (!rid && !url) return NextResponse.json({ error: 'NO_RECEIPT' }, { status: 404 });
    const isPrepay = sale.invoiceIdPrepay === invoiceId;
    const patch: any = {};
    if (isPrepay) { patch.ofdPrepayId = rid || null; if (url) patch.ofdUrl = url; }
    else { patch.ofdFullId = rid || null; if (url) patch.ofdFullUrl = url; }
    const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
    await updateSaleOfdUrlsByOrderId(userId, numOrder, patch);
    return NextResponse.json({ ok: true, patch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


