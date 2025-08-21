'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

type PaymentMethod = 'qr' | 'card';

import { Suspense } from 'react';

function AcceptPaymentContent() {
  const search = useSearchParams();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  useEffect(() => {
    let aborted = false;
    const check = async () => {
      try {
        const res = await fetch('/api/settings/token', { cache: 'no-store' });
        const data = await res.json();
        if (!aborted) setHasToken(!!data?.token);
      } catch {
        if (!aborted) setHasToken(false);
      }
    };
    check();
    return () => { aborted = true; };
  }, []);

  useEffect(() => {
    const wantAgent = search.get('agent') === '1';
    const qp = search.get('phone') || '';
    if (wantAgent) setIsAgentSale(true);
    if (qp) setAgentPhone(qp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [commission, setCommission] = useState('');
  const [isAgentSale, setIsAgentSale] = useState(false);
  const [agentPhone, setAgentPhone] = useState('');
  const [commissionType, setCommissionType] = useState<'percent' | 'fixed'>('percent');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [serviceEndDate, setServiceEndDate] = useState<string>(() => {
    const msk = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
    return msk;
  });
  const [vatRate, setVatRate] = useState<string>('none');
  const [method, setMethod] = useState<PaymentMethod>('qr');
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<'info' | 'error' | 'success'>('info');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [agentDesc, setAgentDesc] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lastTaskId, setLastTaskId] = useState<string | number | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ofdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef<boolean>(false);
  const paymentUrlRef = useRef<string | null>(null);
  const attemptIdRef = useRef<number>(0);
  const activeTaskIdRef = useRef<string | number | null>(null);
  const ofdStartedForTaskIdRef = useRef<string | number | null>(null);
  const updateDebug = () => {
    try {
      if (typeof window !== 'undefined') {
        (window as any).__activeTaskId = activeTaskIdRef.current ?? null;
        (window as any).__lastTaskId = lastTaskId ?? null;
        (window as any).__attemptId = attemptIdRef.current ?? null;
        (window as any).__aoStatus = aoStatus ?? null;
        (window as any).__paymentUrl = paymentUrlRef.current ?? null;
      }
    } catch {}
  };

  const [aoStatus, setAoStatus] = useState<string | null>(null);
  const [purchaseReceiptUrl, setPurchaseReceiptUrl] = useState<string | null>(null);
  const [commissionReceiptUrl, setCommissionReceiptUrl] = useState<string | null>(null);
  const [taskIsAgent, setTaskIsAgent] = useState<boolean | null>(null);
  // Animated dots for waiting under QR
  const [dots, setDots] = useState('.');
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };
  // Executor pre-check UI
  const [checkingExecutor, setCheckingExecutor] = useState(false);
  const [btnDots, setBtnDots] = useState('.');
  useEffect(() => {
    let t: number | null = null;
    if (checkingExecutor) {
      t = window.setInterval(() => {
        setBtnDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
      }, 400) as unknown as number;
    } else {
      setBtnDots('.');
    }
    return () => { if (t) window.clearInterval(t); };
  }, [checkingExecutor]);

  const validateMinNet = () => {
    const MIN_AMOUNT = 10;
    const numAmount = Number(amount.replace(',', '.'));
    if (!Number.isFinite(numAmount)) return;
    if (isAgentSale) {
      const numComm = Number(commission.replace(',', '.'));
      if (!Number.isFinite(numComm)) return; // нет комиссии — пока не валидируем
      const retained = commissionType === 'percent' ? (numAmount * (numComm / 100)) : numComm;
      const net = numAmount - retained;
      if (net < MIN_AMOUNT) {
        showToast('Сумма оплаты за вычетом комиссии должна быть не менее 10 рублей', 'error');
      }
    } else {
      if (numAmount < MIN_AMOUNT) {
        showToast('Сумма должна быть не менее 10 рублей', 'error');
      }
    }
  };

  useEffect(() => {
    const ref = pollAbortRef.current;
    return () => {
      ref.aborted = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (ofdTimerRef.current) clearTimeout(ofdTimerRef.current);
    };
  }, []);

  // Prefill agent defaults from settings
  useEffect(() => {
    let aborted = false;
    const loadDefaults = async () => {
      try {
        const r = await fetch('/api/settings/agent', { cache: 'no-store' });
        const d = await r.json();
        if (aborted) return;
        if (d?.defaultCommission?.type) setCommissionType(d.defaultCommission.type);
        if (typeof d?.defaultCommission?.value === 'number') setCommission(String(d.defaultCommission.value));
        if (typeof d?.agentDescription === 'string') setAgentDesc(d.agentDescription);
      } catch {}
    };
    loadDefaults();
    return () => { aborted = true; };
  }, []);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    paymentUrlRef.current = paymentUrl;
    updateDebug();
  }, [paymentUrl]);

  // Run animated dots while QR is visible and payment not yet confirmed
  useEffect(() => {
    const paid = aoStatus && ['paid', 'transfered', 'transferred'].includes(String(aoStatus).toLowerCase());
    const waiting = Boolean(qrDataUrl) && !paid;
    let t: number | null = null;
    if (waiting) {
      t = window.setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
      }, 400) as unknown as number;
    } else {
      setDots('.');
    }
    return () => { if (t) window.clearInterval(t); };
  }, [qrDataUrl, aoStatus]);

  // Глобальная страховка: как только статус финальный или появился любой чек — скрываем QR/ссылку
  useEffect(() => {
    const final = aoStatus && ['paid','transfered','transferred'].includes(String(aoStatus).toLowerCase());
    if (final || purchaseReceiptUrl || commissionReceiptUrl) {
      setPaymentUrl(null);
      setQrDataUrl(null);
      setMessage(null);
      setMessageKind('info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoStatus, purchaseReceiptUrl, commissionReceiptUrl]);

  // Явный старт опроса после получения taskId, чтобы исключить конфликты эффектов
  const startPolling = (taskId: string | number, attemptId: number) => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    // гарантируем «живой» флаг перед стартом
    pollAbortRef.current.aborted = false;
    setAttempt(0);
    const tick = async (n: number) => {
      if (pollAbortRef.current.aborted) return;
      if (attemptIdRef.current !== attemptId) return;
      if (activeTaskIdRef.current !== taskId) return;
      setAttempt(n);
      try {
        const controller = new AbortController();
        const stRes = await fetch(`/api/rocketwork/tasks/${taskId}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
        const stText = await stRes.text();
        const stData = stText ? JSON.parse(stText) : {};
        const found = (stData?.acquiring_order?.url as string | undefined)
          ?? (stData?.task?.acquiring_order?.url as string | undefined);
        const status = (stData?.acquiring_order?.status as string | undefined)
          ?? (stData?.task?.acquiring_order?.status as string | undefined);
        // guard again after async
        if (attemptIdRef.current !== attemptId || activeTaskIdRef.current !== taskId) return;
        if (status && !paymentUrlRef.current) setMessage('Ожидаем ссылку…');
        const st = String(status || '').toLowerCase();
        if (st === 'paid' || st === 'transfered' || st === 'transferred') {
          setAoStatus(status || 'paid');
          setPaymentUrl(null);
          setQrDataUrl(null);
          setMessage(null);
          setLoading(false);
          return;
        }
        if (stRes.ok && found) {
          if (attemptIdRef.current !== attemptId || activeTaskIdRef.current !== taskId) return;
          if (!paymentUrlRef.current) {
            setPaymentUrl(found);
            try {
              const dataUrl = await QRCode.toDataURL(found, { margin: 1, scale: 6 });
              setQrDataUrl(dataUrl);
            } catch {}
            setMessage(null);
            loadingRef.current = false;
            setLoading(false);
          }
        }
      } catch {}
      // более частые первые опросы, затем плавное увеличение до 2000мс
      const delay = Math.min(1800, 300 + n * 250);
      pollTimerRef.current = setTimeout(() => tick(n + 1), delay);
    };
    tick(1);
  };

  // Watch task status and receipts after task is created
  const startStatusWatcher = (taskId: string | number, attemptId: number, isAgentForTask: boolean) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    const run = async () => {
      if (attemptIdRef.current !== attemptId) return;
      if (activeTaskIdRef.current !== taskId) return;
      try {
        const stRes = await fetch(`/api/rocketwork/tasks/${taskId}?t=${Date.now()}`, { cache: 'no-store' });
        const stText = await stRes.text();
        let stData: any = null; try { stData = stText ? JSON.parse(stText) : null; } catch { stData = stText; }
        const status: string | undefined = (stData?.acquiring_order?.status as string | undefined)
          ?? (stData?.task?.acquiring_order?.status as string | undefined)
          ?? undefined;
        if (attemptIdRef.current !== attemptId || activeTaskIdRef.current !== taskId) return;
        if (status) { setAoStatus(status); updateDebug(); }
        // If RW already returned commission receipt URL, set it immediately
        try {
          const addUrl: string | undefined = (stData?.additional_commission_ofd_url as string | undefined)
            ?? (stData?.task?.additional_commission_ofd_url as string | undefined)
            ?? (stData?.additional_commission_url as string | undefined)
            ?? (stData?.task?.additional_commission_url as string | undefined);
          if (addUrl) setCommissionReceiptUrl(addUrl);
        } catch {}
        // If paid/transferred — hide payment link and QR, then start OFD polling for THIS task
        const st = String(status || '').toLowerCase();
        if (st === 'paid' || st === 'transfered' || st === 'transferred') {
          if (attemptIdRef.current !== attemptId || activeTaskIdRef.current !== taskId) return;
          setPaymentUrl(null);
          // после успеха — полностью убираем QR и заголовок
          setQrDataUrl(null);
          setMessage(null);
          setMessageKind('info');

          // Запустить наблюдение за чеками только один раз для текущей задачи
          if ((st === 'paid' || st === 'transfered' || st === 'transferred') && ofdStartedForTaskIdRef.current !== taskId) {
            ofdStartedForTaskIdRef.current = taskId;
            try {
              const hint = (stData?.__hint as any) || {};
              const target: string | undefined = hint?.ofdTarget;
              const orderId: number | undefined = Number(hint?.orderId || stData?.acquiring_order?.order || stData?.order || NaN);
              if (Number.isFinite(orderId)) {
                if (ofdTimerRef.current) clearTimeout(ofdTimerRef.current);
                const watch = async () => {
                  if (attemptIdRef.current !== attemptId) return;
                  if (activeTaskIdRef.current !== taskId) return;
                  try {
                    const r = await fetch(`/api/sales/by-order/${orderId}?t=${Date.now()}`, { cache: 'no-store' });
                    const d = await r.json();
                    const sale = d?.sale;
                    // если в локальном сторе статус уже финальный — прячем ссылку/QR на всякий случай
                    const stLocal = String(sale?.status || '').toLowerCase();
                    if (stLocal === 'paid' || stLocal === 'transfered' || stLocal === 'transferred') {
                      setAoStatus('paid');
                      setPaymentUrl(null);
                      setQrDataUrl(null);
                      setMessage(null);
                      setMessageKind('info');
                    }
                    const purchaseUrl = sale?.ofdUrl || sale?.ofdFullUrl || null;
                    const commissionUrl = sale?.additionalCommissionOfdUrl || null;
                    if (purchaseUrl) setPurchaseReceiptUrl(purchaseUrl);
                    if (commissionUrl) setCommissionReceiptUrl(commissionUrl);
                    const needCommission = isAgentForTask;
                    const missingPurchase = !purchaseUrl;
                    const missingCommission = needCommission && !commissionUrl;
                    if (missingPurchase || missingCommission) {
                      ofdTimerRef.current = setTimeout(watch, target === 'prepay' ? 2000 : 2500);
                    }
                  } catch {
                    ofdTimerRef.current = setTimeout(watch, 2500);
                  }
                };
                watch();
              }
            } catch {}
          }
        }
        // Regardless of current RW status, if we know orderId and have not started watching yet, start watching local sale store
        try {
          const hint2 = (stData?.__hint as any) || {};
          const orderId2: number | undefined = Number(hint2?.orderId || stData?.acquiring_order?.order || stData?.order || NaN);
          if (ofdStartedForTaskIdRef.current !== taskId && Number.isFinite(orderId2)) {
            ofdStartedForTaskIdRef.current = taskId;
            const target2: string | undefined = hint2?.ofdTarget;
            const watch2 = async () => {
              if (attemptIdRef.current !== attemptId) return;
              if (activeTaskIdRef.current !== taskId) return;
              try {
                const r = await fetch(`/api/sales/by-order/${orderId2}?t=${Date.now()}`, { cache: 'no-store' });
                const d = await r.json();
                const sale = d?.sale;
                const stLocal = String(sale?.status || '').toLowerCase();
                if (stLocal === 'paid' || stLocal === 'transfered' || stLocal === 'transferred') {
                  setAoStatus('paid');
                  setPaymentUrl(null);
                  setQrDataUrl(null);
                  setMessage(null);
                  setMessageKind('info');
                }
                const purchaseUrl = sale?.ofdUrl || sale?.ofdFullUrl || null;
                const commissionUrl = sale?.additionalCommissionOfdUrl || null;
                if (purchaseUrl) setPurchaseReceiptUrl(purchaseUrl);
                if (commissionUrl) setCommissionReceiptUrl(commissionUrl);
                const needCommission = isAgentForTask;
                const missingPurchase = !purchaseUrl;
                const missingCommission = needCommission && !commissionUrl;
                if (missingPurchase || missingCommission || !(stLocal === 'paid' || stLocal === 'transfered' || stLocal === 'transferred')) {
                  ofdTimerRef.current = setTimeout(watch2, target2 === 'prepay' ? 2000 : 2500);
                }
              } catch {
                ofdTimerRef.current = setTimeout(watch2, 2500);
              }
            };
            watch2();
          }
        } catch {}
      } catch {}
      // keep watching until both receipts are present (or not agent)
      const needCommission = isAgentForTask;
      const missingPurchase = !purchaseReceiptUrl;
      const missingCommission = needCommission && !commissionReceiptUrl;
      if (missingPurchase || missingCommission) {
        statusTimerRef.current = setTimeout(run, 2000);
      }
    };
    run();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setMessageKind('info');
    const numAmount = Number(amount.replace(',', '.'));
    const numComm = Number(commission.replace(',', '.'));
    if (!Number.isFinite(numAmount) || numAmount <= 0) { showToast('Введите корректную сумму', 'error'); return; }
    // Business rule: минимальная сумма оплаты – не менее 10 ₽ (для агентских – после вычета комиссии)
    const MIN_AMOUNT = 10;
    if (isAgentSale) {
      if (!agentDesc || agentDesc.trim().length === 0) { showToast('Заполните описание ваших услуг, как Агента, в настройках', 'error'); return; }
      if (commission.trim().length === 0) { showToast('Укажите комиссию агента', 'error'); return; }
      if (commissionType === 'percent') {
        if (!Number.isFinite(numComm) || numComm < 0 || numComm > 100) { showToast('Комиссия должна быть в диапазоне 0–100%', 'error'); return; }
      } else {
        if (!Number.isFinite(numComm) || numComm <= 0) { showToast('Укажите фиксированную комиссию в рублях (> 0)', 'error'); return; }
      }
      if (agentPhone.trim().length === 0) { showToast('Укажите телефон партнёра', 'error'); return; }
      // Validate net amount after commission
      const retained = commissionType === 'percent' ? (numAmount * (numComm / 100)) : numComm;
      const net = numAmount - retained;
      if (!(net >= MIN_AMOUNT)) {
        showToast('Сумма оплаты за вычетом комиссии должна быть не менее 10 рублей', 'error');
        return;
      }
    } else {
      if (!(numAmount >= MIN_AMOUNT)) {
        showToast('Сумма должна быть не менее 10 рублей', 'error');
        return;
      }
    }
    // Агентская продажа: предварительная проверка исполнителя с дизейблом кнопки
    if (isAgentSale) {
      try {
        setCheckingExecutor(true);
        const digits = agentPhone.replace(/\D/g, '');
        
        // Validate partner via our API endpoint
        const res = await fetch('/api/partners/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: digits })
        });
        
        if (!res.ok) {
          const errorData = await res.json();
          const code = errorData?.error;
          if (code === 'PARTNER_NOT_REGISTERED') showToast('Партнёр не завершил регистрацию в Рокет Ворк', 'error');
          else if (code === 'PARTNER_NOT_VALIDATED') showToast('Партнёр не может принять оплату: нет статуса самозанятого', 'error');
          else if (code === 'PARTNER_NO_PAYMENT_INFO') showToast('Партнёр не указал платёжные реквизиты в Рокет Ворк', 'error');
          else showToast('Ошибка проверки партнёра', 'error');
          setCheckingExecutor(false);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partner)
          });
        } catch (e) {
          // Silent fail - partner update is not critical for payment flow
        }
      } finally {
        setCheckingExecutor(false);
      }
    }
    // Отправка на серверный маршрут создания сделки
    try {
      loadingRef.current = true;
      setLoading(true);
      // схлопываем параметры под спойлер, раз локальная валидация прошла
      setCollapsed(true);
      // сбрасываем состояние предыдущей попытки (ссылка, QR, статусы, чеки)
      attemptIdRef.current += 1;
      const myAttempt = attemptIdRef.current;
      // жестко останавливаем все предыдущие тики
      pollAbortRef.current.aborted = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (ofdTimerRef.current) clearTimeout(ofdTimerRef.current);
      ofdStartedForTaskIdRef.current = null;
      activeTaskIdRef.current = null;
      paymentUrlRef.current = null;
      setPaymentUrl(null);
      setQrDataUrl(null);
      setAoStatus(null);
      setPurchaseReceiptUrl(null);
      setCommissionReceiptUrl(null);
      setTaskIsAgent(null);
      setLastTaskId(null);
      setAttempt(0);
      // зафиксируем тип текущей сделки — используем для отображения чеков после успеха
      setTaskIsAgent(isAgentSale);
      const res = await fetch('/api/rocketwork/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountRub: numAmount,
          description,
          commissionPercent: undefined,
          method,
          clientEmail: buyerEmail || null,
          agentSale: isAgentSale || undefined,
          agentPhone: isAgentSale && agentPhone.trim().length > 0 ? agentPhone.trim() : undefined,
          commissionType: isAgentSale ? commissionType : undefined,
          commissionValue: isAgentSale ? numComm : undefined,
          serviceEndDate,
          vatRate,
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || text || 'Ошибка создания сделки');

      const taskId: string | number | undefined = data?.task_id ?? data?.data?.id ?? data?.data?.task?.id;
      if (taskId !== undefined) {
        setLastTaskId(taskId);
        activeTaskIdRef.current = taskId;
        updateDebug();
        // быстрый первичный запрос ссылки
        try {
          const r0 = await fetch(`/api/rocketwork/tasks/${taskId}?t=${Date.now()}`, { cache: 'no-store' });
          const t0 = await r0.text();
          const d0 = t0 ? JSON.parse(t0) : {};
          const url0 = (d0?.acquiring_order?.url as string | undefined) ?? (d0?.task?.acquiring_order?.url as string | undefined);
          if (url0) {
            setPaymentUrl(url0);
            try { const dataUrl = await QRCode.toDataURL(url0, { margin: 1, scale: 6 }); setQrDataUrl(dataUrl); } catch {}
            setMessage(null);
            setLoading(false);
          }
        } catch {}
        startPolling(taskId, myAttempt);
        startStatusWatcher(taskId, myAttempt, isAgentSale);
      } else { setLoading(false); showToast('Не удалось получить идентификатор задачи', 'error'); setCollapsed(false); }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      showToast(msg, 'error');
      setLoading(false);
      setCollapsed(false);
    }
  };

  if (hasToken === false) {
    if (typeof window !== 'undefined') {
      window.location.replace('/dashboard');
    }
    return null;
  }

  // Memoize QR element to avoid re-render flashing when unrelated state updates
  const qrElement = useMemo(() => {
    if (!qrDataUrl) return null;
    return (
      <img src={qrDataUrl} alt="QR code" className="w-48 h-48 border rounded" />
    );
  }, [qrDataUrl]);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Принять оплату</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {collapsed ? (
          <div className="flex items-center justify-between p-3 border rounded bg-white dark:bg-gray-950">
            <div className="text-sm text-gray-700 dark:text-gray-300">Параметры оплаты</div>
            <Button type="button" variant="secondary" onClick={() => setCollapsed(false)}>Показать</Button>
          </div>
        ) : null}
        {!collapsed ? (
          <>
        <Input
          label="Сумма, ₽"
          type="text"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={validateMinNet}
          required
        />
        <Textarea
          label="Описание услуги"
          placeholder="Например: Оплата консультации"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
        />
        <Input
          label="Email покупателя (необязательно)"
          type="email"
          placeholder="user@example.com"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
        />
        <div>
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">НДС</div>
          <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
            <option value="none">Без НДС</option>
            <option value="0">НДС 0%</option>
            <option value="10">НДС 10%</option>
            <option value="20">НДС 20%</option>
          </select>
        </div>
        <Input
          label="Дата окончания оказания услуги"
          type="date"
          value={serviceEndDate}
          onChange={(e) => setServiceEndDate(e.target.value)}
          required
          hint="Например: дата выезда клиента"
        />
        <div>
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Способ оплаты</div>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="paymethod"
                value="qr"
                checked={method === 'qr'}
                onChange={() => setMethod('qr')}
              />
              <span>QR</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="paymethod"
                value="card"
                checked={method === 'card'}
                onChange={() => setMethod('card')}
              />
              <span>Карта</span>
            </label>
          </div>
        </div>
        <div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isAgentSale}
              onChange={(e) => setIsAgentSale(e.target.checked)}
            />
            <span>Агентская продажа</span>
          </label>
        </div>
        {isAgentSale ? (
          <>
            <div>
              <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Тип комиссии</div>
              <div className="flex gap-4 mb-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="commissionType"
                    value="percent"
                    checked={commissionType === 'percent'}
                    onChange={() => setCommissionType('percent')}
                  />
                  <span>% от суммы</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="commissionType"
                    value="fixed"
                    checked={commissionType === 'fixed'}
                    onChange={() => setCommissionType('fixed')}
                  />
                  <span>Фикс (₽)</span>
                </label>
              </div>
              <Input
                label={commissionType === 'percent' ? 'Комиссия агента, %' : 'Комиссия агента, ₽'}
                type="text"
                placeholder={commissionType === 'percent' ? '0' : '0.00'}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                onBlur={validateMinNet}
                required
                hint={commissionType === 'percent' ? 'Укажите дробное значение при необходимости, например 2.5' : 'Укажите фиксированную сумму в рублях'}
              />
            </div>
            <Input
              label="Телефон партнёра"
              type="tel"
              inputMode="tel"
              placeholder="+7 900 000-00-00"
              value={agentPhone}
              onChange={(e) => setAgentPhone(e.target.value)}
              required
            />
          </>
        ) : null}
          </>
        ) : null}
        <Button type="submit" disabled={loading || checkingExecutor}>{checkingExecutor ? `Проверяю${btnDots}` : (loading ? 'Создаю…' : (lastTaskId ? 'Повторить' : 'Продолжить'))}</Button>
        {paymentUrl ? (
          <div className="mt-4 space-y-3">
            <div className="flex gap-2 items-end">
              <Input
                label="Ссылка на оплату"
                value={paymentUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(paymentUrl);
                    setMessage('Ссылка скопирована');
                    setTimeout(() => setMessage(null), 1500);
                  } catch {
                    setMessage('Не удалось скопировать');
                  }
                }}
              >
                Копировать
              </Button>
            </div>
            
          </div>
        ) : null}
        {/* после успеха QR скрывается полностью */}
        {qrDataUrl && !(aoStatus && ['paid','transfered','transferred'].includes(String(aoStatus).toLowerCase())) ? (
          <div className="mt-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">QR для оплаты</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qrElement}
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{`Ждём подтверждения оплаты${dots}`}</div>
          </div>
        ) : null}
        {aoStatus && (aoStatus.toLowerCase() === 'paid' || aoStatus.toLowerCase() === 'transfered' || aoStatus.toLowerCase() === 'transferred') ? (
          <div className="mt-4 space-y-3">
            <div className="text-green-700 dark:text-green-400 text-sm">Успешно оплачено</div>
            <div className="flex gap-2 items-end">
              <Input label="Чек на покупку" value={purchaseReceiptUrl ?? ''} readOnly placeholder="Ожидаем чек…" className="flex-1" onFocus={(e) => e.currentTarget.select()} />
              {purchaseReceiptUrl ? (
                <Button type="button" variant="secondary" onClick={async () => { try { if (purchaseReceiptUrl) await navigator.clipboard.writeText(purchaseReceiptUrl); setMessage('Ссылка скопирована'); setTimeout(() => setMessage(null), 1500); } catch {} }}>Копировать</Button>
              ) : (
                <div className="w-9 h-9 flex items-center justify-center"><span className="inline-block w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" /></div>
              )}
            </div>
            {taskIsAgent ? (
              <div className="flex gap-2 items-end">
                <Input label="Чек на комиссию" value={commissionReceiptUrl ?? ''} readOnly placeholder="Ожидаем чек…" className="flex-1" onFocus={(e) => e.currentTarget.select()} />
                {commissionReceiptUrl ? (
                  <Button type="button" variant="secondary" onClick={async () => { try { if (commissionReceiptUrl) await navigator.clipboard.writeText(commissionReceiptUrl); setMessage('Ссылка скопирована'); setTimeout(() => setMessage(null), 1500); } catch {} }}>Копировать</Button>
                ) : (
                  <div className="w-9 h-9 flex items-center justify-center"><span className="inline-block w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" /></div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div className="mt-2 flex items-center gap-3 text-sm">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  if (!lastTaskId) return;
                  const urlRes = await fetch(`/api/rocketwork/tasks/${lastTaskId}?t=${Date.now()}`, { cache: 'no-store' });
                  const txt = await urlRes.text();
                  const st = txt ? JSON.parse(txt) : {};
                  const found = (st?.acquiring_order?.url as string | undefined) ?? (st?.task?.acquiring_order?.url as string | undefined);
                  if (found) {
                    setPaymentUrl(found);
                    try {
                      const dataUrl = await QRCode.toDataURL(found, { margin: 1, scale: 6 });
                      setQrDataUrl(dataUrl);
                    } catch {}
                    setMessage(null);
                    setLoading(false);
                  }
                } catch {}
              }}
            >Проверить вручную</Button>
            <span className="text-gray-500">попытка {attempt}</span>
          </div>
        ) : null}
        {message ? (
          <div className={`mt-2 text-sm ${messageKind === 'error' ? 'text-red-600' : messageKind === 'success' ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}`}>{message}</div>
        ) : null}
      </form>
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}

export default function AcceptPaymentPage() {
  return (
    <Suspense fallback={null}>
      <AcceptPaymentContent />
    </Suspense>
  );
}


