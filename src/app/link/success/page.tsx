"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { postJsonWithGetFallback } from "@/lib/postFallback";

type LinkInfo = { code: string; userId: string; title?: string; orgName?: string | null };

export default function PublicSuccessUnifiedPage() {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receipts, setReceipts] = useState<{ prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null }>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null; createdAt?: string | null; items?: Array<{ title: string; qty: number }> | null } | null>(null);
  const [payMethod, setPayMethod] = useState<string | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const pollRef = useRef<number | null>(null);
  const [dots, setDots] = useState(".");
  const metaSentRef = useRef(false);

  function parseSidHint(sid: string | null): { userId: string | null; orderId: number | null } {
    const t = String(sid || '').trim();
    if (!t) return { userId: null, orderId: null };
    // Format: v1.<base64url(json)>.sig
    if (!t.startsWith('v1.')) return { userId: null, orderId: null };
    const parts = t.split('.');
    if (parts.length !== 3) return { userId: null, orderId: null };
    const body = parts[1] || '';
    if (!body) return { userId: null, orderId: null };
    try {
      // base64url -> base64
      const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
      const json = decodeURIComponent(
        Array.prototype.map
          .call(atob(b64 + pad), (c: string) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      );
      const obj = JSON.parse(json);
      const uid = obj?.uid ? String(obj.uid) : null;
      const oid = Number(obj?.oid);
      return { userId: uid && uid.trim() ? uid.trim() : null, orderId: Number.isFinite(oid) ? oid : null };
    } catch {
      return { userId: null, orderId: null };
    }
  }

  async function fetchSaleByOrder(userId: string, oid: number): Promise<any | null> {
    try {
      const res = await fetch(`/api/sales/by-order/${encodeURIComponent(String(oid))}`, {
        cache: 'no-store',
        headers: { 'x-user-id': userId } as any,
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.sale || null;
    } catch {
      return null;
    }
  }

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
      // If localStorage is unavailable (Safari/Telegram) still try to derive hints from sid
      const sidHint = parseSidHint(sid);
      if (sidHint.userId && !info?.userId) {
        setInfo((prev) => ({ code: prev?.code || '', userId: sidHint.userId!, title: prev?.title, orgName: prev?.orgName || null }));
      }
      if (sidHint.orderId != null && orderId == null) {
        setOrderId(sidHint.orderId);
      } else if (orderParam && orderId == null) {
        const n = Number(orderParam);
        if (Number.isFinite(n)) setOrderId(n);
      }

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
              if (r.ok && (d?.userId || d?.orderId || d?.taskId)) {
                const uid = String(d.userId || sidHint.userId || '').trim();
                const oid = Number(d.orderId || sidHint.orderId || 0) || null;
                if (uid) setInfo({ code: '', userId: uid, title: undefined, orgName: d?.orgName || null });
                if (oid != null) setOrderId(oid);
                if (d?.taskId) setTaskId(d.taskId);
                if (d?.sale) {
                  const items = Array.isArray(d.sale.itemsSnapshot) ? (d.sale.itemsSnapshot as any[]).map((i) => ({ title: String(i?.title || ''), qty: Number(i?.qty || 1) })) : null;
                  setSummary({ amountRub: d.sale.amountRub, description: d.sale.description, createdAt: d.sale.createdAt ?? null, items });
                  if (typeof d.sale.isAgent === 'boolean') setIsAgent(Boolean(d.sale.isAgent));
                  setReceipts({
                    prepay: d.sale.ofdUrl || null,
                    full: d.sale.ofdFullUrl || null,
                    commission: d.sale.commissionUrl || null,
                    npd: d.sale.npdReceiptUri || null,
                  });
                }

                // Even if taskId is missing, we can still poll by orderId using uid (sid contains uid+oid).
                if (!d?.taskId && uid && oid != null) {
                  setMsg('Оплата найдена. Подтягиваем детали и чек…');
                  const sl = await fetchSaleByOrder(uid, oid);
                  if (sl) {
                    if (sl.taskId != null) setTaskId(sl.taskId);
                    if (typeof sl?.isAgent === 'boolean') setIsAgent(Boolean(sl.isAgent));
                    try {
                      const items = Array.isArray(sl?.itemsSnapshot) ? (sl.itemsSnapshot as any[]).map((i: any) => ({ title: String(i?.title || ''), qty: Number(i?.qty || 1) })) : null;
                      if (items && items.length > 0) setSummary((prev) => ({ ...(prev || {}), items, description: (prev?.description ?? sl?.description) || null, amountRub: (prev?.amountRub ?? sl?.amountGrossRub) as any, createdAt: (prev?.createdAt ?? sl?.createdAtRw ?? sl?.createdAt) || null }));
                    } catch {}
                    setReceipts((prev) => ({
                      prepay: (sl?.ofdUrl ?? prev.prepay) || null,
                      full: (sl?.ofdFullUrl ?? prev.full) || null,
                      commission: (sl?.additionalCommissionOfdUrl ?? prev.commission) || null,
                      npd: (sl?.npdReceiptUri ?? prev.npd) || null,
                    }));
                    setMsg(null);
                  }
                } else {
                  setMsg(null);
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
                // Learn taskId from sale record if we didn't have it yet
                try { if (!taskId && sl?.taskId != null) setTaskId(sl.taskId); } catch {}
                if (typeof sl?.isAgent === 'boolean') setIsAgent(Boolean(sl.isAgent));
                try {
                  const items = Array.isArray(sl?.itemsSnapshot) ? (sl.itemsSnapshot as any[]).map((i:any)=> ({ title: String(i?.title||''), qty: Number(i?.qty||1) })) : null;
                  if (items && items.length > 0) setSummary((prev)=> ({ ...(prev||{}), items }));
                } catch {}
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
                try {
                  const items = Array.isArray(sl?.itemsSnapshot) ? (sl.itemsSnapshot as any[]).map((i:any)=> ({ title: String(i?.title||''), qty: Number(i?.qty||1) })) : null;
                  if (items && items.length > 0) setSummary((prev)=> ({ ...(prev||{}), items }));
                } catch {}
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
        // Only if taskId is known (orderId-only mode can still show receipts from local store)
        if (uid != null && String(uid).trim().length > 0) {
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
        }
      } catch {}
      pollRef.current = window.setTimeout(tick, 1200) as unknown as number;
    };
    // Первый тик — сразу, без задержки
    void tick();
  };

  const canShowDetails = useMemo(() => Boolean(info?.userId && (taskId || orderId != null)), [taskId, orderId, info?.userId]);

  useEffect(() => {
    if (detailsOpen && info?.userId && (taskId || orderId != null)) {
      // Дополнительно триггерим серверный sync по orderId, чтобы ускорить появление ссылки
      (async () => {
        try {
          if (orderId != null) {
            await fetch(`/api/ofd/sync?order=${orderId}`, { cache: 'no-store', headers: { 'x-user-id': info.userId } as any });
          }
        } catch {}
      })();
      startPoll((taskId ?? '') as any, info.userId);
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

  // Post-factum: try to attach Telegram user id from cookie if available
  useEffect(() => {
    if (!taskId || !info?.userId || metaSentRef.current) return;
    try {
      const ck = document.cookie.split('; ').find((c)=>c.startsWith('tg_uid='));
      const uid = ck ? decodeURIComponent(ck.split('=')[1]) : '';
      if (uid) {
        metaSentRef.current = true;
        void postJsonWithGetFallback('/api/sales/meta', { taskId, payerTgId: uid }, {
          timeoutPostMs: 800,
          timeoutGetMs: 3_000,
          postInit: { cache: 'no-store', headers: { 'x-user-id': info.userId as any } as any },
          fallbackStatuses: [500, 502, 504],
        }).then((r) => r.text().catch(() => void 0)).catch(() => void 0);
      }
    } catch {}
  }, [taskId, info?.userId]);

  return (
    <div className="max-w-xl mx-auto pt-0 pb-6">
      <h1 className="text-xl font-semibold mb-2">Платёж успешно выполнен</h1>
      <div className="text-sm text-gray-700 dark:text-gray-300 mb-3">Спасибо! Мы сформируем чек(и) автоматически и отправим на почту.</div>

      {waiting ? (
        <div className="rounded-lg p-3 text-sm mb-4 bg-gray-50 border border-gray-200 text-gray-700 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-200">Ищем информацию о платеже{dots}</div>
      ) : null}

      {msg && !waiting ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm mb-3">{msg}</div>
      ) : null}

      <div className="mt-4 space-y-3">
        <button
          className={`inline-flex items-center justify-center rounded-lg px-4 h-9 text-sm ${canShowDetails ? 'bg-white text-black border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-950' : 'bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-800'}`}
          onClick={() => setDetailsOpen((v) => !v)}
          disabled={!canShowDetails}
        >Показать чеки и детали платежа</button>
        {detailsOpen ? (
          <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-sm shadow-sm">
            <div className="grid grid-cols-[9rem_1fr] gap-y-2 mb-2 text-gray-900 dark:text-gray-100">
              <div className="text-gray-600 dark:text-gray-400">За что платим</div>
              <div>
                {(() => {
                  const items = Array.isArray(summary?.items) ? summary!.items! : null;
                  if (items && items.length > 0) {
                    return (
                      <div className="space-y-1">
                        {items.map((it, i) => (
                          <div
                            key={i}
                            className="relative before:content-['•'] before:absolute before:-left-5"
                          >
                            {it.title} — {Number(it.qty||0)} шт.
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (summary?.description || info?.title || '—');
                })()}
              </div>
              <div className="text-gray-600 dark:text-gray-400">Сумма</div>
              <div>{typeof summary?.amountRub === 'number' ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(summary!.amountRub!) : '—'}</div>
              <div className="text-gray-600 dark:text-gray-400">Способ оплаты</div>
              <div>{payMethod || '—'}</div>
              <div className="text-gray-600 dark:text-gray-400">Дата оплаты</div>
              <div>{summary?.createdAt ? new Date(summary.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'}</div>
              <div className="text-gray-600 dark:text-gray-400">Чек на покупку</div>
              <div>
                {(receipts.full || receipts.prepay) ? (
                  <a className="text-black dark:text-white font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">Подтягиваем данные{dots}</span>
                )}
              </div>
            </div>
            {isAgent ? (
              <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-gray-900 dark:text-gray-100">
                <div className="text-gray-600 dark:text-gray-400">Чек на комиссию</div>
                {receipts.commission ? (
                  <a className="text-black dark:text-white font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">Подтягиваем данные{dots}</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}


