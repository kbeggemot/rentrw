"use client";

import { useEffect, useMemo, useState } from 'react';
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
  createdAt: string;
};

export default function SalesClient({ initial }: { initial: Sale[] }) {
  const [sales, setSales] = useState<Sale[]>(initial);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

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

  // Filters
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'paying' | 'paid' | 'transfered'>('all');
  const [agent, setAgent] = useState<'all' | 'yes' | 'no'>('all');
  const [purchaseReceipt, setPurchaseReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [fullReceipt, setFullReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [commissionReceipt, setCommissionReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [npdReceipt, setNpdReceipt] = useState<'all' | 'yes' | 'no'>('all');
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
  ];
  const addFilter = (key: string) => {
    setVisibleFilters((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const removeFilter = (key: string) => {
    setVisibleFilters((prev) => prev.filter((k) => k !== key));
  };

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      if (refresh) {
        void fetch('/api/sales?refresh=1', { cache: 'no-store', credentials: 'include' })
          .then(() => fetch('/api/sales', { cache: 'no-store', credentials: 'include' }))
          .then((r) => r.json())
          .then((d) => {
            const list = Array.isArray(d?.sales) ? d.sales : [];
            setSales((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
          })
          .catch(() => void 0)
          .finally(() => setLoading(false));
        const resOld = await fetch('/api/sales', { cache: 'no-store', credentials: 'include' });
        const oldData = await resOld.json();
        const listOld = Array.isArray(oldData?.sales) ? oldData.sales : [];
        setSales((prev) => (JSON.stringify(prev) === JSON.stringify(listOld) ? prev : listOld));
      } else {
        const res = await fetch('/api/sales', { cache: 'no-store', credentials: 'include' });
        const data = await res.json();
        const list = Array.isArray(data?.sales) ? data.sales : [];
        setSales((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      }
    } catch {
      // keep previous data to avoid flicker
    } finally {
      if (!refresh) setLoading(false);
    }
  };

  // Авто‑обновление при заходе на страницу:
  // не очищаем таблицу, просто подменяем данные, когда придут новые
  useEffect(() => {
    // Запускаем мягкое фоновое обновление через 1.8с после гидратации
    let timer: number | null = null;
    if (typeof window !== 'undefined') {
      timer = window.setTimeout(() => { load(true).catch(() => {}); }, 1800);
    }
    return () => { if (timer) window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // удалено: глобальное "обновить всё" по просьбе

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
  }, [sales, query, status, agent, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [query, status, agent, purchaseReceipt, fullReceipt, commissionReceipt, npdReceipt, dateFrom, dateTo, endFrom, endTo, amountMin, amountMax]);

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-');
  const [checksOpenId, setChecksOpenId] = useState<string | number | null>(null);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="hidden md:block text-2xl font-bold mb-4">Продажи</h1>
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
          <Button variant="ghost" onClick={() => { setVisibleFilters([]); setQuery(''); setStatus('all'); setAgent('all'); setPurchaseReceipt('all'); setFullReceipt('all'); setCommissionReceipt('all'); setNpdReceipt('all'); setDateFrom(''); setDateTo(''); setEndFrom(''); setEndTo(''); setAmountMin(''); setAmountMax(''); }}>
            Сбросить
          </Button>
          <Button variant="secondary" onClick={() => load(true)} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</Button>
        </div>
        {visibleFilters.length > 0 ? (
          <div className="flex flex-wrap gap-3 items-end text-sm">
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
      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {paged.length === 0 ? (
          <div className="text-center text-gray-500 border rounded-lg p-4 bg-white dark:bg-gray-950">Нет данных</div>
        ) : (
          paged.map((s) => (
            <div key={String(s.taskId)} className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 p-3">
              <div className="grid grid-cols-[7.5rem_1fr_7.5rem_1fr] gap-y-2 text-sm">
                <div className="text-gray-500">№</div>
                <div className="font-medium">{s.taskId}</div>
                <div className="text-gray-500">Статус</div>
                <div>{s.status ?? '-'}</div>
                <div className="text-gray-500 whitespace-nowrap">Сумма, {'\u00A0'}₽</div>
                <div>{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.amountGrossRub)}</div>
                <div className="text-gray-500 whitespace-nowrap">Комиссия, {'\u00A0'}₽</div>
                <div>{s.isAgent ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.retainedCommissionRub) : '-'}</div>
                <div className="text-gray-500">Дата</div>
                <div>{fmtDate(s.createdAtRw)}</div>
                <div className="text-gray-500">Окончание</div>
                <div>{s.serviceEndDate ? fmtDate(s.serviceEndDate) : '-'}</div>
                <div className="text-gray-500">Тип</div>
                <div className="col-span-3">{s.isAgent ? 'Агентская' : 'Прямая'}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 items-center">
                <div>
                  <Button variant="secondary" onClick={() => setChecksOpenId((id) => (id === s.taskId ? null : s.taskId))}>Чеки</Button>
                </div>
                <div className="justify-self-end">
                  <Button aria-label="Изменить" variant="secondary" size="icon" onClick={() => alert('Будет доступно позже')}>
                    <IconEdit />
                  </Button>
                </div>
              </div>
              {checksOpenId === s.taskId ? (
                <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-2 text-sm">
                  <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                    {s.ofdUrl ? (<><div className="text-gray-500">Предоплата</div><a className="text-blue-600 hover:underline" href={s.ofdUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.ofdFullUrl ? (<><div className="text-gray-500">Полный расчёт</div><a className="text-blue-600 hover:underline" href={s.ofdFullUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.additionalCommissionOfdUrl ? (<><div className="text-gray-500">Комиссия</div><a className="text-blue-600 hover:underline" href={s.additionalCommissionOfdUrl} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                    {s.npdReceiptUri ? (<><div className="text-gray-500">НПД</div><a className="text-blue-600 hover:underline" href={s.npdReceiptUri} target="_blank" rel="noreferrer">Открыть</a></>) : null}
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
      <div className="hidden md:block overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left px-3 py-2">№</th>
              <th className="text-left px-3 py-2">Тип</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">Сумма, {'\u00A0'}₽</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">Комиссия, {'\u00A0'}₽</th>
              <th className="text-left px-3 py-2">Статус</th>
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
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">Нет данных</td>
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
                <td className="px-1 py-2 text-center"><Button aria-label="Изменить" variant="secondary" size="icon" onClick={() => alert('Будет доступно позже')}><IconEdit /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="text-gray-600 dark:text-gray-400">Строк: {Math.min(filtered.length, page * pageSize)} из {filtered.length}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Назад</Button>
            <div className="h-9 min-w-8 inline-flex items-center justify-center">{page}</div>
            <Button variant="ghost" onClick={() => setPage((p) => (p * pageSize < filtered.length ? p + 1 : p))} disabled={page * pageSize >= filtered.length}>Вперёд</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


