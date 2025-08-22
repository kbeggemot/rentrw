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

    function extractReceiptIdsFromStatus(rawText: string): string[] {
      const ids: string[] = [];
      try {
        const obj = rawText ? JSON.parse(rawText) : {};
        const rid1 = obj?.Data?.ReceiptId || obj?.ReceiptId;
        if (rid1) ids.push(String(rid1));
        const list = obj?.Data?.Receipts || obj?.Receipts;
        if (Array.isArray(list)) {
          for (const it of list) {
            const rid = it?.ReceiptId || it?.Id || it?.id;
            if (rid) ids.push(String(rid));
          }
        }
      } catch {}
      return Array.from(new Set(ids));
    }

    async function classifyByRid(rid: string): Promise<{ pm?: number; pt?: number; url?: string; rid: string }> {
      const [ext, det, min] = await Promise.all([
        fermaGetReceiptExtended({ receiptId: String(rid), dateFromIncl, dateToIncl }, { baseUrl, authToken: token }).catch(() => ({ rawText: '' })),
        fermaGetReceiptStatusDetailed(String(rid), { startUtc: dateFromIncl.replace(' ', 'T'), endUtc: dateToIncl.replace(' ', 'T'), startLocal: dateFromIncl.replace(' ', 'T'), endLocal: dateToIncl.replace(' ', 'T') }, { baseUrl, authToken: token }).catch(() => ({ rawText: '' } as any)),
        fermaGetReceiptStatus(String(rid), { baseUrl, authToken: token }).catch(() => ({ rawText: '' } as any)),
      ]);
      let pm: number | undefined; let pt: number | undefined; let url: string | undefined;
      try { const o = ext.rawText ? JSON.parse(ext.rawText) : {}; const item = o?.Data?.Receipts?.[0]?.Items?.[0]; if (item && typeof item.CalculationMethod === 'number') pm = item.CalculationMethod; } catch {}
      try { const o = det.rawText ? JSON.parse(det.rawText) : {}; const cr = o?.Data?.[0]?.Receipt?.CustomerReceipt ?? o?.Data?.CustomerReceipt; const it = cr?.Items?.[0]; if (it && typeof it.PaymentMethod === 'number') pm = pm ?? it.PaymentMethod; const pi = Array.isArray(cr?.PaymentItems) ? cr.PaymentItems[0] : undefined; if (pi && typeof pi.PaymentType === 'number') pt = pi.PaymentType; } catch {}
      try { const o = min.rawText ? JSON.parse(min.rawText) : {}; const direct: string | undefined = o?.Data?.Device?.OfdReceiptUrl; const fn = o?.Data?.Fn || o?.Fn; const fd = o?.Data?.Fd || o?.Fd; const fp = o?.Data?.Fp || o?.Fp; url = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined); } catch {}
      return { pm, pt, url, rid: String(rid) };
    }

    let changed = false;
    const ensureCleanMismatch = async (cls: { pm?: number; url?: string; rid: string }) => {
      if (!strict) return;
      if (!cls.url || typeof cls.pm !== 'number') return;
      // чистим только ту колонку, где контент не соответствует типу
      if (cls.pm === 1) {
        // это предоплата — удалим из полного, если там лежит тот же чек
        if (sale.ofdFullUrl === cls.url || sale.ofdFullId === cls.rid) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: sale.ofdFullUrl === cls.url ? null : sale.ofdFullUrl, ofdFullId: sale.ofdFullId === cls.rid ? null : sale.ofdFullId });
          changed = true;
        }
      } else if (cls.pm === 4) {
        // это полный — удалим из предоплаты, если там лежит тот же чек
        if (sale.ofdUrl === cls.url || sale.ofdPrepayId === cls.rid) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: sale.ofdUrl === cls.url ? null : sale.ofdUrl, ofdPrepayId: sale.ofdPrepayId === cls.rid ? null : sale.ofdPrepayId });
          changed = true;
        }
      }
    };
    // Обрабатываем id предоплаты
    if (sale.ofdPrepayId) {
      const cls = await classifyByRid(sale.ofdPrepayId);
      if (cls.pm === 1) {
        // должен быть в предоплате
        if (cls.url && sale.ofdUrl !== cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: cls.url, ofdPrepayId: sale.ofdPrepayId || cls.rid }); changed = true; }
        await ensureCleanMismatch({ pm: 1, url: cls.url, rid: cls.rid });
      } else if (cls.pm === 4) {
        // неверно записан как предоплата — перенесём в полный; при strict удаляем из предоплаты
        if (cls.url) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: cls.url, ofdFullId: sale.ofdFullId || cls.rid });
          await ensureCleanMismatch({ pm: 4, url: cls.url, rid: cls.rid });
          changed = true;
        }
      }
    }
    // Обрабатываем id полного расчёта
    if (sale.ofdFullId) {
      const cls = await classifyByRid(sale.ofdFullId);
      if (cls.pm === 4) {
        if (cls.url && sale.ofdFullUrl !== cls.url) { try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {} await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdFullUrl: cls.url, ofdFullId: sale.ofdFullId || cls.rid }); changed = true; }
        await ensureCleanMismatch({ pm: 4, url: cls.url, rid: cls.rid });
      } else if (cls.pm === 1) {
        if (cls.url) {
          try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
          await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: cls.url, ofdPrepayId: sale.ofdPrepayId || cls.rid });
          await ensureCleanMismatch({ pm: 1, url: cls.url, rid: cls.rid });
          changed = true;
        }
      }
    }

    // Если ReceiptId отсутствуют или дублируются — попробуем восстановить(найти все) по InvoiceId (получим массив)
    if (!sale.ofdPrepayId || !sale.ofdFullId || sale.ofdPrepayId === sale.ofdFullId) {
      try {
        const stored: string[] = [];
        if (sale.invoiceIdPrepay) stored.push(String(sale.invoiceIdPrepay));
        if (sale.invoiceIdOffset) stored.push(String(sale.invoiceIdOffset));
        if (sale.invoiceIdFull) stored.push(String(sale.invoiceIdFull));
        let invoiceIds: string[] = Array.from(new Set(stored));
        if (invoiceIds.length === 0) {
          return NextResponse.json({ ok: true, changed: false });
        }
        const receipts: string[] = [];
        for (const inv of invoiceIds) {
          const resp = await fermaGetReceiptStatus(String(inv), { baseUrl, authToken: token });
          receipts.push(...extractReceiptIdsFromStatus(resp.rawText || ''));
        }
        const candidates = Array.from(new Set(receipts))
          .filter((rid) => rid && rid !== sale.ofdPrepayId && rid !== sale.ofdFullId);
        for (const rid of candidates) {
          const cls = await classifyByRid(rid);
          if (cls.pm === 1) {
            const patch: any = { ofdPrepayId: rid };
            if (cls.url) patch.ofdUrl = cls.url;
            try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
            await updateSaleOfdUrlsByOrderId(userId, orderId, patch);
            await ensureCleanMismatch({ pm: 1, url: cls.url, rid });
            changed = true;
          } else if (cls.pm === 4) {
            const patch: any = { ofdFullId: rid };
            if (cls.url) patch.ofdFullUrl = cls.url;
            try { (global as any).__OFD_SOURCE__ = 'fix_duplicates'; } catch {}
            await updateSaleOfdUrlsByOrderId(userId, orderId, patch);
            await ensureCleanMismatch({ pm: 4, url: cls.url, rid });
            changed = true;
          }
        }
      } catch {}
    }

    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


