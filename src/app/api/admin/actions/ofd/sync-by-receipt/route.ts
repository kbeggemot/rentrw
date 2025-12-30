import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { updateSaleOfdUrlsByOrderId, listSales } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function parsePayload(req: Request): Promise<{ userId: string; orderId: number; receiptId: string; target: 'prepay' | 'full' }> {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const userId = String(url.searchParams.get('userId') || '').trim();
    const orderId = Number(url.searchParams.get('orderId'));
    const receiptId = String(url.searchParams.get('receiptId') || '').trim();
    const target = (String(url.searchParams.get('target') || 'full').toLowerCase() === 'prepay') ? 'prepay' : 'full';
    return { userId, orderId, receiptId, target };
  }
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({} as any));
    const userId = String(body?.userId || '').trim();
    const orderId = Number(body?.orderId);
    const receiptId = String(body?.receiptId || '').trim();
    const target = (String(body?.target || 'full').toLowerCase() === 'prepay') ? 'prepay' : 'full';
    return { userId, orderId, receiptId, target };
  }
  const fd = await req.formData().catch(() => null);
  const userId = String(fd?.get('userId') || url.searchParams.get('userId') || '').trim();
  const orderId = Number(fd?.get('orderId') || url.searchParams.get('orderId'));
  const receiptId = String(fd?.get('receiptId') || url.searchParams.get('receiptId') || '').trim();
  const target = (String(fd?.get('target') || url.searchParams.get('target') || 'full').toLowerCase() === 'prepay') ? 'prepay' : 'full';
  return { userId, orderId, receiptId, target };
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
    const { userId, orderId, receiptId, target } = await parsePayload(req);
    if (!userId || !Number.isFinite(orderId) || !receiptId) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
    const st = await fermaGetReceiptStatus(receiptId, { baseUrl, authToken: token });
    const obj = st.rawText ? JSON.parse(st.rawText) : {};
    const fn = obj?.Data?.Fn || obj?.Fn;
    const fd = obj?.Data?.Fd || obj?.Fd;
    const fp = obj?.Data?.Fp || obj?.Fp;
    const rid = obj?.Data?.ReceiptId || obj?.ReceiptId || receiptId;
    const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
    const url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
    const patch: any = {};
    if (target === 'prepay') { patch.ofdPrepayId = rid || null; if (url) patch.ofdUrl = url; }
    else { patch.ofdFullId = rid || null; if (url) patch.ofdFullUrl = url; }
    await updateSaleOfdUrlsByOrderId(userId, orderId, patch);
    return NextResponse.json({ ok: true, patch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


