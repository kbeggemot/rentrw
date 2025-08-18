import { NextResponse } from 'next/server';
import { upsertOfdReceipt } from '@/server/ofdStore';
import { updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { promises as fs } from 'fs';
import path from 'path';

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
    // Optional shared-secret validation
    const reqUrl = new URL(req.url);
    const secret = reqUrl.searchParams.get('secret') || req.headers.get('x-ofd-signature') || '';
    const expected = process.env.OFD_CALLBACK_SECRET || '';
    if (expected && secret !== expected) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const userId = reqUrl.searchParams.get('uid') || getUserId(req) || 'default';
    const text = await req.text();
    let body: any = null; try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    // Expect ReceiptId and links in callback (adjust to actual schema if differs)
    const receiptId: string | undefined = body?.Data?.ReceiptId || body?.ReceiptId || body?.id;
    const fn: string | undefined = body?.Data?.Fn || body?.Fn;
    const fd: string | number | undefined = body?.Data?.Fd || body?.Fd;
    const fp: string | number | undefined = body?.Data?.Fp || body?.Fp;
    const invoiceIdRaw: string | number | undefined = body?.Data?.InvoiceId || body?.InvoiceId || body?.Request?.InvoiceId;
    // Try to detect PaymentItems[].PaymentType (1=prepay, 2=offset)
    const pt = (body?.Data?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.PaymentItems?.[0]?.PaymentType) as number | undefined;
    // Build demo link pattern if parts are known
    let receiptUrl: string | undefined;
    if (fn && fd != null && fp != null) {
      receiptUrl = `https://check-demo.ofd.ru/rec/${encodeURIComponent(fn)}/${encodeURIComponent(String(fd))}/${encodeURIComponent(String(fp))}`;
    }
    if (receiptId) {
      await upsertOfdReceipt({ userId, receiptId, fn: fn ?? null, fd: fd ?? null, fp: fp ?? null, url: receiptUrl ?? null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: body });
    }
    // If we can map by InvoiceId to orderId — update sale record URLs
    const orderId = typeof invoiceIdRaw === 'string' ? Number(invoiceIdRaw) : (typeof invoiceIdRaw === 'number' ? invoiceIdRaw : NaN);
    if (Number.isFinite(orderId)) {
      const patch: any = {};
      if (receiptUrl) {
        if (pt === 1) patch.ofdUrl = receiptUrl;
        else if (pt === 2) patch.ofdFullUrl = receiptUrl;
      }
      if (receiptId) {
        if (pt === 1) patch.ofdPrepayId = receiptId;
        else if (pt === 2) patch.ofdFullId = receiptId;
      }
      if (Object.keys(patch).length > 0) {
        try { await updateSaleOfdUrlsByOrderId(userId, Number(orderId), patch); } catch {}
      }
    }
    // Debug logs (prod-safe; secret redacted)
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      const redacted = new URL(req.url);
      redacted.searchParams.delete('secret');
      const entry = {
        ts: new Date().toISOString(),
        url: redacted.toString(),
        userId,
        invoiceId: invoiceIdRaw ?? null,
        paymentType: pt ?? null,
        receiptId: receiptId ?? null,
        fn: fn ?? null,
        fd: fd ?? null,
        fp: fp ?? null,
        receiptUrl: receiptUrl ?? null,
      } as Record<string, unknown>;
      await fs.writeFile(path.join(dataDir, 'ofd_callback_last.json'), JSON.stringify(entry, null, 2), 'utf8');
      await fs.appendFile(path.join(dataDir, 'ofd_callbacks.log'), JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


