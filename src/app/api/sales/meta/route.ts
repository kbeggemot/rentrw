import { NextResponse } from 'next/server';
import { readUserIndex } from '@/server/salesIndex';
import { readText } from '@/server/storage';
import { getSelectedOrgInn } from '@/server/orgContext';
import { getShowAllDataFlag } from '@/server/userStore';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

function getUserIdMeta(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

type Row = { taskId: string | number; orderId?: string | number; createdAt: string; updatedAt?: string; status?: string | null; inn: string; userId?: string; hasPrepay?: boolean; hasFull?: boolean; hasCommission?: boolean; hasNpd?: boolean };

async function readOrgIndex(inn: string): Promise<Row[]> {
  try {
    const raw = await readText(`.data/sales/${inn.replace(/\D/g, '')}/index.json`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdMeta(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const url = new URL(req.url);
    // Fallback: allow POST via GET (when ?via=get and x-fallback-payload provided)
    if (url.searchParams.get('via') === 'get') {
      const bodyStr = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
      if (!bodyStr) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      const headers = new Headers(req.headers);
      headers.set('content-type', 'application/json');
      try { headers.delete('content-length'); } catch {}
      const req2 = new Request(url.toString(), { method: 'POST', headers, body: bodyStr });
      const res = await POST(req2);
      try { res.headers.set('Cache-Control', 'no-store'); } catch {}
      return res;
    }
    // Фильтры как и в /api/sales
    const filter = {
      query: (url.searchParams.get('q') || '').trim(),
      status: (url.searchParams.get('status') || '').trim(),
      agent: url.searchParams.get('agent'),
      prepay: url.searchParams.get('prepay'),
      full: url.searchParams.get('full'),
      commission: url.searchParams.get('commission'),
      npd: url.searchParams.get('npd'),
      showHidden: url.searchParams.get('showHidden') || 'no',
      saleFrom: url.searchParams.get('saleFrom'),
      saleTo: url.searchParams.get('saleTo'),
      endFrom: url.searchParams.get('endFrom'),
      endTo: url.searchParams.get('endTo'),
      amountMin: url.searchParams.get('amountMin'),
      amountMax: url.searchParams.get('amountMax'),
    } as const;
    const hasAnyFilter = [filter.query, filter.status, filter.agent, filter.prepay, filter.full, filter.commission, filter.npd, filter.saleFrom, filter.saleTo, filter.endFrom, filter.endTo, filter.amountMin, filter.amountMax].some((v) => v && String(v).trim().length > 0) || filter.showHidden === 'yes';
    const onlySuccess = url.searchParams.get('success') === '1';
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');
    const limit = (() => { const n = Number(limitRaw); return Number.isFinite(n) && n > 0 ? Math.min(200, Math.max(1, Math.floor(n))) : 0; })();
    const offset = (() => { const n = Number(offsetRaw); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; })();

    const inn = getSelectedOrgInn(req);
    const showAll = await getShowAllDataFlag(userId);
    let rows: Row[] = [];
    if (inn) rows = await readOrgIndex(inn);
    if (!rows || rows.length === 0) rows = await readUserIndex(userId) as unknown as Row[];
    rows = Array.isArray(rows) ? rows.slice() : [];
    // Если режим "все данные" не включён — при наличии orgIndex отфильтруем по userId только когда можем (если поле есть). В остальном — проверим при чтении файла
    if (inn && !showAll && rows.length > 0 && (rows[0] as any)?.userId) rows = rows.filter((r: any) => String(r?.userId || '') === String(userId));

    const saleMatches = (s: any): boolean => {
      if (filter.showHidden !== 'all') {
        const isHidden = Boolean(s.hidden);
        if (filter.showHidden === 'no' && isHidden) return false;
        if (filter.showHidden === 'yes' && !isHidden) return false;
      }
      if (filter.query) {
        const q = filter.query;
        if (!(String(s.taskId).includes(q) || String(s.orderId).includes(q))) return false;
      }
      if (filter.status) {
        const st = String(s.status || '').toLowerCase();
        if (st !== String(filter.status).toLowerCase()) return false;
      }
      if (filter.agent === 'yes' && !s.isAgent) return false;
      if (filter.agent === 'no' && s.isAgent) return false;
      const hasPrepay = Boolean(s.ofdUrl);
      const hasFull = Boolean(s.ofdFullUrl);
      const hasComm = Boolean(s.additionalCommissionOfdUrl);
      const hasNpd = Boolean(s.npdReceiptUri);
      if (filter.prepay === 'yes' && !hasPrepay) return false; if (filter.prepay === 'no' && hasPrepay) return false;
      if (filter.full === 'yes' && !hasFull) return false; if (filter.full === 'no' && hasFull) return false;
      if (filter.commission === 'yes' && !hasComm) return false; if (filter.commission === 'no' && hasComm) return false;
      if (filter.npd === 'yes' && !hasNpd) return false; if (filter.npd === 'no' && hasNpd) return false;
      if (filter.saleFrom || filter.saleTo) {
        const base = s.createdAtRw || s.createdAt;
        const ts = base ? Date.parse(base) : NaN;
        if (filter.saleFrom && !(Number.isFinite(ts) && ts >= Date.parse(String(filter.saleFrom)))) return false;
        if (filter.saleTo && !(Number.isFinite(ts) && ts <= (Date.parse(String(filter.saleTo)) + 24*60*60*1000 - 1))) return false;
      }
      if (filter.endFrom || filter.endTo) {
        const e = s.serviceEndDate ? Date.parse(String(s.serviceEndDate)) : NaN;
        if (filter.endFrom && !(Number.isFinite(e) && e >= Date.parse(String(filter.endFrom)))) return false;
        if (filter.endTo && !(Number.isFinite(e) && e <= (Date.parse(String(filter.endTo)) + 24*60*60*1000 - 1))) return false;
      }
      const min = filter.amountMin ? Number(String(filter.amountMin).replace(',', '.')) : null;
      const max = filter.amountMax ? Number(String(filter.amountMax).replace(',', '.')) : null;
      if (min != null && !(Number(s.amountGrossRub || 0) >= min)) return false;
      if (max != null && !(Number(s.amountGrossRub || 0) <= max)) return false;
      return true;
    };
    if (onlySuccess) rows = rows.filter((r) => { const st = String((r as any)?.status || '').toLowerCase(); return st === 'paid' || st === 'transfered' || st === 'transferred'; });

    // Fast index-only path: if filters are covered by index fields, return total without reading sale files
    const rowMatches = (r: Row): boolean => {
      if (filter.status) {
        const st = String(r.status || '').toLowerCase();
        if (st !== String(filter.status).toLowerCase()) return false;
      }
      if (filter.query) {
        const q = filter.query;
        const hit = String(r.taskId).includes(q) || (typeof r.orderId !== 'undefined' && String(r.orderId).includes(q));
        if (!hit) return false;
      }
      if (filter.saleFrom || filter.saleTo) {
        const ts = r.createdAt ? Date.parse(String(r.createdAt)) : NaN;
        if (filter.saleFrom && !(Number.isFinite(ts) && ts >= Date.parse(String(filter.saleFrom)))) return false;
        if (filter.saleTo && !(Number.isFinite(ts) && ts <= (Date.parse(String(filter.saleTo)) + 24*60*60*1000 - 1))) return false;
      }
      if (filter.prepay === 'yes' && !r.hasPrepay) return false; if (filter.prepay === 'no' && r.hasPrepay) return false;
      if (filter.full === 'yes' && !r.hasFull) return false; if (filter.full === 'no' && r.hasFull) return false;
      if (filter.commission === 'yes' && !r.hasCommission) return false; if (filter.commission === 'no' && r.hasCommission) return false;
      if (filter.npd === 'yes' && !r.hasNpd) return false; if (filter.npd === 'no' && r.hasNpd) return false;
      return true;
    };

    const coveredByIndexOnly = (
      (!filter.agent || filter.agent === 'all') &&
      (filter.showHidden === 'all' || !filter.showHidden) &&
      !filter.endFrom && !filter.endTo &&
      !filter.amountMin && !filter.amountMax
    );
    if (hasAnyFilter && coveredByIndexOnly) {
      // Use index-only computation for total
      const total = rows.filter(rowMatches).length;
      return NextResponse.json({ total });
    }
    rows.sort((a: any, b: any) => {
      const at = Date.parse((a?.createdAt || 0) as any);
      const bt = Date.parse((b?.createdAt || 0) as any);
      if (bt !== at) return bt - at;
      return String(b.taskId || '').localeCompare(String(a.taskId || ''));
    });
    // Если есть фильтры — считаем total по фильтрам, читая минимально необходимые файлы
    if (hasAnyFilter) {
      // Prefilter rows by index flags for heavy filters before reading files
      if (filter.prepay === 'yes') rows = rows.filter((r: any) => (r as any)?.hasPrepay === true);
      if (filter.prepay === 'no') rows = rows.filter((r: any) => (r as any)?.hasPrepay !== true);
      if (filter.full === 'yes') rows = rows.filter((r: any) => (r as any)?.hasFull === true);
      if (filter.full === 'no') rows = rows.filter((r: any) => (r as any)?.hasFull !== true);
      if (filter.commission === 'yes') rows = rows.filter((r: any) => (r as any)?.hasCommission === true);
      if (filter.commission === 'no') rows = rows.filter((r: any) => (r as any)?.hasCommission !== true);
      if (filter.npd === 'yes') rows = rows.filter((r: any) => (r as any)?.hasNpd === true);
      if (filter.npd === 'no') rows = rows.filter((r: any) => (r as any)?.hasNpd !== true);
      // Быстрый предфильтр по индексным флагам чеков
      if (filter.prepay === 'yes') rows = rows.filter((r: any) => (r as any)?.hasPrepay === true);
      if (filter.prepay === 'no') rows = rows.filter((r: any) => (r as any)?.hasPrepay !== true);
      if (filter.full === 'yes') rows = rows.filter((r: any) => (r as any)?.hasFull === true);
      if (filter.full === 'no') rows = rows.filter((r: any) => (r as any)?.hasFull !== true);
      if (filter.commission === 'yes') rows = rows.filter((r: any) => (r as any)?.hasCommission === true);
      if (filter.commission === 'no') rows = rows.filter((r: any) => (r as any)?.hasCommission !== true);
      if (filter.npd === 'yes') rows = rows.filter((r: any) => (r as any)?.hasNpd === true);
      if (filter.npd === 'no') rows = rows.filter((r: any) => (r as any)?.hasNpd !== true);
      let total = 0;
      const chunk = 48;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, Math.min(rows.length, i + chunk));
        const results = await Promise.allSettled(slice.map(async (r) => {
          try {
            const d = String((r as any).inn || inn || '').replace(/\D/g,'');
            const p = d ? `.data/sales/${d}/sales/${String(r.taskId)}.json` : '';
            const raw = await readText(p);
            if (!raw) return 0;
            const s = JSON.parse(raw);
            if (!showAll && s.userId !== userId) return 0;
            return saleMatches(s) ? 1 : 0;
          } catch { return 0; }
        }));
        for (const r of results) if (r.status === 'fulfilled') total += (r.value as number);
      }
      return NextResponse.json({ total });
    }

    const total = rows.length;
    const prev = (offset > 0 && offset - 1 < rows.length) ? rows[offset - 1] : null;
    const prevCursor = prev ? `${prev.createdAt}|${prev.taskId}` : null;
    const pageItems = limit > 0 ? rows.slice(offset, offset + limit) : rows;
    const minimal = pageItems.map((r) => ({ taskId: r.taskId, createdAt: r.createdAt, status: (r as any)?.status ?? null, inn: r.inn }));
    return NextResponse.json({ total, prevCursor, items: minimal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse as NextResponseMetaPost } from 'next/server';
import { updateSaleMeta } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';

// Note: one route file, single runtime export supported. Reuse the same runtime for both methods.

function getUserIdPost(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    const userId = getUserIdPost(req);
    if (!userId) return NextResponseMetaPost.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => ({} as any));
    const taskId = body?.taskId;
    if (typeof taskId === 'undefined') return NextResponseMetaPost.json({ error: 'NO_TASK' }, { status: 400 });
    const payerTgId = typeof body?.payerTgId === 'string' && body.payerTgId.trim().length > 0 ? String(body.payerTgId).trim() : null;
    const linkCode = typeof body?.linkCode === 'string' && body.linkCode.trim().length > 0 ? String(body.linkCode).trim() : null;
    const payerTgFirstName = typeof body?.payerTgFirstName === 'string' && body.payerTgFirstName.trim().length > 0 ? String(body.payerTgFirstName).trim() : undefined as any;
    const payerTgLastName = typeof body?.payerTgLastName === 'string' && body.payerTgLastName.trim().length > 0 ? String(body.payerTgLastName).trim() : undefined as any;
    const payerTgUsername = typeof body?.payerTgUsername === 'string' && body.payerTgUsername.trim().length > 0 ? String(body.payerTgUsername).trim() : undefined as any;
    await updateSaleMeta(userId, taskId, { payerTgId, linkCode, payerTgFirstName, payerTgLastName, payerTgUsername });
    try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'meta/update', data: { payerTgId, linkCode, ua: req.headers.get('user-agent') || null } }); } catch {}
    return NextResponseMetaPost.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponseMetaPost.json({ error: message }, { status: 500 });
  }
}


