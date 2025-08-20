'use client';

import { useEffect, useMemo, useState } from 'react';

type LinkData = {
  code: string;
  userId: string;
  title: string;
  description: string;
  orgName?: string | null;
  sumMode: 'custom' | 'fixed';
  amountRub?: number | null;
  vatRate?: 'none' | '0' | '10' | '20' | null;
  isAgent?: boolean;
  commissionType?: 'percent' | 'fixed' | null;
  commissionValue?: number | null;
  partnerPhone?: string | null;
  method?: 'any' | 'qr' | 'card';
};

export default function PublicPayPage(props: any) {
  const code = typeof props?.params?.code === 'string' ? props.params.code : '';
  const [data, setData] = useState<LinkData | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'qr' | 'card'>('qr');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store' });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error || 'NOT_FOUND');
        setData(d);
        if (d?.sumMode === 'fixed' && typeof d?.amountRub === 'number') setAmount(String(d.amountRub));
        if (d?.method === 'card') setMethod('card'); else setMethod('qr');
      } catch (e) { setMsg('Ссылка не найдена'); }
    })();
  }, [code]);

  const canPay = useMemo(() => {
    if (!data) return false;
    if (data.sumMode === 'fixed') {
      const n = Number((data.amountRub ?? 0));
      if (!Number.isFinite(n) || n <= 0) return false;
      const minOk = data.isAgent
        ? (n - (data.commissionType === 'percent' ? n * (Number(data.commissionValue || 0) / 100) : Number(data.commissionValue || 0))) >= 10
        : n >= 10;
      return minOk;
    }
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return false;
    const minOk = data.isAgent
      ? (n - (data.commissionType === 'percent' ? n * (Number(data.commissionValue || 0) / 100) : Number(data.commissionValue || 0))) >= 10
      : n >= 10;
    return minOk;
  }, [data, amount]);

  const goPay = async () => {
    if (!data) return;
    try {
      setLoading(true);
      const body: any = {
        amountRub: data.sumMode === 'fixed' ? (data.amountRub || 0) : Number(amount.replace(',', '.')),
        description: data.description,
        method: method === 'card' ? 'card' : 'qr',
        clientEmail: undefined,
        agentSale: !!data.isAgent,
        agentPhone: data.partnerPhone || undefined,
        commissionType: data.isAgent ? (data.commissionType || undefined) : undefined,
        commissionValue: data.isAgent ? (typeof data.commissionValue === 'number' ? data.commissionValue : undefined) : undefined,
        vatRate: (data.vatRate || 'none'),
      };
      const res = await fetch('/api/rocketwork/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId }, body: JSON.stringify(body) });
      const txt = await res.text();
      const d = txt ? JSON.parse(txt) : {};
      if (!res.ok) throw new Error(d?.error || 'CREATE_FAILED');
      const payUrl = d?.data?.acquiring_order?.url || d?.data?.acquiring_order?.payment_url || null;
      if (payUrl) window.open(payUrl, '_blank');
      setMsg('Перейдите в открытую вкладку банка, чтобы завершить оплату.');
    } catch (e) {
      setMsg('Не удалось сформировать ссылку на оплату');
    } finally { setLoading(false); }
  };

  if (!data) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Оплата</h1>
        <div className="text-gray-600">{msg || 'Загрузка…'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Оплата в пользу {data.orgName || 'Организация'}</h1>
      <div className="text-sm text-gray-600 mb-4">Название: {data.title}</div>
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="mb-3">
          <div className="text-sm text-gray-600">За что платим</div>
          <div className="text-sm">{data.description}</div>
        </div>
        <div className="mb-3">
          <label className="block text-sm text-gray-600 mb-1">Сумма, ₽</label>
          {data.sumMode === 'fixed' ? (
            <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={amount} readOnly />
          ) : (
            <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          )}
          {data.sumMode === 'custom' ? (
            <div className="text-xs text-gray-500 mt-1">Минимальная сумма {data.isAgent ? 'за вычетом комиссии' : ''} — 10 ₽</div>
          ) : null}
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-600 mb-1">Способ оплаты</label>
          {data.method === 'any' ? (
            <select className="border rounded-lg px-2 h-9 text-sm w-40" value={method} onChange={(e) => setMethod(e.target.value as any)}>
              <option value="qr">СБП</option>
              <option value="card">Карта</option>
            </select>
          ) : (
            <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={data.method === 'card' ? 'Карта' : 'СБП'} readOnly />
          )}
        </div>
        <button disabled={!canPay || loading} onClick={goPay} className="inline-flex items-center justify-center rounded-lg bg-black text-white px-4 h-9 text-sm disabled:opacity-60">
          {loading ? 'Создаю ссылку…' : 'Перейти к оплате'}
        </button>
        {msg ? <div className="mt-3 text-sm text-gray-600">{msg}</div> : null}
      </div>
    </div>
  );
}


