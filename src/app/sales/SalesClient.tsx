"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Sale = {
  taskId: string | number;
  orderId: number;
  rwOrderId?: number | null;
  amountGrossRub: number;
  isAgent: boolean;
  retainedCommissionRub: number;
  source?: 'ui' | 'external';
  status?: string | null;
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  additionalCommissionOfdUrl?: string | null;
  npdReceiptUri?: string | null;
  serviceEndDate?: string | null;
  createdAt: string;
};

export default function SalesClient({ initial }: { initial: Sale[] }) {
  const [sales, setSales] = useState<Sale[]>(initial);
  const [loading, setLoading] = useState(false);

  // Filters
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'paying' | 'paid' | 'transfered'>('all');
  const [agent, setAgent] = useState<'all' | 'yes' | 'no'>('all');
  const [source, setSource] = useState<'all' | 'ui' | 'external'>('ui');
  const [purchaseReceipt, setPurchaseReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [commissionReceipt, setCommissionReceipt] = useState<'all' | 'yes' | 'no'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      if (refresh) {
        void fetch('/api/sales?refresh=1', { cache: 'no-store' })
          .then(() => fetch('/api/sales', { cache: 'no-store' }))
          .then((r) => r.json())
          .then((d) => setSales(Array.isArray(d?.sales) ? d.sales : []))
          .catch(() => void 0)
          .finally(() => setLoading(false));
        const resOld = await fetch('/api/sales', { cache: 'no-store' });
        const oldData = await resOld.json();
        setSales(Array.isArray(oldData?.sales) ? oldData.sales : []);
      } else {
        const res = await fetch('/api/sales', { cache: 'no-store' });
        const data = await res.json();
        setSales(Array.isArray(data?.sales) ? data.sales : []);
      }
    } catch {
      setSales([]);
    } finally {
      if (!refresh) setLoading(false);
    }
  };

  // удалено: глобальное "обновить всё" по просьбе

  const filtered = useMemo(() => {
    const q = query.trim();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const min = amountMin ? Number(amountMin.replace(',', '.')) : null;
    const max = amountMax ? Number(amountMax.replace(',', '.')) : null;
    return sales.filter((s) => {
      if (q && !String(s.orderId).includes(q) && !String(s.taskId).includes(q)) return false;
      if (source !== 'all') {
        if (s.source !== source) return false;
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
      if (commissionReceipt !== 'all') {
        const has = Boolean(s.additionalCommissionOfdUrl);
        if (commissionReceipt === 'yes' && !has) return false;
        if (commissionReceipt === 'no' && has) return false;
      }
      if (fromTs != null || toTs != null) {
        const ts = new Date(s.createdAt).getTime();
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (min != null && !(s.amountGrossRub >= min)) return false;
      if (max != null && !(s.amountGrossRub <= max)) return false;
      return true;
    });
  }, [sales, query, status, agent, purchaseReceipt, commissionReceipt, dateFrom, dateTo, amountMin, amountMax]);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="hidden md:block text-2xl font-bold mb-4">Продажи</h1>
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Статус</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="pending">pending</option>
              <option value="paying">paying</option>
              <option value="paid">paid</option>
              <option value="transfered">transfered</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Источник</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={source} onChange={(e) => setSource(e.target.value as any)}>
              <option value="ui">Только из UI</option>
              <option value="all">Все</option>
              <option value="external">Только внешние</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Агентская</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={agent} onChange={(e) => setAgent(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Чек покупки</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={purchaseReceipt} onChange={(e) => setPurchaseReceipt(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Чек комиссии</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={commissionReceipt} onChange={(e) => setCommissionReceipt(e.target.value as any)}>
              <option value="all">Все</option>
              <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Дата c</div>
            <input className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-xs mb-1 text-gray-600 dark:text-gray-400">Дата по</div>
            <input className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <Input label="Сумма от" type="number" step="0.01" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className="w-32" />
          <Input label="Сумма до" type="number" step="0.01" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className="w-32" />
          <Button variant="ghost" onClick={() => { setQuery(''); setStatus('all'); setAgent('all'); setPurchaseReceipt('all'); setCommissionReceipt('all'); setDateFrom(''); setDateTo(''); setAmountMin(''); setAmountMax(''); }}>
            Сбросить
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => load(true)} disabled={loading}>{loading ? 'Обновляю…' : 'Обновить'}</Button>
        </div>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left px-3 py-2">№</th>
              <th className="text-left px-3 py-2">order_id</th>
              <th className="text-left px-3 py-2">RW order</th>
              <th className="text-left px-3 py-2">Сумма</th>
              <th className="text-left px-3 py-2">Агентская</th>
              <th className="text-left px-3 py-2">Удержана комиссия</th>
              <th className="text-left px-3 py-2">Статус</th>
              <th className="text-left px-3 py-2">Чек на предоплату покупки</th>
              <th className="text-left px-3 py-2">Чек на полный расчёт покупки</th>
              <th className="text-left px-3 py-2">Чек на комиссию</th>
              <th className="text-left px-3 py-2">Чек НПД</th>
              <th className="text-left px-3 py-2">Дата окончания оказания услуги</th>
              <th className="text-left px-3 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">Нет данных</td>
              </tr>
            ) : filtered.map((s) => (
              <tr key={String(s.taskId)} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2">{s.taskId}</td>
                <td className="px-3 py-2">{s.orderId}</td>
                <td className="px-3 py-2">{s.rwOrderId ?? '-'}</td>
                <td className="px-3 py-2">{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(s.amountGrossRub)}</td>
                <td className="px-3 py-2">{s.isAgent ? 'Да' : 'Нет'}</td>
                <td className="px-3 py-2">{s.isAgent ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(s.retainedCommissionRub) : '-'}</td>
                <td className="px-3 py-2">{s.status ?? '-'}</td>
                <td className="px-3 py-2">{s.ofdUrl ? <a className="text-blue-600 hover:underline" href={s.ofdUrl} target="_blank" rel="noreferrer">Открыть</a> : '-'}</td>
                <td className="px-3 py-2">{s.ofdFullUrl ? <a className="text-blue-600 hover:underline" href={s.ofdFullUrl} target="_blank" rel="noreferrer">Открыть</a> : '-'}</td>
                <td className="px-3 py-2">{s.additionalCommissionOfdUrl ? <a className="text-blue-600 hover:underline" href={s.additionalCommissionOfdUrl} target="_blank" rel="noreferrer">Открыть</a> : '-'}</td>
                <td className="px-3 py-2">{s.npdReceiptUri ? <a className="text-blue-600 hover:underline" href={s.npdReceiptUri} target="_blank" rel="noreferrer">Открыть</a> : '-'}</td>
                <td className="px-3 py-2">{s.serviceEndDate ?? '-'}</td>
                <td className="px-3 py-2"><Button variant="secondary" onClick={() => alert('Будет доступно позже')}>Изменить</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


