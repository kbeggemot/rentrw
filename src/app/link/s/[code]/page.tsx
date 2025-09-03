"use client";

import { use, useEffect, useState, useMemo, useRef } from 'react';

type Receipts = { prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null };

export default function PermanentSaleRedirect(props: { params: Promise<{ code?: string }> }) {
  const p = use(props.params) || {} as { code?: string };
  const code = typeof p.code === 'string' ? p.code : '';
  const [orderId, setOrderId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [receipts, setReceipts] = useState<Receipts>({});
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null; createdAt?: string | null } | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [dots, setDots] = useState('.');
  const pollRef = useRef<number | null>(null);

  useEffect(() => { const t = window.setInterval(() => setDots((p) => (p.length >= 3 ? '.' : p + '.')), 400) as unknown as number; return () => { window.clearInterval(t); }; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sale-page/${encodeURIComponent(code)}`, { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          if (d?.userId) setUserId(String(d.userId));
          // Проверим наличие активного токена организации для оплаты
          try {
            const orgRes = await fetch(`/api/organizations/status?uid=${encodeURIComponent(String(d?.userId || ''))}${d?.sale?.orgInn ? `&org=${encodeURIComponent(String(d.sale.orgInn))}` : ''}`, { cache: 'no-store' });
            const orgD = await orgRes.json().catch(() => ({}));
            if (!orgRes.ok || orgD?.hasToken !== true) {
              // если нет токена — не показываем детали оплаты
              setDetailsOpen(false);
            }
          } catch {}
          if (d?.orderId != null) setOrderId(Number(d.orderId));
          if (d?.sale) {
            setTaskId(d.sale.taskId || null);
            setIsAgent(typeof d.sale.isAgent === 'boolean' ? Boolean(d.sale.isAgent) : null);
            setSummary({ amountRub: d.sale.amountRub, description: d.sale.description, createdAt: d.sale.createdAt });
            setReceipts({ prepay: d.sale.ofdUrl || null, full: d.sale.ofdFullUrl || null, commission: d.sale.commissionUrl || null, npd: d.sale.npdReceiptUri || null });
          }
        } else {
          // fallback to legacy link behavior
          const r2 = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store' });
          const d2 = await r2.json();
          if (r2.ok) { setUserId(String(d2?.userId || '')); }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!taskId || !userId) return;
    const tick = async () => {
      try {
        const sr = await fetch(`/api/sales/by-task/${encodeURIComponent(String(taskId))}`, { cache: 'no-store', headers: { 'x-user-id': userId } as any });
        if (sr.ok) {
          const sj = await sr.json();
          const sl = sj?.sale;
          if (sl) {
            setIsAgent(typeof sl.isAgent === 'boolean' ? Boolean(sl.isAgent) : isAgent);
            setReceipts((prev) => ({
              prepay: sl?.ofdUrl ?? prev.prepay ?? null,
              full: sl?.ofdFullUrl ?? prev.full ?? null,
              commission: sl?.additionalCommissionOfdUrl ?? prev.commission ?? null,
              npd: sl?.npdReceiptUri ?? prev.npd ?? null,
            }));
            if (!summary) setSummary({ amountRub: sl.amountGrossRub, description: sl.description, createdAt: sl.createdAtRw || sl.createdAt });
          }
        }
      } catch {}
      pollRef.current = window.setTimeout(tick, 1500) as unknown as number;
    };
    pollRef.current = window.setTimeout(tick, 1000) as unknown as number;
    return () => { if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; } };
  }, [taskId, userId]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Платёж успешно выполнен</h1>
      <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Спасибо! Мы сформируем чек(и) автоматически и отправим на почту.</div>
      <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-sm">
        <div className="grid grid-cols-[9rem_1fr] gap-y-2 mb-2 text-gray-900 dark:text-gray-100">
          <div className="text-gray-600 dark:text-gray-400">За что платим</div>
          <div>{summary?.description || '—'}</div>
          <div className="text-gray-600 dark:text-gray-400">Сумма</div>
          <div>{typeof summary?.amountRub === 'number' ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(summary!.amountRub!) : '—'}</div>
          <div className="text-gray-600 dark:text-gray-400">Дата оплаты</div>
          <div>{summary?.createdAt ? new Date(summary.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'}</div>
          <div className="text-gray-600 dark:text-gray-400">Чек на покупку</div>
          {(receipts.full || receipts.prepay) ? (
            <a className="text-blue-700 dark:text-blue-300 font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
          ) : (
            <div className="text-gray-700 dark:text-gray-300">Подтягиваем данные{dots}</div>
          )}
        </div>
        {isAgent ? (
          <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-gray-900 dark:text-gray-100">
            <div className="text-gray-600 dark:text-gray-400">Чек на комиссию</div>
            {receipts.commission ? (
              <a className="text-blue-700 dark:text-blue-300 font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
            ) : (
              <div className="text-gray-700 dark:text-gray-300">Подтягиваем данные{dots}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}


