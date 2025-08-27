import { NextResponse } from 'next/server';
import { upsertOfdReceipt } from '@/server/ofdStore';
import { updateSaleOfdUrlsByOrderId, listSales } from '@/server/taskStore';
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
    // Detect PaymentItems[].PaymentType (2=offset) and Items[0].PaymentMethod (1=prepay, 4=full)
    const pt = (body?.Data?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.CustomerReceipt?.PaymentItems?.[0]?.PaymentType
      ?? body?.PaymentItems?.[0]?.PaymentType) as number | undefined;
    const pm = (body?.Data?.CustomerReceipt?.Items?.[0]?.PaymentMethod
      ?? body?.CustomerReceipt?.Items?.[0]?.PaymentMethod
      ?? body?.Items?.[0]?.PaymentMethod) as number | undefined;
    let docTypeRaw = (body?.Data?.Request?.Type || body?.Request?.Type || '').toString();
    if ((!docTypeRaw || docTypeRaw.length === 0) && (receiptId || invoiceIdRaw)) {
      try {
        const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
        const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
        const key = receiptId || invoiceIdRaw;
        const st = await fermaGetReceiptStatus(String(key), { baseUrl, authToken: token });
        const obj = st.rawText ? JSON.parse(st.rawText) : {};
        const t = (obj?.Data?.Request?.Type || obj?.Request?.Type || '').toString();
        if (t) docTypeRaw = t;
      } catch {}
    }
    // Build viewer link if parts are known
    let receiptUrl: string | undefined;
    if (fn && fd != null && fp != null) { receiptUrl = buildReceiptViewUrl(fn, fd, fp); }
    // Also check direct URL if Ferma provides it
    if (!receiptUrl) {
      const directUrl: string | undefined = body?.Data?.Device?.OfdReceiptUrl || body?.Device?.OfdReceiptUrl;
      if (typeof directUrl === 'string' && directUrl.length > 0) receiptUrl = directUrl;
    }
    // Не блокируем webhook длительным ожиданием: дальнейшее дополучение URL вынесем в фон ниже
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
      const orderNum = Number(orderId);
      // Prefer mapping by stored InvoiceId variants
      let mappedByInvoice = false;
      let targetForUrl: 'prepay' | 'full' | null = null;
      try {
        const sales = await listSales(userId);
        const sale = sales.find((s) => s.orderId === orderNum);
        if (sale && typeof invoiceIdRaw !== 'undefined' && invoiceIdRaw !== null) {
          const invStr = String(invoiceIdRaw);
          if (sale.invoiceIdPrepay && invStr === String(sale.invoiceIdPrepay)) {
            if (receiptUrl) patch.ofdUrl = receiptUrl;
            if (receiptId) patch.ofdPrepayId = receiptId;
            mappedByInvoice = true;
            targetForUrl = 'prepay';
          } else if ((sale.invoiceIdOffset && invStr === String(sale.invoiceIdOffset)) || (sale.invoiceIdFull && invStr === String(sale.invoiceIdFull))) {
            if (receiptUrl) patch.ofdFullUrl = receiptUrl;
            if (receiptId) patch.ofdFullId = receiptId;
            mappedByInvoice = true;
            targetForUrl = 'full';
          }
        }
      } catch {}
      // Fallback mapping by pm/docType if invoice-based mapping not possible
      if (!mappedByInvoice) {
        const isOffset = pt === 2; // unused in mapping but kept for possible future use
        let classify: 'prepay' | 'full' = 'full';
        if (pm === 1) classify = 'prepay';
        else if (pm === 4) classify = 'full';
        else if (/IncomePrepayment/i.test(docTypeRaw)) classify = 'prepay';
        else if (/(^|[^A-Za-z])Income($|[^A-Za-z])/i.test(docTypeRaw)) classify = 'full';
        if (receiptUrl) {
          if (classify === 'prepay') patch.ofdUrl = receiptUrl; else patch.ofdFullUrl = receiptUrl;
        }
        if (receiptId) {
          if (classify === 'prepay') patch.ofdPrepayId = receiptId; else patch.ofdFullId = receiptId;
        }
        targetForUrl = classify;
      }
      // Запишем лог самого обращения к OFD (даже если данных не изменили)
      try {
        const msg = { reason: 'ofd_callback', patchKeys: Object.keys(patch) } as any;
        (global as any).__OFD_SOURCE__ = 'ofd_callback';
        // Ноль‑изменений тоже фиксируем отдельным сообщением через update с пустым эффектом
        await updateSaleOfdUrlsByOrderId(userId, orderNum, patch);
      } catch {}

      // Фоновое дополучение Fn/Fd/Fp для построения viewer‑ссылки, если её нет в колбэке
      try {
        if (!receiptUrl && receiptId && targetForUrl) {
          (async () => {
            try {
              const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
              const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
              let built: string | undefined;
              let tries = 0;
              while (!built && tries < 12) {
                try {
                  const st = await fermaGetReceiptStatus(receiptId, { baseUrl, authToken: token });
                  const obj = st.rawText ? JSON.parse(st.rawText) : {};
                  const fn2 = obj?.Data?.Fn || obj?.Fn;
                  const fd2 = obj?.Data?.Fd || obj?.Fd;
                  const fp2 = obj?.Data?.Fp || obj?.Fp;
                  const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
                  if (typeof direct === 'string' && direct.length > 0) { built = direct; break; }
                  if (fn2 && fd2 != null && fp2 != null) { built = buildReceiptViewUrl(fn2, fd2, fp2); break; }
                } catch {}
                tries += 1;
                await new Promise((r) => setTimeout(r, 400));
              }
              if (built) {
                try { (global as any).__OFD_SOURCE__ = 'ofd_callback'; } catch {}
                const p2: any = targetForUrl === 'prepay' ? { ofdUrl: built } : { ofdFullUrl: built };
                await updateSaleOfdUrlsByOrderId(userId, orderNum, p2);
              }
            } catch {}
          })();
        }
      } catch {}
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


