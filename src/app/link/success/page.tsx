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
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null } | null>(null);
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
        // Если на клиенте ничего нет — пробуем резолвить sid на сервере и показать лоадер
        if (sid) {
          setWaiting(true);
          (async () => {
            try {
              const r = await fetch(`/api/pay-resume?sid=${encodeURIComponent(sid)}`, { cache: 'no-store' });
              const d = await r.json();
              if (r.ok && d?.taskId) {
                setTaskId(d.taskId);
                setInfo({ code: '', userId: String(d.userId || ''), title: undefined, orgName: d?.orgName || null });
                setOrderId(Number(d.orderId || 0) || null);
                if (d?.sale) setSummary({ amountRub: d.sale.amountRub, description: d.sale.description });
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
        const r = await fetch(`/api/rocketwork/tasks/${encodeURIComponent(String(uid))}?t=${Date.now()}`, { cache: 'no-store', headers: userId ? { 'x-user-id': userId } as any : undefined });
        const t = await r.json();
        const rwPre = t?.ofd_url || t?.acquiring_order?.ofd_url || null;
        const rwFull = t?.ofd_full_url || t?.acquiring_order?.ofd_full_url || null;
        const rwCom = t?.additional_commission_ofd_url || t?.task?.additional_commission_ofd_url || t?.additional_commission_url || t?.task?.additional_commission_url || null;
        const rwNpd = t?.receipt_uri || t?.task?.receipt_uri || null;
        setReceipts({ prepay: rwPre ?? null, full: rwFull ?? null, commission: rwCom ?? null, npd: rwNpd ?? null });

        // Try local sale store as authoritative source for URLs
        try {
          if (userId) {
            if (orderId != null) {
              const sres = await fetch(`/api/sales/by-order/${orderId}`, { cache: 'no-store', headers: { 'x-user-id': userId } as any });
              if (sres.ok) {
                const sj = await sres.json();
                const sl = sj?.sale;
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
      } catch {}
      pollRef.current = window.setTimeout(tick, 2000) as unknown as number;
    };
    pollRef.current = window.setTimeout(tick, 1000) as unknown as number;
  };

  const canShowDetails = useMemo(() => Boolean(taskId && info?.userId), [taskId, info?.userId]);

  useEffect(() => {
    if (detailsOpen && taskId && info?.userId) startPoll(taskId, info.userId);
    return () => { if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; } };
  }, [detailsOpen, taskId, info?.userId]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Платёж успешно выполнен</h1>
      <div className="text-sm text-gray-600 mb-2">Спасибо! Мы сформируем чек(и) автоматически и отправим на почту.</div>
      {summary ? (
        <div className="text-sm text-gray-800 mb-3">{summary.description ? `${summary.description} — ` : ''}{typeof summary.amountRub === 'number' ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(summary.amountRub) : ''}</div>
      ) : null}

      {waiting ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm mb-4">Ищем информацию о платеже{dots}</div>
      ) : null}

      {msg && !waiting ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm mb-3">{msg}</div>
      ) : null}

      <div className="space-y-3">
        <button
          className={`inline-flex items-center justify-center rounded-lg ${canShowDetails ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'} px-4 h-9 text-sm`}
          onClick={() => setDetailsOpen((v) => !v)}
          disabled={!canShowDetails}
        >Показать чеки и детали платежа</button>
        {detailsOpen ? (
          <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {!receipts.prepay && !receipts.full && !receipts.commission && !receipts.npd ? (
              <div className="text-gray-600">Подтягиваем данные{dots}</div>
            ) : (
              <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                {(receipts.full || receipts.prepay) ? (<>
                  <div className="text-gray-500">Чек на покупку</div>
                  <a className="text-black font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
                </>) : null}
                {receipts.commission ? (<>
                  <div className="text-gray-500">Чек на комиссию</div>
                  <a className="text-black font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
                </>) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}


