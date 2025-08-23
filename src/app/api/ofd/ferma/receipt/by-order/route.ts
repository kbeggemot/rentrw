import { NextResponse } from 'next/server';
import { getInvoiceIdString } from '@/server/orderStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, fermaGetReceiptStatusDetailed, fermaGetReceiptExtended, buildReceiptViewUrl } from '@/server/ofdFerma';
import { listSales, listAllSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';

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
            // последовательные вызовы с небольшими задержками, чтобы не ловить 429
            const extended = await fermaGetReceiptExtended({ receiptId: String(ridX), dateFromIncl: startParam, dateToIncl: endParam, fn: (sale as any)?.fn, zn: (sale as any)?.zn }, { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) }));
            await new Promise((r) => setTimeout(r, 350));
            const detailed = await fermaGetReceiptStatusDetailed(String(ridX), { startUtc: startParam.replace(' ', 'T'), endUtc: endParam.replace(' ', 'T'), startLocal: startParam.replace(' ', 'T'), endLocal: endParam.replace(' ', 'T') }, { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) } as any));
            await new Promise((r) => setTimeout(r, 350));
            const statusObj = await fermaGetReceiptStatus(String(ridX), { baseUrl, authToken: token })
              .catch((e: any) => ({ rawStatus: 0, rawText: JSON.stringify({ error: String(e?.message || e) }) } as any));
            return { receiptId: ridX, extended, detailed, status: statusObj };
          }
          const list = [ridFull, ridPrepay].filter((x): x is string => !!x);
          const uniq = Array.from(new Set(list));
          const receipts: any[] = [];
          for (const rid of uniq) {
            receipts.push(await triple(rid));
            await new Promise((r) => setTimeout(r, 350));
          }
          // Try to persist found links into local store (best effort)
          try {
            const patch: any = {};
            for (const rec of receipts) {
              const take = (txt?: string) => {
                if (!txt) return { url: undefined as string | undefined, invoice: undefined as string | undefined };
                try {
                  const obj = txt ? JSON.parse(txt) : null;
                  let url: string | undefined;
                  let invoice: string | undefined;
                  const dev = obj?.Data?.Device;
                  if (dev?.OfdReceiptUrl) url = dev.OfdReceiptUrl as string;
                  if (!url) {
                    const fn = dev?.FN || obj?.Data?.Fn || obj?.Fn || obj?.Data?.Receipts?.[0]?.FnNumber;
                    const fd = dev?.FDN || obj?.Data?.Fd || obj?.Fd || obj?.Data?.Receipts?.[0]?.FDN;
                    const fp = dev?.FPD || obj?.Data?.Fp || obj?.Fp || obj?.Data?.Receipts?.[0]?.DecimalFiscalSign;
                    if (fn && fd != null && fp != null) url = buildReceiptViewUrl(fn, fd, fp);
                  }
                  invoice = obj?.Data?.InvoiceId || obj?.InvoiceId || obj?.Data?.Receipts?.[0]?.InvoiceId || obj?.Data?.Receipt?.InvoiceId;
                  return { url, invoice };
                } catch { return { url: undefined, invoice: undefined }; }
              };
              const s1 = take(rec.status?.rawText);
              const s2 = take(rec.detailed?.rawText);
              const s3 = take(rec.extended?.rawText);
              const url = s1.url || s2.url || s3.url;
              const invoice = s1.invoice || s2.invoice || s3.invoice;
              if (!url) continue;
              const isFullByRid = rec.receiptId === ridFull;
              const isPrepayByRid = rec.receiptId === ridPrepay;
              const isPrepayByInv = /\-A\-/.test(String(invoice || '')); // A=prepay
              const isFullByInv = /\-B\-/.test(String(invoice || '')) || /\-C\-/.test(String(invoice || ''));
              if (isPrepayByRid || isPrepayByInv) patch.ofdUrl = url;
              else if (isFullByRid || isFullByInv) patch.ofdFullUrl = url;
            }
            if (Object.keys(patch).length > 0) {
              let uid: string | null = userId;
              if (!uid) {
                try {
                  const all = await listAllSales();
                  const found = all.find((s) => Number(s.orderId) === Number(orderId));
                  uid = found?.userId ? String(found.userId) : null;
                } catch {}
              }
              if (uid) {
                await updateSaleOfdUrlsByOrderId(uid, orderId, patch);
              }
            }
          } catch {}
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


