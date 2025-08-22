"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type LinkInfo = { code: string; userId: string; title?: string; orgName?: string | null };

export default function PublicSuccessUnifiedPage() {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receipts, setReceipts] = useState<{ prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null }>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null; createdAt?: string | null } | null>(null);
  const [payMethod, setPayMethod] = useState<string | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const pollRef = useRef<number | null>(null);
  const [dots, setDots] = useState(".");

  useEffect(() => {
    let t: number | null = null;
    t = window.setInterval(() => setDots((p) => (p.length >= 3 ? "." : p + ".")), 400) as unknown as number;
    return () => { if (t) window.clearInterval(t); };
  }, []);

  // Restore last pay by sid or latest within 30 minutes
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get("sid");
      const orderParam = params.get("order");
      const now = Date.now();
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("lastPay:"));
      const candidates: Array<{ key: string; code: string; taskId: any; ts: number; sid?: string }> = [];
      for (const k of keys) {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          const ts = Number(obj?.ts || 0);
          if (!Number.isFinite(ts) || now - ts > 30 * 60 * 1000) continue; // ttl 30m
          // Accept either browser sid (from sessionStorage) or server resume token (from redirect)
          if (sid && obj?.sid && obj.sid !== sid) continue;
          const code = k.replace(/^lastPay:/, "");
          candidates.push({ key: k, code, taskId: obj?.taskId, ts, sid: obj?.sid });
        } catch {}
      }
      candidates.sort((a, b) => b.ts - a.ts);
      const chosen = candidates[0];
      if (!chosen || !chosen.taskId) {
        // Если на клиенте ничего нет — пробуем резолвить по sid или order на сервере и показать лоадер
        if (sid || orderParam) {
          setWaiting(true);
          (async () => {
            try {
              const url = sid ? `/api/pay-resume?sid=${encodeURIComponent(sid)}` : `/api/pay-resume?order=${encodeURIComponent(String(orderParam))}`;
              const r = await fetch(url, { cache: 'no-store' });
              const d = await r.json();
              if (r.ok && d?.taskId) {
                setTaskId(d.taskId);
                setInfo({ code: '', userId: String(d.userId || ''), title: undefined, orgName: d?.orgName || null });
                setOrderId(Number(d.orderId || 0) || null);
                if (d?.sale) {
                  setSummary({ amountRub: d.sale.amountRub, description: d.sale.description, createdAt: d.sale.createdAt ?? null });
                  if (typeof d.sale.isAgent === 'boolean') setIsAgent(Boolean(d.sale.isAgent));
                }
                if (d?.sale) {
                  setReceipts({
                    prepay: d.sale.ofdUrl || null,
                    full: d.sale.ofdFullUrl || null,
                    commission: d.sale.commissionUrl || null,
                    npd: d.sale.npdReceiptUri || null,
                  });
                }
                setWaiting(false);
              } else {
                setWaiting(false);
                setMsg('Данные об оплате не найдены или устарели');
              }
            } catch {
              setWaiting(false);
              setMsg('Данные об оплате не найдены или устарели');
            }
          })();
        } else {
          setMsg("Данные об оплате не найдены или устарели");
        }
        return;
      }
      setTaskId(chosen.taskId);
      (async () => {
        try {
          const r = await fetch(`/api/links/${encodeURIComponent(chosen.code)}`, { cache: "no-store" });
          const d = await r.json();
          if (r.ok) {
            setInfo({ code: chosen.code, userId: String(d?.userId || ""), title: d?.title, orgName: d?.orgName || null });
          }
        } catch {}
      })();
      try { localStorage.removeItem(chosen.key); } catch {}
    } catch {}
  }, []);

  const startPoll = (uid: string | number, userId?: string) => {
    if (pollRef.current) return;
    const tick = async () => {
      try {
        // 1) Локальный стор — приоритетно и быстрее
        try {
          if (userId) {
            if (orderId != null) {
              const sres = await fetch(`/api/sales/by-order/${orderId}`, { cache: 'no-store', headers: { 'x-user-id': userId } as any });
              if (sres.ok) {
                const sj = await sres.json();
                const sl = sj?.sale;
                if (typeof sl?.isAgent === 'boolean') setIsAgent(Boolean(sl.isAgent));
                setReceipts((prev) => ({
                  prepay: (sl?.ofdUrl ?? prev.prepay) || null,
                  full: (sl?.ofdFullUrl ?? prev.full) || null,
                  commission: (sl?.additionalCommissionOfdUrl ?? prev.commission) || null,
                  npd: (sl?.npdReceiptUri ?? prev.npd) || null,
                }));
              }
            } else {
              const sres = await fetch(`/api/sales/by-task/${encodeURIComponent(String(uid))}`, { cache: 'no-store', headers: { 'x-user-id': userId } as any });
              if (sres.ok) {
                const sj = await sres.json();
                const sl = sj?.sale;
                if (typeof sl?.isAgent === 'boolean') setIsAgent(Boolean(sl.isAgent));
                setReceipts((prev) => ({
                  prepay: (sl?.ofdUrl ?? prev.prepay) || null,
                  full: (sl?.ofdFullUrl ?? prev.full) || null,
                  commission: (sl?.additionalCommissionOfdUrl ?? prev.commission) || null,
                  npd: (sl?.npdReceiptUri ?? prev.npd) || null,
                }));
              }
            }
          }
        } catch {}

        // 2) RW — как резервный источник статусов
        const r = await fetch(`/api/rocketwork/tasks/${encodeURIComponent(String(uid))}?t=${Date.now()}`, { cache: 'no-store', headers: userId ? { 'x-user-id': userId } as any : undefined });
        const t = await r.json();
        const typ = (t?.acquiring_order?.type || t?.task?.acquiring_order?.type || '').toString().toUpperCase();
        if (typ) setPayMethod(typ === 'QR' ? 'СБП' : typ === 'CARD' ? 'Карта' : typ);
        const rwPre = t?.ofd_url || t?.acquiring_order?.ofd_url || null;
        const rwFull = t?.ofd_full_url || t?.acquiring_order?.ofd_full_url || null;
        const rwCom = t?.additional_commission_ofd_url || t?.task?.additional_commission_ofd_url || t?.additional_commission_url || t?.task?.additional_commission_url || null;
        const rwNpd = t?.receipt_uri || t?.task?.receipt_uri || null;
        setReceipts((prev) => ({
          prepay: prev.prepay ?? (rwPre ?? null),
          full: prev.full ?? (rwFull ?? null),
          commission: prev.commission ?? (rwCom ?? null),
          npd: prev.npd ?? (rwNpd ?? null),
        }));
      } catch {}
      pollRef.current = window.setTimeout(tick, 1200) as unknown as number;
    };
    // Первый тик — сразу, без задержки
    void tick();
  };

  const canShowDetails = useMemo(() => Boolean(taskId && info?.userId), [taskId, info?.userId]);

  useEffect(() => {
    if (detailsOpen && taskId && info?.userId) {
      // Дополнительно триггерим серверный sync по orderId, чтобы ускорить появление ссылки
      (async () => { try { if (orderId != null) await fetch(`/api/ofd/sync?order=${orderId}`, { cache: 'no-store' }); } catch {} })();
      startPoll(taskId, info.userId);
    }
    return () => { if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; } };
  }, [detailsOpen, taskId, info?.userId]);

  // Fetch payment method once as soon as taskId известен, чтобы не ждать первого тика
  useEffect(() => {
    (async () => {
      try {
        if (!taskId || !info?.userId) return;
        const r = await fetch(`/api/rocketwork/task-status/${encodeURIComponent(String(taskId))}`, { cache: 'no-store', headers: { 'x-user-id': info.userId } as any });
        const t = await r.json();
        const typ = (t?.acquiring_order?.type || t?.task?.acquiring_order?.type || '').toString().toUpperCase();
        if (typ) setPayMethod(typ === 'QR' ? 'СБП' : typ === 'CARD' ? 'Карта' : typ);
      } catch {}
    })();
  }, [taskId, info?.userId]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Платёж успешно выполнен</h1>
      <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">Спасибо! Мы сформируем чек(и) автоматически и отправим на почту.</div>

      {waiting ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm mb-4">Ищем информацию о платеже{dots}</div>
      ) : null}

      {msg && !waiting ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm mb-3">{msg}</div>
      ) : null}

      <div className="mt-4 space-y-3">
        <button
          className={`inline-flex items-center justify-center rounded-lg ${canShowDetails ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'} px-4 h-9 text-sm`}
          onClick={() => setDetailsOpen((v) => !v)}
          disabled={!canShowDetails}
        >Показать чеки и детали платежа</button>
        {detailsOpen ? (
          <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-sm">
            <div className="grid grid-cols-[9rem_1fr] gap-y-2 mb-2 text-gray-800 dark:text-gray-200">
              <div className="text-gray-500 dark:text-gray-400">За что платим</div>
              <div>{summary?.description || info?.title || '—'}</div>
              <div className="text-gray-500 dark:text-gray-400">Сумма</div>
              <div>{typeof summary?.amountRub === 'number' ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(summary!.amountRub!) : '—'}</div>
              <div className="text-gray-500 dark:text-gray-400">Способ оплаты</div>
              <div>{payMethod || '—'}</div>
              <div className="text-gray-500 dark:text-gray-400">Дата оплаты</div>
              <div>{summary?.createdAt ? new Date(summary.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'}</div>
              <div className="text-gray-500 dark:text-gray-400">Чек на покупку</div>
              <div>
                {(receipts.full || receipts.prepay) ? (
                  <a className="text-black dark:text-white font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
                ) : (
                  <span className="text-gray-600 dark:text-gray-300">Подтягиваем данные{dots}</span>
                )}
              </div>
            </div>
            {isAgent ? (
              <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-gray-800 dark:text-gray-200">
                <div className="text-gray-500 dark:text-gray-400">Чек на комиссию</div>
                {receipts.commission ? (
                  <a className="text-black dark:text-white font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
                ) : (
                  <span className="text-gray-600 dark:text-gray-300">Подтягиваем данные{dots}</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}


