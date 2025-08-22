import { NextResponse } from 'next/server';
import { listSales, updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, fermaGetReceiptStatusDetailed, fermaGetReceiptExtended, buildReceiptViewUrl } from '@/server/ofdFerma';

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
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const url = new URL(req.url);
    const orderParam = url.searchParams.get('order');
    const strict = /^(1|true|yes)$/i.test(url.searchParams.get('strict') || '');
    if (!orderParam) return NextResponse.json({ error: 'NO_ORDER' }, { status: 400 });
    const orderId = Number(orderParam);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });

    const sale = (await listSales(userId)).find((s) => Number(s.orderId) === Number(orderId));
    if (!sale) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });

    const createdAt = sale?.createdAtRw || sale?.createdAt;
    const endDate = sale?.serviceEndDate || undefined;
    const startBase = createdAt ? new Date(createdAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endBase = endDate ? new Date(`${endDate}T23:59:59Z`) : new Date();
    const startExt = new Date(startBase.getTime() - 24 * 60 * 60 * 1000);
    const endExt = new Date(endBase.getTime() + 24 * 60 * 60 * 1000);
    const fmtMsk = (d: Date) => {
      const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
      const map: Record<string, string> = {}; for (const p of parts) { if (p.type !== 'literal') map[p.type] = p.value; }
      return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`.replace(/\u00A0/g, ' ').trim();
    };
    const dateFromIncl = fmtMsk(startExt);
    const dateToIncl = fmtMsk(endExt);

    async function classifyByRid(rid: string): Promise<{ pm?: number; pt?: number; url?: string }> {
      const [ext, det, min] = await Promise.all([
        fermaGetReceiptExtended({ receiptId: String(rid), dateFromIncl, dateToIncl }, { baseUrl, authToken: token }).catch(() => ({ rawText: '' })),
        fermaGetReceiptStatusDetailed(String(rid), { startUtc: dateFromIncl.replace(' ', 'T'), endUtc: dateToIncl.replace(' ', 'T'), startLocal: dateFromIncl.replace(' ', 'T'), endLocal: dateToIncl.replace(' ', 'T') }, { baseUrl, authToken: token }).catch(() => ({ rawText: '' } as any)),
        fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token }).catch(() => ({ rawText: '' } as any)),
      ]);
      let pm: number | undefined; let pt: number | undefined; let url: string | undefined;
      try { const o = ext.rawText ? JSON.parse(ext.rawText) : {}; const item = o?.Data?.Receipts?.[0]?.Items?.[0]; if (item && typeof item.CalculationMethod === 'number') pm = item.CalculationMethod; } catch {}
      try { const o = det.rawText ? JSON.parse(det.rawText) : {}; const cr = o?.Data?.[0]?.Receipt?.CustomerReceipt ?? o?.Data?.CustomerReceipt; const it = cr?.Items?.[0]; if (it && typeof it.PaymentMethod === 'number') pm = pm ?? it.PaymentMethod; const pi = Array.isArray(cr?.PaymentItems) ? cr.PaymentItems[0] : undefined; if (pi && typeof pi.PaymentType === 'number') pt = pi.PaymentType; } catch {}
      try { const o = min.rawText ? JSON.parse(min.rawText) : {}; const direct: string | undefined = o?.Data?.Device?.OfdReceiptUrl; const fn = o?.Data?.Fn || o?.Fn; const fd = o?.Data?.Fd || o?.Fd; const fp = o?.Data?.Fp || o?.Fp; url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined); } catch {}
      return { pm, pt, url };
    }

    let changed = false;
    // Обрабатываем id предоплаты
    if (sale.ofdPrepayId) {
      const cls = await classifyByRid(sale.ofdPrepayId);
      if (cls.pm === 1) {
        // должен быть в предоплате
        if (cls.url && sale.ofdUrl !== cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: cls.url }); changed = true; }
        // если лежит в полном — при strict затираем неверную колонку
        if (strict && sale.ofdFullUrl === cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: null }); changed = true; }
      } else if (cls.pm === 4) {
        // неверно записан как предоплата — перенесём в полный; при strict удаляем из предоплаты
        if (cls.url) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: cls.url, ...(strict ? { ofdUrl: null } : {}) });
          changed = true;
        }
      }
    }
    // Обрабатываем id полного расчёта
    if (sale.ofdFullId) {
      const cls = await classifyByRid(sale.ofdFullId);
      if (cls.pm === 4) {
        if (cls.url && sale.ofdFullUrl !== cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: cls.url }); changed = true; }
        if (strict && sale.ofdUrl === cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: null }); changed = true; }
      } else if (cls.pm === 1) {
        if (cls.url) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: cls.url, ...(strict ? { ofdFullUrl: null } : {}) });
          changed = true;
        }
      }
    }

    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


