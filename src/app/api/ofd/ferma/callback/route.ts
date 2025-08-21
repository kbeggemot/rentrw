import { NextResponse } from 'next/server';
import { upsertOfdReceipt } from '@/server/ofdStore';
import { updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';
import { writeText } from '@/server/storage';

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
    // Try to detect PaymentItems[].PaymentType (2=offset). Value 1 is NOT prepayment marker.
    const pt = (body?.Data?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.PaymentItems?.[0]?.PaymentType) as number | undefined;
    const docTypeRaw = (body?.Data?.Request?.Type || body?.Request?.Type || '').toString();
    // Build viewer link if parts are known
    let receiptUrl: string | undefined;
    if (fn && fd != null && fp != null) { receiptUrl = buildReceiptViewUrl(fn, fd, fp); }
    // Also check direct URL if Ferma provides it
    if (!receiptUrl) {
      const directUrl: string | undefined = body?.Data?.Device?.OfdReceiptUrl || body?.Device?.OfdReceiptUrl;
      if (typeof directUrl === 'string' && directUrl.length > 0) receiptUrl = directUrl;
    }
    // If callback does not include Fn/Fd/Fp — fetch receipt status from Ferma to build link (with short retries)
    if (!receiptUrl && receiptId) {
      const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
      try {
        const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
        let tries = 0;
        while (!receiptUrl && tries < 20) {
          try {
            const st = await fermaGetReceiptStatus(receiptId, { baseUrl, authToken: token });
            const obj = st.rawText ? JSON.parse(st.rawText) : {};
            const fn2 = obj?.Data?.Fn || obj?.Fn;
            const fd2 = obj?.Data?.Fd || obj?.Fd;
            const fp2 = obj?.Data?.Fp || obj?.Fp;
            if (fn2 && fd2 != null && fp2 != null) { receiptUrl = buildReceiptViewUrl(fn2, fd2, fp2); break; }
          } catch {}
          tries += 1;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {}
    }
    if (receiptId) {
      await upsertOfdReceipt({ userId, receiptId, fn: fn ?? null, fd: fd ?? null, fp: fp ?? null, url: receiptUrl ?? null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: body });
    }
    // If we can map by InvoiceId to orderId — update sale record URLs
    // InvoiceId может быть с префиксом: PREFIX-123 → извлекаем последнее число
    let orderId = NaN as number;
    if (typeof invoiceIdRaw === 'string') {
      const m = invoiceIdRaw.match(/(\d+)/g);
      orderId = m && m.length > 0 ? Number(m[m.length - 1]) : NaN;
    } else if (typeof invoiceIdRaw === 'number') {
      orderId = invoiceIdRaw;
    }
    if (Number.isFinite(orderId)) {
      const patch: any = {};
      // Decide classification: offset (pt=2 or docTypeOffset), else by docType or serviceEndDate
      const isOffset = pt === 2 || /IncomePrepaymentOffset/i.test(docTypeRaw);
      let classify: 'prepay' | 'full';
      if (/IncomePrepayment/i.test(docTypeRaw)) classify = 'prepay';
      else if (isOffset || /(^|[^A-Za-z])Income($|[^A-Za-z])/i.test(docTypeRaw)) classify = 'full';
      else {
        // Fallback to serviceEndDate vs today (MSK)
        let isToday = false;
        try {
          const { listSales } = await import('@/server/taskStore');
          const sales = await listSales(String(userId));
          const sale = sales.find((s: any) => Number(s.orderId) === Number(orderId));
          if (sale?.serviceEndDate) {
            const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
            isToday = sale.serviceEndDate === mskToday;
          }
        } catch {}
        classify = isToday ? 'full' : 'prepay';
      }
      if (receiptUrl) {
        if (classify === 'prepay') patch.ofdUrl = receiptUrl; else patch.ofdFullUrl = receiptUrl;
      }
      if (receiptId) {
        if (classify === 'prepay') patch.ofdPrepayId = receiptId; else patch.ofdFullId = receiptId;
      }
      if (Object.keys(patch).length > 0) {
        try { await updateSaleOfdUrlsByOrderId(userId, Number(orderId), patch); } catch {}
      }
    }
    // Debug logs (prod-safe; secret redacted)
    try {
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
      await writeText('.data/ofd_callback_last.json', JSON.stringify(entry, null, 2));
      await writeText('.data/ofd_callbacks.log', (JSON.stringify(entry) + '\n'));
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


