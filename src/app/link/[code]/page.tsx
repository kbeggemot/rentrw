"use client";

import { use, useEffect, useMemo, useRef, useState } from 'react';

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

export default function PublicPayPage(props: { params: Promise<{ code?: string }> }) {
  // In Next 15, route params in Client Components are a Promise. Unwrap with React.use()
  const unwrapped = use(props.params) || {} as { code?: string };
  const raw = typeof unwrapped.code === 'string' ? unwrapped.code : '';
  // Accept /link/[code] and /link/s/[code]
  const code = raw;
  const [data, setData] = useState<LinkData | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'qr' | 'card'>('qr');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [payLocked, setPayLocked] = useState(false);

  // Flow state
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [awaitingPay, setAwaitingPay] = useState(false);
  const [receipts, setReceipts] = useState<{ prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null }>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null; createdAt?: string | null } | null>(null);

  const pollRef = useRef<number | null>(null);
  const payUrlPollRef = useRef<number | null>(null);

  // Animated dots for pending states
  const [dots, setDots] = useState('.');
  useEffect(() => {
    let timer: number | null = null;
    const waitingForLink = Boolean(taskId) && !payUrl;
    // Keep animating if any receipt is still missing (e.g., commission not yet available)
    const someReceiptMissing = (!(receipts.prepay || receipts.full)) || (Boolean(data?.isAgent) && !receipts.commission);
    const waitingForConfirm = awaitingPay;
    const active = loading || waitingForLink || waitingForConfirm || someReceiptMissing;
    if (active) {
      timer = window.setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
      }, 400) as unknown as number;
    } else {
      setDots('.');
    }
    return () => { if (timer) window.clearInterval(timer); };
  }, [loading, taskId, payUrl, awaitingPay, receipts.prepay, receipts.full, receipts.commission, receipts.npd, data?.isAgent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve sale page by code first; fallback to payment link by code
      try {
        const r1 = await fetch(`/api/sale-page/${encodeURIComponent(code)}`, { cache: 'no-store' });
        if (r1.ok) {
          const d = await r1.json();
          const userId: string | undefined = d?.userId;
          const sale = d?.sale;
          if (userId) {
            setData((prev) => (prev || { code, userId, title: '', description: '' } as any));
            // Проверяем наличие активного токена организации для оплаты
            try {
              const orgRes = await fetch(`/api/organizations/status?uid=${encodeURIComponent(userId)}${d?.orgInn ? `&org=${encodeURIComponent(String(d.orgInn))}` : ''}`, { cache: 'no-store' });
              const orgD = await orgRes.json().catch(() => ({}));
              if (!orgRes.ok || orgD?.hasToken !== true) {
                setPayLocked(true);
                setMsg('Оплата временно недоступна. Пожалуйста, уточните детали у продавца.');
              }
            } catch {}
          }
          if (sale) {
            setTaskId(sale.taskId);
            setSummaryFromSale(sale);
            // Open details automatically for sale pages to show success-like panel
            setDetailsOpen(true);
          }
        } else {
          throw new Error('not_sale_page');
        }
      } catch {
        try {
          const res = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'force-cache' });
          const d = await res.json();
          if (!res.ok) throw new Error(d?.error || 'NOT_FOUND');
          if (cancelled) return;
          setData(d);
          // Проверяем наличие токена и для режима оплаты по ссылке, если есть владелец
          try {
            if (d?.userId) {
              const orgRes = await fetch(`/api/organizations/status?uid=${encodeURIComponent(String(d.userId))}${d?.orgInn ? `&org=${encodeURIComponent(String(d.orgInn))}` : ''}`, { cache: 'no-store' });
              const orgD = await orgRes.json().catch(() => ({}));
              if (!orgRes.ok || orgD?.hasToken !== true) {
                setPayLocked(true);
                setMsg('Оплата временно недоступна. Пожалуйста, уточните детали у продавца.');
              }
            }
          } catch {}
          if (d?.sumMode === 'fixed' && typeof d?.amountRub === 'number') setAmount(String(d.amountRub));
          if (d?.method === 'card') setMethod('card'); else setMethod('qr');
        } catch (e) { if (!cancelled) setMsg('Ссылка не найдена'); }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  function setSummaryFromSale(sale: any) {
    try {
      setSummary({ amountRub: sale.amountRub, description: sale.description, createdAt: sale.createdAt });
      setReceipts({ prepay: sale.ofdUrl || null, full: sale.ofdFullUrl || null, commission: sale.commissionUrl || null, npd: sale.npdReceiptUri || null });
      if (typeof sale?.isAgent === 'boolean') setData((prev) => (prev ? { ...prev, isAgent: Boolean(sale.isAgent) } as any : prev));
    } catch {}
  }

  // If returned from bank (?paid=1), try to restore last taskId from localStorage and resume polling
  useEffect(() => {
    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);
      if (params.get('paid') === '1' && !taskId) {
        const raw = localStorage.getItem(`lastPay:${code}`);
        const sidExpected = params.get('sid');
        if (raw) {
          const obj = JSON.parse(raw);
          const ttlOk = obj?.ts && (Date.now() - Number(obj.ts) < 1800000);
          const sidOk = !sidExpected || (obj?.sid && obj.sid === sidExpected);
          if (ttlOk && sidOk && obj && obj.taskId) {
            setTaskId(obj.taskId);
            setAwaitingPay(true);
            startPoll(obj.taskId);
            startPayUrlPoll(obj.taskId);
            try { localStorage.removeItem(`lastPay:${code}`); } catch {}
          }
        }
        try { const url = new URL(window.location.href); url.searchParams.delete('paid'); url.searchParams.delete('sid'); window.history.replaceState({}, '', url.toString()); } catch {}
      }
    } catch {}
    // run only once after initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // helpers
  const mskToday = () => new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
  const isValidEmail = (s: string) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s.trim());

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
        const r = await fetch(`/api/rocketwork/tasks/${encodeURIComponent(String(uid))}?t=${Date.now()}`, { cache: 'no-store', headers: data?.userId ? { 'x-user-id': data.userId } as any : undefined });
        const t = await r.json();
        const aoStatus = String((t?.acquiring_order?.status || t?.task?.acquiring_order?.status || '')).toLowerCase();
        if (aoStatus) setIsFinal(['paid', 'transfered', 'transferred'].includes(aoStatus));
        // Try to read receipts directly from RW if available (rare when with_ofd_receipt=false)
        const rwPre = t?.ofd_url || t?.acquiring_order?.ofd_url || null;
        const rwFull = t?.ofd_full_url || t?.acquiring_order?.ofd_full_url || null;
        const rwCom = t?.additional_commission_ofd_url || t?.task?.additional_commission_ofd_url || t?.additional_commission_url || t?.task?.additional_commission_url || null;
        const rwNpd = t?.receipt_uri || t?.task?.receipt_uri || null;
        // Prefer local sale store where callbacks and Ferma polling land
        let salePre: string | null | undefined;
        let saleFull: string | null | undefined;
        let saleCom: string | null | undefined;
        let saleNpd: string | null | undefined;
        try {
          const sres = await fetch(`/api/sales/by-task/${encodeURIComponent(String(uid))}`, { cache: 'no-store', headers: data?.userId ? { 'x-user-id': data.userId } as any : undefined });
          if (sres.ok) {
            const sj = await sres.json();
            const sl = sj?.sale;
            salePre = sl?.ofdUrl ?? null;
            saleFull = sl?.ofdFullUrl ?? null;
            saleCom = sl?.additionalCommissionOfdUrl ?? null;
            saleNpd = sl?.npdReceiptUri ?? null;
          }
        } catch {}
        const pre = (salePre ?? rwPre ?? null) as string | null;
        const full = (saleFull ?? rwFull ?? null) as string | null;
        const com = (saleCom ?? rwCom ?? null) as string | null;
        const npd = (saleNpd ?? rwNpd ?? null) as string | null;
        setReceipts({ prepay: pre, full, commission: com, npd });
        if (['paid', 'transfered', 'transferred'].includes(aoStatus)) {
          // Stop when we have purchase and, if agent sale, commission (or when any receipt exists and it's not agent)
          const purchaseReady = Boolean(pre || full);
          const commissionReady = data?.isAgent ? Boolean(com) : true;
          if ((purchaseReady && commissionReady) || npd) {
            if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
            setAwaitingPay(false);
            return;
          }
        }
      } catch {}
      pollRef.current = window.setTimeout(tick, 2000) as unknown as number;
    };
    pollRef.current = window.setTimeout(tick, 1000) as unknown as number;
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
      setStarted(true);
      setLoading(true);
      setMsg(null);
      setPayUrl(null);
      setTaskId(null);
      setDetailsOpen(true);
      
      // Validate partner in RW for agent sales before creating task
      if (data.isAgent && data.partnerPhone) {
        try {
          const digits = String(data.partnerPhone).replace(/\D/g, '');
          const res = await fetch('/api/partners/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId },
            body: JSON.stringify({ phone: digits })
          });
          
          if (!res.ok) {
            const errorData = await res.json();
            const code = errorData?.error;
            
            // Always update partner with current data from RW, even on error
            if (errorData?.partnerData) {
              try {
                await fetch('/api/partners', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId },
                  body: JSON.stringify(errorData.partnerData)
                });
              } catch (e) {
                // Silent fail - partner update is not critical for payment flow
              }
            }
            
            if (code === 'PARTNER_NOT_REGISTERED') setMsg('Партнёр не завершил регистрацию в Рокет Ворк');
            else if (code === 'PARTNER_NOT_VALIDATED') setMsg('Партнёр не может принять оплату: нет статуса самозанятого');
            else if (code === 'PARTNER_NO_PAYMENT_INFO') setMsg('Партнёр не указал платёжные реквизиты в Рокет Ворк');
            else setMsg('Ошибка проверки партнёра');
            setLoading(false);
            setStarted(false);
            setDetailsOpen(false);
            return;
          }
          
          const executorData = await res.json();
          
          // Auto-add/update partner if validation successful
          try {
            const fio = executorData?.executor ? [
              executorData.executor.last_name,
              executorData.executor.first_name, 
              executorData.executor.second_name
            ].filter(Boolean).join(' ').trim() : null;
            
            const partner = {
              phone: digits,
              fio: fio || null,
              status: executorData.status || null,
              inn: executorData.inn || null,
              updatedAt: new Date().toISOString(),
              hidden: false
            };
            
            await fetch('/api/partners', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId },
              body: JSON.stringify(partner)
            });
          } catch (e) {
            // Silent fail - partner update is not critical for payment flow
          }
        } catch (e) {
          setMsg('Ошибка проверки партнёра');
          setLoading(false);
          setStarted(false);
          setDetailsOpen(false);
          return;
        }
      }
      
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
      try {
        if (tId && typeof window !== 'undefined') {
          const sidKey = `paySid:${code}`;
          let sid: string | null = sessionStorage.getItem(sidKey);
          if (!sid) {
            sid = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem(sidKey, String(sid));
          }
          localStorage.setItem(`lastPay:${code}`, JSON.stringify({ taskId: tId, ts: Date.now(), sid: String(sid) }));
        }
      } catch {}
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

  const canStart = canPay && !started && !loading && !payLocked;
  const actionBtnClasses = `inline-flex items-center justify-center rounded-lg ${canStart ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'} px-4 h-9 text-sm`;

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">{data.title}</h1>
      <div className="text-sm text-gray-600 mb-4">Оплата в пользу {data.orgName || 'Организация'}</div>
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        {payLocked ? (
          <div className="text-sm text-gray-700">Оплата временно недоступна. Пожалуйста, уточните детали у продавца.</div>
        ) : (
        <>
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
          <label className="block text-sm text-gray-600 mb-1">Ваш email</label>
          <input className="w-full sm:w-80 rounded-lg border px-2 h-9 text-sm" type="email" inputMode="email" pattern="^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <div className="text-xs text-gray-500 mt-1">Отправим чек на эту почту</div>
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
        <button disabled={!canStart} onClick={goPay} className={actionBtnClasses}>
          Перейти к оплате
        </button>

        {/* Inline expandable panel (Sales-like) */}
        {detailsOpen ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {!taskId ? (
              started ? (
                <div className="text-gray-600">{`Формируем платежную ссылку${dots}`}</div>
              ) : (
                <div className="text-gray-600">Нажмите «Перейти к оплате», чтобы сформировать ссылку…</div>
              )
            ) : (
              <div className="space-y-2">
                {!payUrl ? (
                  <div className="text-gray-600">{`Формируем платежную ссылку${dots}`}</div>
                ) : (
                  !isFinal ? (
                    <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                      <div className="text-gray-500">Платежная ссылка</div>
                      <a className={`${awaitingPay ? 'text-gray-500' : 'text-black font-semibold'} hover:underline`} href={payUrl} target="_blank" rel="noreferrer" onClick={() => setAwaitingPay(true)}>Оплатить</a>
                    </div>
                  ) : null
                )}
                {awaitingPay && !isFinal ? (
                  <div className="text-gray-600">{`Ждём подтверждения оплаты${dots}`}</div>
                ) : null}
                {isFinal ? (
                  <div className="mt-1 p-2">
                    <div className="text-green-700 font-medium mb-2">Успешно оплачено</div>
                    <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                      {/* Покупка: всегда показываем строку, пока нет ссылки — «Подгружаем…» */}
                      <>
                        <div className="text-gray-500">Чек на покупку</div>
                        {receipts.full || receipts.prepay ? (
                          <a className="text-black font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
                        ) : (
                          <div className="text-gray-600">Подгружаем{dots}</div>
                        )}
                      </>
                      {/* Комиссия: показываем строку для агентских продаж сразу, даже если ещё нет ссылки */}
                      {data?.isAgent ? (
                        <>
                          <div className="text-gray-500">Чек на комиссию</div>
                          {receipts.commission ? (
                            <a className="text-black font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
                          ) : (
                            <div className="text-gray-600">Подгружаем{dots}</div>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        </>
        )}

        {!payLocked && msg ? <div className="mt-3 text-sm text-gray-600">{msg}</div> : null}
      </div>
    </div>
  );
}


