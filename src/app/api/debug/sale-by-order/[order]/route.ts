import { NextResponse } from 'next/server';
import { list, readText } from '@/server/storage';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus } from '@/server/ofdFerma';
import { listAllSales } from '@/server/taskStore';

export const runtime = 'nodejs';

function normalizeOrderId(value: unknown): number {
  if (typeof value === 'number') return value;
  const m = String(value ?? '').match(/(\d+)/g);
  return m && m.length > 0 ? Number(m[m.length - 1]) : NaN;
}

function safeJsonParse(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

function ymdMoscow(ts: string | Date | null | undefined): string | null {
  try {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); // YYYY-MM-DD
  } catch {
    return null;
  }
}

type Mapping = { inn: string; userId: string; taskId: string | number };

function sanitizeInn(inn: string | null | undefined): string {
  const d = (inn || '').toString().replace(/\D/g, '');
  return d || 'unknown';
}

async function findSaleMappingByOrder(orderId: number): Promise<Mapping | null> {
  // 1) Fast path: by-order index (added in newer versions)
  try {
    const raw = await readText(`.data/sales_index/by_order/${String(orderId)}.json`);
    if (raw) {
      const d = safeJsonParse(raw);
      const inn = typeof d?.inn === 'string' ? d.inn : null;
      const userId = typeof d?.userId === 'string' ? d.userId : null;
      const taskId = (typeof d?.taskId === 'string' || typeof d?.taskId === 'number') ? d.taskId : null;
      if (inn && userId && taskId != null) return { inn, userId, taskId };
    }
  } catch {}

  // 2) Scan org indexes (robust; works for older data)
  let keys: string[] = [];
  try { keys = await list('.data/sales'); } catch { keys = []; }
  const idxKeys = keys.filter((p) => /\.data\/sales\/[^/]+\/index\.json$/.test(p));
  for (const p of idxKeys) {
    const parts = p.split('/');
    const inn = parts[2] || '';
    if (!inn) continue;
    try {
      const raw = await readText(p);
      if (!raw) continue;
      const rows = safeJsonParse(raw);
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const oid = normalizeOrderId((r as any)?.orderId);
        if (Number.isFinite(oid) && oid === orderId) {
          const userId = String((r as any)?.userId || '').trim();
          const taskId = (r as any)?.taskId;
          if (!userId || (typeof taskId === 'undefined' || taskId === null)) continue;
          return { inn, userId, taskId: (typeof taskId === 'number' || typeof taskId === 'string') ? taskId : String(taskId) };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function readSaleByMapping(m: Mapping): Promise<any | null> {
  try {
    const raw = await readText(`.data/sales/${m.inn}/sales/${encodeURIComponent(String(m.taskId))}.json`);
    if (!raw) return null;
    return safeJsonParse(raw);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const orderStr = decodeURIComponent(segs[segs.length - 1] || '');
    const orderId = Number(orderStr);
    if (!Number.isFinite(orderId)) return NextResponse.json({ ok: false, error: 'BAD_ORDER' }, { status: 400 });

    let mapping = await findSaleMappingByOrder(orderId);
    let sale: any | null = null;

    if (mapping) {
      sale = await readSaleByMapping(mapping);
    }

    // Fallback: legacy monolithic store (older sales) — listAllSales reads .data/tasks.json
    if (!sale) {
      try {
        const all = await listAllSales();
        const found = all.find((s: any) => normalizeOrderId(s?.orderId) === orderId) || null;
        if (found) {
          mapping = mapping || { inn: sanitizeInn(found?.orgInn || null), userId: String(found?.userId || ''), taskId: (found?.taskId as any) };
          sale = found;
        }
      } catch {}
    }

    if (!mapping) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    if (!sale) return NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND', mapping }, { status: 404 });

    const saleOrderId = normalizeOrderId(sale?.orderId);
    const endDate = typeof sale?.serviceEndDate === 'string' ? sale.serviceEndDate : null;
    const paidAt = typeof sale?.paidAt === 'string' ? sale.paidAt : null;
    const paidMsk = ymdMoscow(paidAt || new Date().toISOString());
    const isSameDay = Boolean(endDate && paidMsk && endDate === paidMsk);

    const invoiceIdPrepay = (sale?.invoiceIdPrepay ?? null) as string | null;
    const invoiceIdOffset = (sale?.invoiceIdOffset ?? null) as string | null;
    const invoiceIdFull = (sale?.invoiceIdFull ?? null) as string | null;
    const ofdUrl = (sale?.ofdUrl ?? null) as string | null;
    const ofdFullUrl = (sale?.ofdFullUrl ?? null) as string | null;
    const ofdPrepayId = (sale?.ofdPrepayId ?? null) as string | null;
    const ofdFullId = (sale?.ofdFullId ?? null) as string | null;

    const nowMsk = ymdMoscow(new Date().toISOString());
    const mskHour = (() => {
      try {
        const s = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false });
        return Number(String(s).replace(/[^0-9]/g, '') || '0');
      } catch { return 0; }
    })();
    const dueOffset = Boolean(endDate && nowMsk && (endDate < nowMsk || (endDate === nowMsk && mskHour >= 12)));

    const expectation = (() => {
      // The system has two paths:
      // - same-day settlement: InvoiceId C (invoiceIdFull) -> чек полного расчёта (Income) stored as ofdFull*
      // - deferred settlement: InvoiceId A (prepay) now, InvoiceId B (offset) at 12:00 MSK on/after endDate, stored as ofdFull*
      if (!endDate) {
        return { path: 'full_same_day', needs: { invoiceIdFull: true }, note: 'serviceEndDate не задан — трактуем как расчёт день-в-день (InvoiceId C)' } as const;
      }
      if (isSameDay) {
        return { path: 'full_same_day', needs: { invoiceIdFull: true }, note: 'оплата и дата оказания совпали по МСК — должен быть чек C (Income)' } as const;
      }
      return { path: 'prepay_then_offset', needs: { invoiceIdPrepay: true, invoiceIdOffset: true }, note: 'дата оказания НЕ совпала с оплатой по МСК — A сейчас, B (offset) после 12:00 МСК в дату оказания' } as const;
    })();

    const whyNoFull = (() => {
      if (ofdFullUrl) return null;
      if (expectation.path === 'full_same_day') {
        if (!invoiceIdFull) return 'invoiceIdFull отсутствует (чек C не может быть создан)';
        if (!ofdFullId) return 'ofdFullId отсутствует — чек C не был создан/не сохранён (нужно смотреть postback/repair_worker и OFD логи)';
        return 'ofdFullId есть, но ссылка (ofdFullUrl) ещё не подтянулась (должно заполниться колбэком OFD или /api/sales/by-order)';
      }
      // prepay_then_offset
      if (!invoiceIdOffset) return 'invoiceIdOffset отсутствует (чек B/offset не может быть создан)';
      if (!dueOffset) return 'чек B/offset ещё не “должен” быть создан: ждём 12:00 МСК на дату оказания услуги (или дату в прошлом)';
      return 'чек B/offset должен был появиться, но ofdFullId/ofdFullUrl пустые — проверь BACKGROUND_WORKERS/leader и логи OFD (schedule_worker/repair_worker)';
    })();

    const probe = url.searchParams.get('probe') === '1';
    const ferma: any = probe ? { attempted: true } : { attempted: false };
    if (probe) {
      try {
        const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
        const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
        const checks: Array<{ kind: string; id: string; ok: boolean; rawStatus?: number; sample?: string; error?: string }> = [];
        const tryCheck = async (kind: string, id: string | null) => {
          if (!id) return;
          try {
            const st = await fermaGetReceiptStatus(String(id), { baseUrl, authToken: token });
            checks.push({ kind, id: String(id), ok: true, rawStatus: st.rawStatus, sample: st.rawText ? st.rawText.slice(0, 300) : '' });
          } catch (e) {
            checks.push({ kind, id: String(id), ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        };
        await tryCheck('ofdFullId', ofdFullId);
        await tryCheck('ofdPrepayId', ofdPrepayId);
        await tryCheck('invoiceIdFull', invoiceIdFull);
        await tryCheck('invoiceIdOffset', invoiceIdOffset);
        await tryCheck('invoiceIdPrepay', invoiceIdPrepay);
        ferma.checks = checks;
      } catch (e) {
        ferma.error = e instanceof Error ? e.message : String(e);
      }
    }

    // Return redacted sale fields (avoid leaking PII in debug endpoint)
    const saleView = {
      taskId: sale?.taskId ?? null,
      orderId: sale?.orderId ?? null,
      orgInn: sale?.orgInn ?? null,
      status: sale?.status ?? null,
      rootStatus: sale?.rootStatus ?? null,
      paidAt: sale?.paidAt ?? null,
      createdAtRw: sale?.createdAtRw ?? null,
      createdAt: sale?.createdAt ?? null,
      serviceEndDate: sale?.serviceEndDate ?? null,
      vatRate: sale?.vatRate ?? null,
      isAgent: Boolean(sale?.isAgent),
      amountGrossRub: sale?.amountGrossRub ?? null,
      retainedCommissionRub: sale?.retainedCommissionRub ?? null,
      invoiceIdPrepay: sale?.invoiceIdPrepay ?? null,
      invoiceIdOffset: sale?.invoiceIdOffset ?? null,
      invoiceIdFull: sale?.invoiceIdFull ?? null,
      ofdUrl: sale?.ofdUrl ?? null,
      ofdFullUrl: sale?.ofdFullUrl ?? null,
      ofdPrepayId: sale?.ofdPrepayId ?? null,
      ofdFullId: sale?.ofdFullId ?? null,
      additionalCommissionOfdUrl: sale?.additionalCommissionOfdUrl ?? null,
      npdReceiptUri: sale?.npdReceiptUri ?? null,
      // clientEmail is PII; expose only a boolean
      hasClientEmail: Boolean(sale?.clientEmail),
    };

    return NextResponse.json({
      ok: true,
      orderId,
      mapping,
      foundOrderId: saleOrderId,
      time: { nowMsk, mskHour, paidMsk, dueOffset },
      expectation,
      whyNoFullReceipt: whyNoFull,
      sale: saleView,
      ferma,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}


