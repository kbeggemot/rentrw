"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Sale = {
  taskId: string | number;
  orderId: number;
  amountGrossRub: number;
  isAgent: boolean;
  retainedCommissionRub: number;
  status?: string | null;
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  additionalCommissionOfdUrl?: string | null;
  npdReceiptUri?: string | null;
  serviceEndDate?: string | null;
  createdAtRw?: string | null;
  hidden?: boolean;
  createdAt: string;
};

export default function SalesClient({ initial, hasTokenInitial }: { initial: Sale[]; hasTokenInitial?: boolean }) {
  const [sales, setSales] = useState<Sale[]>(initial);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(typeof hasTokenInitial === 'boolean' ? hasTokenInitial : null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [sseOn, setSseOn] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const actionProbeRef = useRef<HTMLButtonElement | null>(null);
  const [indexRows, setIndexRows] = useState<Array<{ taskId: string | number; createdAt: string }>>([]);

  function IconChevronRight() {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 4l4 4-4 4" />
      </svg>
    );
  }

  function IconEdit() {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 13l3 0 7-7-3-3-7 7 0 3z" />
        <path d="M10 3l3 3" />
      </svg>
    );
  }

  function IconDotsVertical() {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle cx="8" cy="3" r="1.5" fill="currentColor" />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        <circle cx="8" cy="13" r="1.5" fill="currentColor" />
      </svg>
    );
  }

  function IconDotsHorizontal() {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle cx="3" cy="8" r="1.5" fill="currentColor" />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        <circle cx="13" cy="8" r="1.5" fill="currentColor" />
      </svg>
    );
  }

  function IconArrowDown() {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 3v8" />
        <path d="M4.5 8.5L8 12l3.5-3.5" />
      </svg>
    );
  }

  // Filters
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'paying' | 'paid' | 'transfered'>('all');
  const [agent, setAgent] = useState<'all' | 'yes' | 'no'>('all');
  const [purchaseReceipt, setPurchaseReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [fullReceipt, setFullReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [commissionReceipt, setCommissionReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [npdReceipt, setNpdReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [showHidden, setShowHidden] = useState<'all' | 'yes' | 'no'>(process.env.NODE_ENV !== 'production' ? 'all' : 'no');
  // Дата продажи (RW created_at если есть)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Дата окончания услуги
  const [endFrom, setEndFrom] = useState('');
  const [endTo, setEndTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  // Управление видимостью фильтров (выпадающий «Добавить фильтр»)
  const [visibleFilters, setVisibleFilters] = useState<string[]>([]);
  const allFilterDefs: Array<{ key: string; label: string }> = [
    { key: 'status', label: 'Статус' },
    { key: 'agent', label: 'Тип продажи' },
    { key: 'prepay', label: 'Чек предоплаты' },
    { key: 'full', label: 'Чек полного расчёта' },
    { key: 'commission', label: 'Чек комиссии' },
    { key: 'npd', label: 'Чек НПД' },
    { key: 'saleFrom', label: 'Дата продажи c' },
    { key: 'saleTo', label: 'Дата продажи по' },
    { key: 'endFrom', label: 'Окончание услуги c' },
    { key: 'endTo', label: 'Окончание услуги по' },
    { key: 'amountMin', label: 'Сумма от' },
    { key: 'amountMax', label: 'Сумма до' },
    { key: 'showHidden', label: 'Видимость' },
  ];
  const addFilter = (key: string) => {
    setVisibleFilters((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const removeFilter = (key: string) => {
    setVisibleFilters((prev) => prev.filter((k) => k !== key));
  };

  const load = async (refresh = false, onlyOrders?: number[]) => {
    setLoading(true);
    try {
      const buildFilterQuery = () => {
        const sp = new URLSearchParams();
        sp.set('limit', '50');
        if (query && query.trim().length > 0) sp.set('q', query.trim());
        if (status && status !== 'all') sp.set('status', status);
        if (agent && agent !== 'all') sp.set('agent', agent);
        if (purchaseReceipt && purchaseReceipt !== 'all') sp.set('prepay', purchaseReceipt);
        if (fullReceipt && fullReceipt !== 'all') sp.set('full', fullReceipt);
        if (commissionReceipt && commissionReceipt !== 'all') sp.set('commission', commissionReceipt);
        if (npdReceipt && npdReceipt !== 'all') sp.set('npd', npdReceipt);
        if (showHidden && showHidden !== 'no') sp.set('showHidden', showHidden);
        if (dateFrom) sp.set('saleFrom', dateFrom);
        if (dateTo) sp.set('saleTo', dateTo);
        if (endFrom) sp.set('endFrom', endFrom);
        if (endTo) sp.set('endTo', endTo);
        if (amountMin) sp.set('amountMin', amountMin);
        if (amountMax) sp.set('amountMax', amountMax);
        return sp;
      };
      const syncMissing = async (arr: Sale[]) => {
        try {
          const ordersSet = new Set((onlyOrders || []).map((n) => Number(n)));
          const pool = onlyOrders && onlyOrders.length > 0 ? arr.filter((s) => ordersSet.has(Number(s.orderId))) : arr;
          const need = pool.filter((s) => (!s.ofdUrl) || (!s.ofdFullUrl));
          // Ограничим параллелизм до 5, чтобы не создавать сотни запросов одновременно
          const step = 5;
          for (let i = 0; i < need.length; i += step) {
            const chunk = need.slice(i, i + step);
            await Promise.allSettled(chunk.map((s) => fetch(`/api/ofd/sync?order=${encodeURIComponent(String(s.orderId))}`, { cache: 'no-store', credentials: 'include' })));
          }
          // мягкое обновление после попыток
          const r2 = await fetch('/api/sales?limit=50', { cache: 'no-store', credentials: 'include' });
          const d2 = await r2.json();
          const list2 = Array.isArray(d2?.sales) ? d2.sales : [];
          setSales((prev) => (JSON.stringify(prev) === JSON.stringify(list2) ? prev : list2));
        } catch {}
      };
      if (refresh || hasActiveFilter) {
        // Серверная фильтрация + пагинация
        try {
          const sp = buildFilterQuery();
          const r = await fetch(`/api/sales?${sp.toString()}`, { cache: 'no-store', credentials: 'include' });
          const d = await r.json();
          const list = Array.isArray(d?.sales) ? d.sales : [];
          setSales(list);
          const nc = typeof d?.nextCursor === 'string' && d.nextCursor.length > 0 ? String(d.nextCursor) : null;
          setNextCursor(nc);
        } finally {
          setLoading(false);
        }
        return;
      } else if (refresh) {
        const qs = onlyOrders && onlyOrders.length > 0 ? `&orders=${encodeURIComponent(onlyOrders.join(','))}` : '';
        void fetch(`/api/sales?refresh=1${qs}`, { cache: 'no-store', credentials: 'include' })
          .then(() => fetch('/api/sales?limit=50', { cache: 'no-store', credentials: 'include' }))
          .then((r) => r.json())
          .then((d) => {
            const list = Array.isArray(d?.sales) ? d.sales : [];
            setSales((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
            void syncMissing(list);
          })
          .catch(() => void 0)
          .finally(() => setLoading(false));
        const resOld = await fetch('/api/sales?limit=50', { cache: 'no-store', credentials: 'include' });
        const oldData = await resOld.json();
        const listOld = Array.isArray(oldData?.sales) ? oldData.sales : [];
        setSales((prev) => (JSON.stringify(prev) === JSON.stringify(listOld) ? prev : listOld));
        // fire-and-forget sync for the interim list as well
        void syncMissing(listOld);
      } else {
        // 1) спросим метаданные по индексу (берём все, без лимита)
        const meta = await fetch('/api/sales/meta', { cache: 'no-store', credentials: 'include' }).then((r) => r.json()).catch(() => ({} as any));
        const items: Array<{ taskId: string | number; createdAt: string }>
          = Array.isArray(meta?.items) ? meta.items : [];
        if (items.length > 0) setIndexRows(items);
        if (typeof meta?.total === 'number') setTotal(meta.total); else if (items.length > 0) setTotal(items.length);
        // 2) загрузим текущую страницу продаж целиком по курсору
        const res = await fetch('/api/sales?limit=50', { cache: 'no-store', credentials: 'include' });
        const data = await res.json();
        const list = Array.isArray(data?.sales) ? data.sales : [];
        setNextCursor(typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? String(data.nextCursor) : null);
        setSales((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      }
    } catch {
      // keep previous data to avoid flicker
    } finally {
      if (!refresh) setLoading(false);
    }
  };


  const loadMore = async () => {
    if (!nextCursor) return;
    setLoading(true);
    try {
      // Сначала возьмём минимальные ключи следующей страницы — пригодится для total и прелоада
      try {
        const meta = await fetch(`/api/sales/meta?limit=50&offset=${sales.length}`, { cache: 'no-store', credentials: 'include' }).then((r)=>r.json());
        if (typeof meta?.total === 'number') setTotal(meta.total);
      } catch {}
      if (hasActiveFilter) {
        const sp = new URLSearchParams();
        sp.set('limit', '50');
        sp.set('cursor', nextCursor);
        if (query && query.trim().length > 0) sp.set('q', query.trim());
        if (status && status !== 'all') sp.set('status', status);
        if (agent && agent !== 'all') sp.set('agent', agent);
        if (purchaseReceipt && purchaseReceipt !== 'all') sp.set('prepay', purchaseReceipt);
        if (fullReceipt && fullReceipt !== 'all') sp.set('full', fullReceipt);
        if (commissionReceipt && commissionReceipt !== 'all') sp.set('commission', commissionReceipt);
        if (npdReceipt && npdReceipt !== 'all') sp.set('npd', npdReceipt);
        if (showHidden && showHidden !== 'no') sp.set('showHidden', showHidden);
        if (dateFrom) sp.set('saleFrom', dateFrom);
        if (dateTo) sp.set('saleTo', dateTo);
        if (endFrom) sp.set('endFrom', endFrom);
        if (endTo) sp.set('endTo', endTo);
        if (amountMin) sp.set('amountMin', amountMin);
        if (amountMax) sp.set('amountMax', amountMax);
        const res = await fetch(`/api/sales?${sp.toString()}`, { cache: 'no-store', credentials: 'include' });
        const data = await res.json();
        const list: Sale[] = Array.isArray(data?.sales) ? data.sales : [];
        const nc = typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? String(data.nextCursor) : null;
        setNextCursor(nc);
        setSales((prev) => {
          const map = new Map<string, Sale>();
          for (const s of prev) map.set(String(s.taskId), s);
          for (const s of list) map.set(String((s as any).taskId), s as Sale);
          return Array.from(map.values());
        });
      } else {
        const res = await fetch(`/api/sales?limit=50&cursor=${encodeURIComponent(nextCursor)}`, { cache: 'no-store', credentials: 'include' });
        const data = await res.json();
        const list: Sale[] = Array.isArray(data?.sales) ? data.sales : [];
        const nc = typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? String(data.nextCursor) : null;
        setNextCursor(nc);
        setSales((prev) => {
          const map = new Map<string, Sale>();
          for (const s of prev) map.set(String(s.taskId), s);
          for (const s of list) map.set(String((s as any).taskId), s as Sale);
          return Array.from(map.values());
        });
      }
    } catch {
    } finally { setLoading(false); }
  };

  // Локальный фильтр для произвольного массива, идентичен useMemo-фильтру ниже
  const applyFiltersLocal = useCallback((arr: Sale[]): Sale[] => {
    const q = query.trim();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const endFromTs = endFrom ? new Date(endFrom).getTime() : null;
    const endToTs = endTo ? new Date(endTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const min = amountMin ? Number(amountMin.replace(',', '.')) : null;
    const max = amountMax ? Number(amountMax.replace(',', '.')) : null;
    return arr.filter((s) => {
      if (q && !String(s.orderId).includes(q) && !String(s.taskId).includes(q)) return false;
      if (showHidden !== 'all') {
        const isHidden = Boolean(s.hidden);
        if (showHidden === 'no' && isHidden) return false;
        if (showHidden === 'yes' && !isHidden) return false;
      }
      if (status !== 'all') {
        const st = String(s.status || '').toLowerCase();
        if (st !== status) return false;
      }
      if (agent !== 'all') {
        if (agent === 'yes' && !s.isAgent) return false;
        if (agent === 'no' && s.isAgent) return false;
      }
      if (purchaseReceipt !== 'all') {
        const has = Boolean(s.ofdUrl);
        if (purchaseReceipt === 'yes' && !has) return false;
        if (purchaseReceipt === 'no' && has) return false;
      }
      if (fullReceipt !== 'all') {
        const has = Boolean(s.ofdFullUrl);
        if (fullReceipt === 'yes' && !has) return false;
        if (fullReceipt === 'no' && has) return false;
      }
      if (commissionReceipt !== 'all') {
        const has = Boolean(s.additionalCommissionOfdUrl);
        if (commissionReceipt === 'yes' && !has) return false;
        if (commissionReceipt === 'no' && has) return false;
      }
      if (npdReceipt !== 'all') {
        const has = Boolean(s.npdReceiptUri);
        if (npdReceipt === 'yes' && !has) return false;
        if (npdReceipt === 'no' && has) return false;
      }
      if (fromTs != null || toTs != null) {
        const baseDate = (s as any).createdAtRw || (s as any).createdAt;
        const ts = baseDate ? new Date(baseDate).getTime() : NaN;
        if (fromTs != null && !(Number.isFinite(ts) && ts >= fromTs)) return false;
        if (toTs != null && !(Number.isFinite(ts) && ts <= toTs)) return false;
      }
      if (endFromTs != null || endToTs != null) {
        const eTs = s.serviceEndDate ? new Date(s.serviceEndDate).getTime() : NaN;
        if (endFromTs != null && !(Number.isFinite(eTs) && eTs >= endFromTs)) return false;
        if (endToTs != null && !(Number.isFinite(eTs) && eTs <= endToTs)) return false;
      }
      if (min != null && !(s.amountGrossRub >= min)) return false;
      if (max != null && !(s.amountGrossRub <= max)) return false;
      return true;
    });
  }, [query, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax, showHidden, status, agent, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt]);

  async function fetchMorePage(cursorStr: string): Promise<{ list: Sale[]; next: string | null }> {
    const res = await fetch(`/api/sales?limit=50&cursor=${encodeURIComponent(cursorStr)}`, { cache: 'no-store', credentials: 'include' });
    const data = await res.json();
    const list: Sale[] = Array.isArray(data?.sales) ? data.sales : [];
    const next = typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? String(data.nextCursor) : null;
    return { list, next };
  }

  const goNextPage = async () => {
    const targetPage = page + 1;
    if (indexRows.length > 0) {
      // Наращиваем непрерывный префикс из индекса, пока видимых записей не хватит на targetPage
      setLoading(true);
      try {
        const byId = new Map<string, Sale>();
        for (const s of sales) byId.set(String((s as any).taskId), s as Sale);
        // длина непрерывного префикса, который уже загружен
        let prefix = 0;
        while (prefix < indexRows.length && byId.has(String(indexRows[prefix].taskId))) prefix += 1;
        const needVisible = targetPage * pageSize;
        const visibleCount = () => applyFiltersLocal(Array.from(byId.values())).length;
        let currentVisible = visibleCount();
        let cursor = prefix;
        const batchSize = 30;
        while (currentVisible < needVisible && cursor < indexRows.length) {
          const sliceIds = indexRows.slice(cursor, cursor + batchSize).map((r) => String(r.taskId));
          cursor += batchSize;
          // отфильтруем те, которых ещё нет
          const missing = sliceIds.filter((id) => !byId.has(id));
          if (missing.length > 0) {
            const qs = missing.map((id) => encodeURIComponent(id)).join(',');
            const r = await fetch(`/api/sales?taskIds=${qs}`, { cache: 'no-store', credentials: 'include' });
            const d = await r.json();
            const list: Sale[] = Array.isArray(d?.sales) ? d.sales : [];
            for (const s of list) byId.set(String((s as any).taskId), s as Sale);
            // пересчитаем префикс
            while (prefix < indexRows.length && byId.has(String(indexRows[prefix].taskId))) prefix += 1;
            currentVisible = visibleCount();
          } else {
            // даже если все ids уже есть, увеличим префикс
            while (prefix < indexRows.length && byId.has(String(indexRows[prefix].taskId))) prefix += 1;
            currentVisible = visibleCount();
          }
        }
        // сформируем sales как непрерывный префикс для корректной пагинации
        const orderedPrefix: Sale[] = indexRows.slice(0, prefix).map((r) => byId.get(String(r.taskId))).filter(Boolean) as Sale[];
        if (orderedPrefix.length > 0) setSales(orderedPrefix);
      } finally { setLoading(false); }
      setPage(targetPage);
      return;
    }
    // Fallback: догрузка по cursor
    let map = new Map<string, Sale>();
    for (const s of sales) map.set(String(s.taskId), s);
    let localNext = nextCursor;
    let visibleCount = applyFiltersLocal(Array.from(map.values())).length;
    setLoading(true);
    try {
      while (visibleCount < targetPage * pageSize && localNext) {
        const { list, next } = await fetchMorePage(localNext);
        for (const s of list) map.set(String((s as any).taskId), s as Sale);
        visibleCount = applyFiltersLocal(Array.from(map.values())).length;
        localNext = next;
      }
      const combined = Array.from(map.values());
      setSales((prev) => (JSON.stringify(prev) === JSON.stringify(combined) ? prev : combined));
      setNextCursor(localNext);
      if (visibleCount >= targetPage * pageSize) setPage(targetPage);
    } finally { setLoading(false); }
  };
  // Подписка на серверные события (прод) и мягкое обновление
  useEffect(() => {
    if (sseOn) return;
    const isProd = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
    if (!isProd) return; // на локали не мешаем
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data || '{}');
          if (msg && (msg.topic === 'sales:update')) {
            // мягко перезапрашиваем без очистки
            void load(false);
          }
        } catch {}
      };
      setSseOn(true);
    } catch {}
    return () => {
      try { es?.close(); } catch {}
    };
  }, [sseOn]);

  // Автообновление на первом рендере отключено, чтобы убрать «мигание».
  // Обновление выполняется вручную кнопкой «Обновить» и по SSE-событиям.
  // useEffect(() => { /* intentionally disabled */ }, []);

  // Подтянем индекс и доберём до полной видимой страницы (15 строк) с учётом фильтров
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const meta = await fetch('/api/sales/meta', { cache: 'no-store', credentials: 'include' }).then((r)=>r.json());
        if (aborted) return;
        if (Array.isArray(meta?.items)) {
          const rows = (meta.items as Array<{ taskId: string | number; createdAt: string }>);
          setIndexRows(rows);
          // Грузим стартовый префикс до 15 видимых строк
          const byId = new Map<string, Sale>();
          let prefix = 0;
          let cursor = 0;
          const batchSize = 30;
          const visibleCount = () => applyFiltersLocal(Array.from(byId.values())).length;
          while (!aborted && visibleCount() < pageSize && cursor < rows.length) {
            const slice = rows.slice(cursor, cursor + batchSize);
            cursor += batchSize;
            const qs = slice.map((x) => encodeURIComponent(String(x.taskId))).join(',');
            if (!qs) break;
            try {
              const r = await fetch(`/api/sales?taskIds=${qs}`, { cache: 'no-store', credentials: 'include' });
              const d = await r.json();
              const list: Sale[] = Array.isArray(d?.sales) ? d.sales : [];
              for (const s of list) byId.set(String((s as any).taskId), s as Sale);
              while (prefix < rows.length && byId.has(String(rows[prefix].taskId))) prefix += 1;
            } catch {}
          }
          const ordered: Sale[] = rows.slice(0, prefix).map((r) => byId.get(String(r.taskId))).filter(Boolean) as Sale[];
          if (!aborted && ordered.length > 0) setSales(ordered);
        }
        if (typeof meta?.total === 'number') setTotal(meta.total);
      } catch {}
    })();
    return () => { aborted = true; };
  }, []);

  // Гарантируем наличие nextCursor для постраничной догрузки (если индекс уже есть — пропускаем)
  useEffect(() => {
    let aborted = false;
    (async () => {
      if (nextCursor || indexRows.length > 0 || hasActiveFilter) return;
      try {
        const r = await fetch('/api/sales?limit=50', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        const nc = typeof d?.nextCursor === 'string' && d.nextCursor.length > 0 ? String(d.nextCursor) : null;
        if (!aborted && nc) setNextCursor(nc);
        const list = Array.isArray(d?.sales) ? d.sales : [];
        if (!aborted && sales.length === 0 && list.length > 0) setSales(list);
      } catch {}
    })();
    return () => { aborted = true; };
  // deliberately run only once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (moved below after `filtered` declaration)

  const filtered = useMemo(() => {
    const q = query.trim();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const endFromTs = endFrom ? new Date(endFrom).getTime() : null;
    const endToTs = endTo ? new Date(endTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const min = amountMin ? Number(amountMin.replace(',', '.')) : null;
    const max = amountMax ? Number(amountMax.replace(',', '.')) : null;
    return sales.filter((s) => {
      if (q && !String(s.orderId).includes(q) && !String(s.taskId).includes(q)) return false;
      if (showHidden !== 'all') {
        const isHidden = Boolean(s.hidden);
        if (showHidden === 'no' && isHidden) return false;
        if (showHidden === 'yes' && !isHidden) return false;
      }
      if (status !== 'all') {
        const st = String(s.status || '').toLowerCase();
        if (st !== status) return false;
      }
      if (agent !== 'all') {
        if (agent === 'yes' && !s.isAgent) return false;
        if (agent === 'no' && s.isAgent) return false;
      }
      if (purchaseReceipt !== 'all') {
        const has = Boolean(s.ofdUrl);
        if (purchaseReceipt === 'yes' && !has) return false;
        if (purchaseReceipt === 'no' && has) return false;
      }
      if (fullReceipt !== 'all') {
        const has = Boolean(s.ofdFullUrl);
        if (fullReceipt === 'yes' && !has) return false;
        if (fullReceipt === 'no' && has) return false;
      }
      if (commissionReceipt !== 'all') {
        const has = Boolean(s.additionalCommissionOfdUrl);
        if (commissionReceipt === 'yes' && !has) return false;
        if (commissionReceipt === 'no' && has) return false;
      }
      if (npdReceipt !== 'all') {
        const has = Boolean(s.npdReceiptUri);
        if (npdReceipt === 'yes' && !has) return false;
        if (npdReceipt === 'no' && has) return false;
      }
      if (fromTs != null || toTs != null) {
        const baseDate = s.createdAtRw || s.createdAt;
        const ts = baseDate ? new Date(baseDate).getTime() : NaN;
        if (fromTs != null && !(Number.isFinite(ts) && ts >= fromTs)) return false;
        if (toTs != null && !(Number.isFinite(ts) && ts <= toTs)) return false;
      }
      if (endFromTs != null || endToTs != null) {
        const eTs = s.serviceEndDate ? new Date(s.serviceEndDate).getTime() : NaN;
        if (endFromTs != null && !(Number.isFinite(eTs) && eTs >= endFromTs)) return false;
        if (endToTs != null && !(Number.isFinite(eTs) && eTs <= endToTs)) return false;
      }
      if (min != null && !(s.amountGrossRub >= min)) return false;
      if (max != null && !(s.amountGrossRub <= max)) return false;
      return true;
    });
  }, [sales, query, status, agent, showHidden, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const filteredTotal = useMemo(() => filtered.length, [filtered]);
  const hasActiveFilter = useMemo(() => {
    return (
      (query && query.trim().length > 0) ||
      status !== 'all' || agent !== 'all' ||
      purchaseReceipt !== 'all' || fullReceipt !== 'all' || commissionReceipt !== 'all' || npdReceipt !== 'all' ||
      showHidden !== 'no' ||
      !!dateFrom || !!dateTo || !!endFrom || !!endTo || !!amountMin || !!amountMax
    );
  }, [query, status, agent, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt, showHidden, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax]);
  const totalFromIndex = useMemo(() => (indexRows.length > 0 ? indexRows.length : (typeof total === 'number' ? total : 0)), [indexRows.length, total]);
  const displayTotal = hasActiveFilter ? filteredTotal : (totalFromIndex || filteredTotal);

  useEffect(() => { setPage(1); }, [query, status, agent, showHidden, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax]);

  // export button is now in the toolbar; no floating positioning required

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-');
  const [checksOpenId, setChecksOpenId] = useState<string | number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [pageCodes, setPageCodes] = useState<Record<number, string>>({});
  const openSale = useMemo(() => filtered.find((x) => x.taskId === menuOpenId) || null, [filtered, menuOpenId]);
  // Предзагрузка pageCode для всех видимых финальных продаж, чтобы ссылка не мигала в меню
  useEffect(() => {
    const finals = filtered.filter((s) => {
      const fin = String(s.status || '').toLowerCase();
      return fin === 'paid' || fin === 'transfered' || fin === 'transferred';
    });
    finals.forEach((s) => { void ensurePageCode(s.orderId); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);
  // Глобальное закрытие контекстного меню по клику вне
  useEffect(() => {
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-menu-root]')) return;
      setMenuOpenId(null);
      setMenuPos(null);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('touchstart', close, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('touchstart', close, true);
    };
  }, []);
  // Синхронизируем флаг с SSR, а клиентскую проверку делаем только если флаг не пришёл
  useEffect(() => { if (typeof hasTokenInitial === 'boolean') setHasToken(hasTokenInitial); }, [hasTokenInitial]);
  useEffect(() => {
    if (typeof hasTokenInitial === 'boolean') return;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/settings/token', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        if (!aborted) setHasToken(Boolean(d?.token));
      } catch {
        if (!aborted) setHasToken(false);
      }
    })();
    return () => { aborted = true; };
  }, [hasTokenInitial]);

  if (hasToken === false) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Для начала работы укажите токен своей организации, полученный в Рокет Ворк.
          </p>
          <a href="/settings" className="inline-block">
            <Button>Перейти в настройки</Button>
          </a>
        </div>
      </div>
    );
  }


  const exportXlsx = async () => {
    try {
      const header = ['№', 'Тип', 'Сумма, ₽', 'Комиссия, ₽', 'Статус оплаты', 'Общий статус', 'Чек предоплаты', 'Чек полного расчёта', 'Чек комиссии', 'Чек НПД', 'Дата продажи', 'Дата окончания оказания услуги'];
      const rows = filtered.map((s) => [
        String(s.taskId ?? ''),
        s.isAgent ? 'Агентская' : 'Прямая',
        typeof s.amountGrossRub === 'number' ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.amountGrossRub) : '',
        s.isAgent && typeof s.retainedCommissionRub === 'number' ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.retainedCommissionRub) : '',
        s.status ?? '',
        (s as any).rootStatus ?? '',
        s.ofdUrl ?? '',
        s.ofdFullUrl ?? '',
        s.additionalCommissionOfdUrl ?? '',
        s.npdReceiptUri ?? '',
        (s.createdAtRw ? new Date(s.createdAtRw) : (s.createdAt ? new Date(s.createdAt) : null))?.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) || '',
        s.serviceEndDate ? new Date(s.serviceEndDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : ''
      ]);
      // Build simple Excel-compatible HTML table (opens in Excel). Covers all filtered data, ignores pagination
      const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Build real XLSX (OOXML) with a tiny ZIP writer (store only)
      const xmlEsc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
      const rowsXml = [
        `<row r="1">${header.map((h,i)=>`<c r="${String.fromCharCode(65+i)}1" t="inlineStr"><is><t>${xmlEsc(h)}</t></is></c>`).join('')}</row>`,
        ...rows.map((r,ri)=>`<row r="${ri+2}">${r.map((v,ci)=>{ const a=`${String.fromCharCode(65+ci)}${ri+2}`; const isNum = (ci===2||ci===3) && v!=='' && !isNaN(Number(v)); return isNum ? `<c r="${a}" t="n"><v>${Number(v)}</v></c>` : `<c r="${a}" t="inlineStr"><is><t>${xmlEsc(String(v))}</t></is></c>`; }).join('')}</row>`)
      ].join('');
      const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
      const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>`;
      // Root relationships: point to the workbook part
      const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
      // Workbook relationships: point to the worksheet part
      const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

      const zip = buildZip([
        { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
        { name: '_rels/.rels', data: new TextEncoder().encode(rootRels) },
        { name: 'xl/workbook.xml', data: new TextEncoder().encode(workbook) },
        { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(wbRels) },
        { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(sheet) },
      ]);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const ab = new ArrayBuffer(zip.length); const u8 = new Uint8Array(ab); u8.set(zip);
      a.href = URL.createObjectURL(new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `sales_${ts}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch {}
  };

  // no-op

  function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
    const te = new TextEncoder();
    const makeUInt32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
    const makeUInt16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
    const table = (()=>{ const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); } t[n]=c>>>0; } return t; })();
    const crc32 = (buf: Uint8Array) => { let c = ~0; for (let i=0;i<buf.length;i++){ c = (c>>>8) ^ table[(c ^ buf[i]) & 0xFF]; } return (~c) >>> 0; };
    const parts: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
      const name = te.encode(f.name);
      const crc = crc32(f.data);
      const local = new Uint8Array(30 + name.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, f.data.length, true); dv.setUint32(22, f.data.length, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, f.data); const localOffset = offset; offset += local.length + f.data.length;

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(42, localOffset, true);
      central.set(name, 46);
      centrals.push(central);
    }
    const centralSize = centrals.reduce((s,a)=>s+a.length,0);
    const centralOffset = offset;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, centralOffset, true);
    const out = new Uint8Array(offset + centralSize + end.length);
    let p = 0; for (const part of parts) { out.set(part, p); p += part.length; }
    for (const c of centrals) { out.set(c, p); p += c.length; }
    out.set(end, p);
    return out;
  }
  async function ensurePageCode(orderId: number): Promise<string | null> {
    if (pageCodes[orderId]) return pageCodes[orderId];
    try {
      const r = await fetch(`/api/sales/by-order/${encodeURIComponent(String(orderId))}`, { cache: 'no-store', credentials: 'include' });
      const d = await r.json();
      const code: string | undefined = d?.pageCode;
      if (code) {
        setPageCodes((prev) => (prev[orderId] ? prev : { ...prev, [orderId]: code! }));
        return code;
      }
    } catch {}
    return null;
  }


  return (
    <div className="mx-auto w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 items-end text-sm">
          <div>
            <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Добавить фильтр</div>
            <select
              className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44"
              defaultValue=""
              onChange={(e) => { const k = e.target.value; if (k) { addFilter(k); e.currentTarget.value = ''; } }}
            >
              <option value="">Выбрать…</option>
              {allFilterDefs.filter((d) => !visibleFilters.includes(d.key)).map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
          <Button variant="ghost" onClick={() => { setVisibleFilters([]); setQuery(''); setStatus('all'); setAgent('all'); setPurchaseReceipt('all'); setFullReceipt('all'); setCommissionReceipt('all'); setNpdReceipt('all'); setShowHidden('no'); setDateFrom(''); setDateTo(''); setEndFrom(''); setEndTo(''); setAmountMin(''); setAmountMax(''); }}>
            Сбросить
          </Button>
          <Button variant="secondary" onClick={() => load(true, paged.map((s) => s.orderId))} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</Button>
          <div className="ml-auto" />
          <Button variant="secondary" onClick={exportXlsx} className="flex items-center gap-1">
            <IconArrowDown />
            Выгрузить XLS
          </Button>
        </div>
        
        {visibleFilters.length > 0 ? (
          <div className="flex flex-wrap gap-3 items-end text-sm">
            {visibleFilters.includes('showHidden') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Видимость</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={showHidden} onChange={(e) => setShowHidden(e.target.value as any)}>
                    <option value="all">Все</option>
                    <option value="yes">Только скрытые</option>
                    <option value="no">Только видимые</option>
                  </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('showHidden')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('status') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Статус</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="pending">pending</option>
              <option value="paying">paying</option>
              <option value="paid">paid</option>
              <option value="transfered">transfered</option>
            </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('status')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('agent') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Тип продажи</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={agent} onChange={(e) => setAgent(e.target.value as any)}>
                    <option value="all">Все</option>
                    <option value="yes">Агентская</option>
                    <option value="no">Прямая</option>
                  </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('agent')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('prepay') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Чек предоплаты</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={purchaseReceipt} onChange={(e) => setPurchaseReceipt(e.target.value as any)}>
                    <option value="all">Все</option>
                    <option value="yes">Есть</option>
                    <option value="no">Нет</option>
                  </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('prepay')}>×</Button>
                </div>
          </div>
            ) : null}
            {visibleFilters.includes('full') ? (
          <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Чек полного расчёта</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={fullReceipt} onChange={(e) => setFullReceipt(e.target.value as any)}>
              <option value="all">Все</option>
                    <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('full')}>×</Button>
                </div>
          </div>
            ) : null}
            {visibleFilters.includes('commission') ? (
          <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Чек комиссии</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={commissionReceipt} onChange={(e) => setCommissionReceipt(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('commission')}>×</Button>
                </div>
          </div>
            ) : null}
            {visibleFilters.includes('npd') ? (
          <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Чек НПД</div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950 w-44" value={npdReceipt} onChange={(e) => setNpdReceipt(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('npd')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('saleFrom') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Дата продажи c</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('saleFrom')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('saleTo') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Дата продажи по</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('saleTo')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('endFrom') ? (
              <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Окончание услуги c</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950" type="date" value={endFrom} onChange={(e) => setEndFrom(e.target.value)} />
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('endFrom')}>×</Button>
                </div>
          </div>
            ) : null}
            {visibleFilters.includes('endTo') ? (
          <div>
                <div className="text-sm mb-1 text-gray-600 dark:text-gray-400">Окончание услуги по</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-lg px-2 h-9 text-sm bg-white dark:bg-gray-950" type="date" value={endTo} onChange={(e) => setEndTo(e.target.value)} />
                  <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('endTo')}>×</Button>
                </div>
              </div>
            ) : null}
            {visibleFilters.includes('amountMin') ? (
              <div className="flex items-end gap-2">
                <Input label="Сумма от" type="number" step="0.01" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className="w-32" />
                <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('amountMin')}>×</Button>
              </div>
            ) : null}
            {visibleFilters.includes('amountMax') ? (
              <div className="flex items-end gap-2">
                <Input label="Сумма до" type="number" step="0.01" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className="w-32" />
                <Button aria-label="Убрать фильтр" variant="ghost" size="icon" onClick={() => removeFilter('amountMax')}>×</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Global context menu portal to appear above the table */}
      {menuOpenId != null && menuPos && openSale ? createPortal(
        <div className="fixed z-[10000]" style={{ top: menuPos.top, left: menuPos.left, width: 192 }} data-menu-root>
          <div className="w-48 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded shadow-sm">
            {(() => {
              const fin = String(openSale.status || '').toLowerCase();
              const isFinal = fin === 'paid' || fin === 'transfered' || fin === 'transferred';
              return (
                <>
                  <a className="block px-3 py-2 text-sm font-medium text-left hover:bg-gray-50 dark:hover:bg-gray-900" href={`/sales/${encodeURIComponent(String(openSale.taskId))}`}>Подробнее</a>
                  <div className="border-t border-gray-100 dark:border-gray-800" />
                  {isFinal ? (
                    (() => {
                      const code = pageCodes[openSale.orderId];
                      return code ? (
                        <a className="block px-3 py-2 text-sm font-medium text-left hover:bg-gray-50 dark:hover:bg-gray-900" href={`/link/s/${encodeURIComponent(code)}`} target="_blank" rel="noreferrer" onClick={() => setMenuOpenId(null)}>Страница продажи</a>
                      ) : (
                        <div className="px-3 py-2 text-sm text-gray-500">Готовим ссылку…</div>
                      );
                    })()
                  ) : null}
                </>
              );
            })()}
            {openSale.hidden ? (
              <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => { try { await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ taskId: openSale.taskId, hidden: false }) }); await load(false); } catch {} finally { setMenuOpenId(null); } }}>
                Отобразить
              </button>
            ) : (
              <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => { try { await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ taskId: openSale.taskId, hidden: true }) }); await load(false); } catch {} finally { setMenuOpenId(null); } }}>
                Скрыть
              </button>
            )}
          </div>
        </div>, document.body) : null}
      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paged.length === 0 ? (
          <div className="text-center text-gray-500 border rounded-lg p-4 bg-white dark:bg-gray-950">Нет данных</div>
        ) : (
          paged.map((s) => (
            <div key={String(s.taskId)} className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 p-2">
              <div className="grid grid-cols-[5.2rem_1fr_5.8rem_1fr] gap-x-2 gap-y-1 text-[12px] leading-tight">
                <div className="text-xs text-gray-500">№</div>
                <div className="font-medium">{s.taskId}</div>
                <div className="text-xs text-gray-500">Статус</div>
                <div>{s.status ?? '-'}</div>
                <div className="text-xs text-gray-500 whitespace-nowrap">Сумма, {'\u00A0'}₽</div>
                <div>{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.amountGrossRub)}</div>
                <div className="text-xs text-gray-500 whitespace-nowrap">Комиссия, {'\u00A0'}₽</div>
                <div>{s.isAgent ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.retainedCommissionRub) : '-'}</div>
                <div className="text-xs text-gray-500">Дата</div>
                <div>{fmtDate(s.createdAtRw)}</div>
                <div className="text-xs text-gray-500">Окончание</div>
                <div>{s.serviceEndDate ? fmtDate(s.serviceEndDate) : '-'}</div>
                <div className="text-xs text-gray-500">Тип</div>
                <div className="col-span-3">{s.isAgent ? 'Агентская' : 'Прямая'}</div>
              </div>
              <div className="mt-2 grid grid-cols-2 items-center">
          <div>
                  <Button variant="secondary" onClick={() => setChecksOpenId((id) => (id === s.taskId ? null : s.taskId))}>Чеки</Button>
          </div>
                <div className="justify-self-end">
                  <div className="relative" data-menu-root>
                    <Button aria-label="Действия" variant="secondary" size="icon" onClick={() => setMenuOpenId((id) => (id === s.taskId ? null : s.taskId))}>
                      <IconDotsHorizontal />
                    </Button>
                    <div className={`absolute right-0 mt-2 w-44 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded shadow-sm z-[9999] ${menuOpenId === s.taskId ? '' : 'hidden'}`}>
                      <a className="block px-3 py-2 text-sm font-medium text-left hover:bg-gray-50 dark:hover:bg-gray-900" href={`/sales/${encodeURIComponent(String(s.taskId))}`}>Подробнее</a>
                      <div className="border-t border-gray-100 dark:border-gray-800" />
                      {(() => {
                        const fin = String(s.status || '').toLowerCase();
                        const isFinal = fin === 'paid' || fin === 'transfered' || fin === 'transferred';
                        if (!isFinal) return null;
                        const code = pageCodes[s.orderId];
                        return code ? (
                          <a className="block px-3 py-2 text-sm font-medium text-left hover:bg-gray-50 dark:hover:bg-gray-900" href={`/link/s/${encodeURIComponent(code)}`} target="_blank" rel="noreferrer" onClick={() => setMenuOpenId(null)}>Страница продажи</a>
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">Готовим ссылку…</div>
                        );
                      })()}
                      {s.hidden ? (
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => { try { await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ taskId: s.taskId, hidden: false }) }); await load(false); } catch {} finally { setMenuOpenId(null); } }}>
                          Отобразить
                        </button>
                      ) : (
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => { try { await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ taskId: s.taskId, hidden: true }) }); await load(false); } catch {} finally { setMenuOpenId(null); } }}>
                          Скрыть
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {checksOpenId === s.taskId ? (
                <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-2 text-sm">
                  <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                    {s.ofdUrl ? (<><div className="text-gray-500">Предоплата</div><a className="text-black font-semibold hover:underline" href={s.ofdUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.ofdFullUrl ? (<><div className="text-gray-500">Полный расчёт</div><a className="text-black font-semibold hover:underline" href={s.ofdFullUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.additionalCommissionOfdUrl ? (<><div className="text-gray-500">Комиссия</div><a className="text-black font-semibold hover:underline" href={s.additionalCommissionOfdUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.npdReceiptUri ? (<><div className="text-gray-500">НПД</div><a className="text-black font-semibold hover:underline" href={s.npdReceiptUri} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {!s.ofdUrl && !s.ofdFullUrl && !s.additionalCommissionOfdUrl && !s.npdReceiptUri ? (
                      <div className="col-span-2 text-gray-500">Чеки недоступны</div>
                    ) : null}
                  </div>
        </div>
              ) : null}
        </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      {/* Context menu container placed above the table for clipping safety */}
      <div className="hidden md:block overflow-x-auto overflow-y-visible relative bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg z-[1]" ref={tableWrapRef}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left px-3 py-2">№</th>
              <th className="text-left px-3 py-2">Тип</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">Сумма, {'\u00A0'}₽</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">Комиссия, {'\u00A0'}₽</th>
              <th className="text-left px-3 py-2">Статус оплаты</th>
              <th className="text-left px-1 py-2 w-10">Чек предоплаты</th>
              <th className="text-left px-1 py-2 w-10">Чек полного расчёта</th>
              <th className="text-left px-1 py-2 w-10">Чек комиссии</th>
              <th className="text-left px-1 py-2 w-10">Чек НПД</th>
              <th className="text-left px-3 py-2">Дата продажи</th>
              <th className="text-left px-3 py-2">Дата окончания оказания услуги</th>
              <th className="text-left px-3 py-2 w-14">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-gray-500">Нет данных</td>
              </tr>
            ) : paged.map((s) => (
              <tr key={String(s.taskId)} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2">{s.taskId}</td>
                <td className="px-3 py-2">{s.isAgent ? 'Агентская' : 'Прямая'}</td>
                <td className="px-3 py-2">{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.amountGrossRub)}</td>
                <td className="px-3 py-2">{s.isAgent ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.retainedCommissionRub) : '-'}</td>
                <td className="px-3 py-2">{s.status ?? '-'}</td>
                <td className="px-1 py-2 text-center">{s.ofdUrl ? <Button aria-label="Просмотреть чек предоплаты" variant="secondary" size="icon" onClick={() => window.open(s.ofdUrl!, '_blank')}><IconChevronRight /></Button> : '-'}</td>
                <td className="px-1 py-2 text-center">{s.ofdFullUrl ? <Button aria-label="Просмотреть чек полного расчёта" variant="secondary" size="icon" onClick={() => window.open(s.ofdFullUrl!, '_blank')}><IconChevronRight /></Button> : '-'}</td>
                <td className="px-1 py-2 text-center">{s.additionalCommissionOfdUrl ? <Button aria-label="Просмотреть чек комиссии" variant="secondary" size="icon" onClick={() => window.open(s.additionalCommissionOfdUrl!, '_blank')}><IconChevronRight /></Button> : '-'}</td>
                <td className="px-1 py-2 text-center">{s.npdReceiptUri ? <Button aria-label="Просмотреть чек НПД" variant="secondary" size="icon" onClick={() => window.open(s.npdReceiptUri!, '_blank')}><IconChevronRight /></Button> : '-'}</td>
                <td className="px-3 py-2">{s.createdAtRw ? new Date(s.createdAtRw).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-'}</td>
                <td className="px-3 py-2">{s.serviceEndDate ? new Date(s.serviceEndDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-'}</td>
                <td className="px-1 py-2 text-center">
                  <div className="relative inline-block">
                    <Button aria-label="Действия" variant="secondary" size="icon" onClick={(ev) => { if (!actionProbeRef.current) { try { actionProbeRef.current = ev.currentTarget as HTMLButtonElement; } catch {} } const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenuPos({ top: r.bottom + 8, left: r.right - 192 }); setMenuOpenId((id) => (id === s.taskId ? null : s.taskId)); void ensurePageCode(s.orderId); }}><IconDotsHorizontal /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(displayTotal > pageSize) ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="text-gray-600 dark:text-gray-400">Строк: {Math.min(displayTotal, page * pageSize)} из {displayTotal}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Назад</Button>
            <div className="h-9 min-w-8 inline-flex items-center justify-center">{page}</div>
            <Button variant="ghost" onClick={goNextPage} disabled={page * pageSize >= displayTotal}>Вперёд</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


