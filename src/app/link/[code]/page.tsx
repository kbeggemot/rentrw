"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Flow state
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [awaitingPay, setAwaitingPay] = useState(false);
  const [receipts, setReceipts] = useState<{ prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null }>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  const pollRef = useRef<number | null>(null);
  const payUrlPollRef = useRef<number | null>(null);

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

  // helpers
  const mskToday = () => new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
  const isValidEmail = (s: string) => /.+@.+\..+/.test(s.trim());

  const canPay = useMemo(() => {
    if (!data) return false;
    const n = Number((data.sumMode === 'fixed' ? (data.amountRub ?? 0) : Number(amount.replace(',', '.'))));
    if (!Number.isFinite(n) || n <= 0) return false;
    const minOk = data.isAgent
      ? (n - (data.commissionType === 'percent' ? n * (Number(data.commissionValue || 0) / 100) : Number(data.commissionValue || 0))) >= 10
      : n >= 10;
    return minOk && isValidEmail(email);
  }, [data, amount, email]);

  const startPoll = (uid: string | number) => {
    if (pollRef.current) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/rocketwork/tasks/${encodeURIComponent(String(uid))}`, { cache: 'no-store', headers: data?.userId ? { 'x-user-id': data.userId } as any : undefined });
        const t = await r.json();
        const sale = t?.sale || null;
        if (sale) {
          const st = String(sale.status || '').toLowerCase();
          const pre = sale.ofdUrl || null;
          const full = sale.ofdFullUrl || null;
          const com = sale.additionalCommissionOfdUrl || null;
          const npd = sale.npdReceiptUri || null;
          setReceipts({ prepay: pre, full, commission: com, npd });
          if (st === 'paid' || st === 'transfered' || st === 'transferred') {
            if (pre || full || com || npd) {
              if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
              setAwaitingPay(false);
              return;
            }
          }
        }
      } catch {}
      pollRef.current = window.setTimeout(tick, 2000) as unknown as number;
    };
    pollRef.current = window.setTimeout(tick, 1500) as unknown as number;
  };

  const startPayUrlPoll = (uid: string | number) => {
    if (payUrlPollRef.current) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/rocketwork/task-status/${encodeURIComponent(String(uid))}`, { cache: 'no-store', headers: data?.userId ? { 'x-user-id': data.userId } as any : undefined });
        const t = await r.json();
        const ao = (t && (t.acquiring_order || (t.task && t.task.acquiring_order))) || null;
        const url = ao?.url || ao?.payment_url || null;
        if (url) {
          setPayUrl(url);
          if (payUrlPollRef.current) { window.clearTimeout(payUrlPollRef.current); payUrlPollRef.current = null; }
          return;
        }
      } catch {}
      payUrlPollRef.current = window.setTimeout(tick, 1500) as unknown as number;
    };
    payUrlPollRef.current = window.setTimeout(tick, 1000) as unknown as number;
  };

  const goPay = async () => {
    if (!data) return;
    try {
      setLoading(true);
      setMsg(null);
      setPayUrl(null);
      setTaskId(null);
      setDetailsOpen(true);
      const amountNum = data.sumMode === 'fixed' ? (data.amountRub || 0) : Number(amount.replace(',', '.'));
      const body: any = {
        amountRub: amountNum,
        description: data.description,
        method: method === 'card' ? 'card' : 'qr',
        clientEmail: email.trim(),
        agentSale: !!data.isAgent,
        agentPhone: data.partnerPhone || undefined,
        commissionType: data.isAgent ? (data.commissionType || undefined) : undefined,
        commissionValue: data.isAgent ? (typeof data.commissionValue === 'number' ? data.commissionValue : undefined) : undefined,
        vatRate: (data.vatRate || 'none'),
        serviceEndDate: mskToday(),
      };
      const res = await fetch('/api/rocketwork/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId }, body: JSON.stringify(body) });
      const txt = await res.text();
      const d = txt ? JSON.parse(txt) : {};
      if (!res.ok) throw new Error(d?.error || 'CREATE_FAILED');
      const tId = d?.task_id;
      setTaskId(tId || null);
      const url = d?.data?.acquiring_order?.url || d?.data?.acquiring_order?.payment_url || null;
      if (url) setPayUrl(url); else startPayUrlPoll(tId);
      setAwaitingPay(false);
      startPoll(tId);
    } catch (e) {
      setMsg('Не удалось сформировать платежную ссылку');
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
            <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={String(data.amountRub ?? '')} readOnly />
          ) : (
            <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          )}
          {data.sumMode === 'custom' ? (
            <div className="text-xs text-gray-500 mt-1">Минимальная сумма {data.isAgent ? 'за вычетом комиссии' : ''} — 10 ₽</div>
          ) : null}
        </div>
        <div className="mb-3">
          <label className="block text-sm text-gray-600 mb-1">Email покупателя</label>
          <input className="w-full sm:w-80 rounded-lg border px-2 h-9 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <div className="text-xs text-gray-500 mt-1">Отправим чек на этот email</div>
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
          {loading ? 'Формируем платежную ссылку…' : 'Перейти к оплате'}
        </button>

        {/* Inline expandable panel (Sales-like) */}
        {detailsOpen ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {!taskId ? (
              <div className="text-gray-600">Нажмите «Перейти к оплате», чтобы сформировать ссылку…</div>
            ) : (
              <div className="space-y-2">
                {!payUrl ? (
                  <div className="text-gray-600">Формируем платежную ссылку…</div>
                ) : (
                  <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                    <div className="text-gray-500">Ссылка</div>
                    <a className="text-blue-600 hover:underline" href={payUrl} target="_blank" rel="noreferrer" onClick={() => setAwaitingPay(true)}>Открыть</a>
                  </div>
                )}
                {awaitingPay ? (<div className="text-gray-600">Ждём подтверждения оплаты…</div>) : null}
                {(receipts.prepay || receipts.full || receipts.commission || receipts.npd) ? (
                  <div className="mt-1 rounded-md border border-gray-200 bg-white p-2">
                    <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                      {receipts.prepay ? (<><div className="text-gray-500">Предоплата</div><a className="text-blue-600 hover:underline" href={receipts.prepay} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                      {receipts.full ? (<><div className="text-gray-500">Полный расчёт</div><a className="text-blue-600 hover:underline" href={receipts.full} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                      {receipts.commission ? (<><div className="text-gray-500">Комиссия</div><a className="text-blue-600 hover:underline" href={receipts.commission} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                      {receipts.npd ? (<><div className="text-gray-500">НПД</div><a className="text-blue-600 hover:underline" href={receipts.npd} target="_blank" rel="noreferrer">Открыть</a></>) : null}
                      {(!receipts.prepay && !receipts.full && !receipts.commission && !receipts.npd) ? (
                        <div className="col-span-2 text-gray-500">Чеки недоступны</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {msg ? <div className="mt-3 text-sm text-gray-600">{msg}</div> : null}
      </div>
    </div>
  );
}


