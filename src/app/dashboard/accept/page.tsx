'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Input } from '@/components/ui/Input';
import { applyAgentCommissionToCart } from '@/lib/pricing';
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
  // New: service vs cart mode + cart builder like payment link
  const [mode, setMode] = useState<'service' | 'cart'>('service');
  const [orgProducts, setOrgProducts] = useState<Array<{ id: string; title: string; price: number }>>([]);
  const [cart, setCart] = useState<Array<{ id: string; title: string; price: string; qty: string }>>([]);
  const [commission, setCommission] = useState('');
  const [isAgentSale, setIsAgentSale] = useState(false);
  const [agentPhone, setAgentPhone] = useState('');
  const [partners, setPartners] = useState<Array<{ phone: string; fio: string | null }>>([]);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
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
  const [defaultComm, setDefaultComm] = useState<{ type: 'percent' | 'fixed'; value: number } | null>(null);
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
  const methodRef = useRef<PaymentMethod>('qr');
  const lastQrUrlRef = useRef<string | null>(null);
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

  // preload partners for agent selector
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/partners', { cache: 'no-store' });
        const d = await r.json();
        const arr = Array.isArray(d?.partners) ? d.partners : [];
        setPartners(arr.map((p: any) => ({ phone: String(p.phone || ''), fio: p.fio ?? null })));
      } catch {}
    })();
  }, []);

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
    const numAmount = (mode === 'cart')
      ? (() => {
          const toNum = (v: string) => Number(String(v || '0').replace(',', '.'));
          const total = cart.reduce((sum, r) => {
            const price = toNum(r.price);
            const qty = toNum(r.qty || '1');
            if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
            return sum + price * qty;
          }, 0);
          return total;
        })()
      : Number(amount.replace(',', '.'));
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
      lastQrUrlRef.current = null;
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
        if (d?.defaultCommission?.type) {
          setCommissionType(d.defaultCommission.type);
          setDefaultComm({ type: d.defaultCommission.type, value: Number(d.defaultCommission.value || 0) });
        }
        if (typeof d?.defaultCommission?.value === 'number') setCommission(String(d.defaultCommission.value));
        if (typeof d?.agentDescription === 'string') setAgentDesc(d.agentDescription);
      } catch {}
    };
    loadDefaults();
    return () => { aborted = true; };
  }, []);

  // When agent toggled on — fill defaults if empty
  useEffect(() => {
    if (!isAgentSale) return;
    if ((commission || '').trim().length > 0) return;
    if (!defaultComm) return;
    setCommissionType(defaultComm.type);
    setCommission(String(defaultComm.value));
  }, [isAgentSale, defaultComm]);

  // Load products for cart selector
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/products', { cache: 'no-store' });
        const d = await r.json();
        const items = Array.isArray(d?.items) ? d.items : [];
        setOrgProducts(items.map((p: any) => ({ id: p.id, title: p.title, price: Number(p.price || 0) })));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    paymentUrlRef.current = paymentUrl;
    updateDebug();
  }, [paymentUrl]);

  // Keep method in ref to use inside async handlers
  useEffect(() => { methodRef.current = method; }, [method]);

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
      lastQrUrlRef.current = null;
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
          if (paymentUrlRef.current !== found) {
          setPaymentUrl(found);
            paymentUrlRef.current = found;
          try {
              if (lastQrUrlRef.current !== found) {
            const dataUrl = await QRCode.toDataURL(found, { margin: 1, scale: 6 });
            setQrDataUrl(dataUrl);
                lastQrUrlRef.current = found;
              }
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
    const toNum = (v: string) => Number(String(v || '0').replace(',', '.'));
    const cartNumeric = (mode === 'cart') ? cart.map((r) => ({ id: r.id || null, title: r.title, price: toNum(r.price), qty: toNum(r.qty || '1') })) : [];
    const numAmount = (mode === 'cart') ? cartNumeric.reduce((s, r) => s + (r.price * r.qty), 0) : Number(amount.replace(',', '.'));
    const numComm = Number(commission.replace(',', '.'));
    if (!Number.isFinite(numAmount) || numAmount <= 0) { showToast(mode==='cart' ? 'Итоговая сумма должна быть больше нуля' : 'Введите корректную сумму', 'error'); return; }
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
      if (agentPhone.replace(/\D/g, '').length === 0) { showToast('Укажите телефон партнёра', 'error'); return; }
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
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorData.partnerData)
              });
            } catch (e) {
              // Silent fail - partner update is not critical for payment flow
            }
          }
          
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
          agentPhone: isAgentSale && agentPhone.replace(/\D/g, '').length > 0 ? agentPhone.replace(/\D/g, '') : undefined,
          commissionType: isAgentSale ? commissionType : undefined,
          commissionValue: isAgentSale ? numComm : undefined,
          serviceEndDate,
          vatRate,
          cartItems: mode === 'cart' ? cartNumeric : undefined,
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const code = data?.error;
        if (code === 'AGENT_VAT_FORBIDDEN') { showToast('Самозанятый не может реализовывать позиции с НДС', 'error'); setLoading(false); setCollapsed(false); return; }
        throw new Error(code || text || 'Ошибка создания сделки');
      }

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
            if (paymentUrlRef.current !== url0) {
              setPaymentUrl(url0);
              paymentUrlRef.current = url0;
              try {
                if (lastQrUrlRef.current !== url0) {
                  const dataUrl = await QRCode.toDataURL(url0, { margin: 1, scale: 6 });
                  setQrDataUrl(dataUrl);
                  lastQrUrlRef.current = url0;
                }
              } catch {}
              setMessage(null);
        setLoading(false);
            }
      }
        } catch {}
        startPolling(taskId, myAttempt);
        // Persist items snapshot (adjusted if agent) into sale store
        try {
          if (mode === 'cart') {
            const payload: any = { cart: cartNumeric };
            if (isAgentSale && commissionType && Number.isFinite(numComm)) {
              // Всегда считать от оригинальных цен (cartNumeric уже отражает исходные price, qty)
              const adj = applyAgentCommissionToCart(cartNumeric, commissionType, numComm);
              payload.cart = adj.adjusted;
            }
            // Fire-and-forget to our internal endpoint to enrich sale (reuse existing record API)
            // We piggyback on recordSaleOnCreate call that is already made inside tasks/route via store
            // So here we only send a lightweight beacon to attach snapshot in background
            try {
              navigator.sendBeacon?.('/api/sales/attach-snapshot', new Blob([JSON.stringify({ taskId, items: payload.cart })], { type: 'application/json' }));
            } catch {}
          }
        } catch {}
        startStatusWatcher(taskId, myAttempt, isAgentSale);
      } else { setLoading(false); showToast('Не удалось получить идентификатор задачи', 'error'); setCollapsed(false); }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      if (msg === 'AGENT_VAT_FORBIDDEN') showToast('Самозанятый не может реализовывать позиции с НДС', 'error');
      else showToast(msg, 'error');
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
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Принять оплату</h1>
        <a href="/dashboard" className="rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
      </div>
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {collapsed ? (
          <div className="flex items-center justify-between p-3 border rounded bg-white dark:bg-gray-950">
            <div className="text-sm text-gray-700 dark:text-gray-300">Параметры оплаты</div>
            <Button type="button" variant="secondary" onClick={() => setCollapsed(false)}>Показать</Button>
          </div>
        ) : null}
        {!collapsed ? (
          <>
        <div>
          <div className="text-base font-semibold mb-2">Что продаете?</div>
          <div className="flex gap-2 mb-3">
            <button type="button" className={`px-3 h-9 rounded border ${mode==='service'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('service')}>Свободная услуга</button>
            <button type="button" className={`px-3 h-9 rounded border ${mode==='cart'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('cart')}>Собрать корзину</button>
          </div>
          {mode==='service' ? (
            <Input
              label="Сумма, ₽"
              type="text"
              placeholder="0,00"
              value={amount.replace('.', ',')}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
              onBlur={validateMinNet}
              required
            />
          ) : (
            <div className="space-y-2">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Выберите нужные позиции на витрине</label>
              {cart.map((row, idx) => (
                <div key={idx} className="overflow-x-auto sm:overflow-visible -mx-1 px-1 touch-pan-x">
                  <div className="flex items-start gap-2 w-max">
                    <div className="relative flex-1 min-w-[8rem] sm:min-w-[14rem]">
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Наименование</div>) : null}
                      <input
                        className="w-full rounded border px-2 h-9 text-sm"
                        placeholder="Начните вводить название"
                        list={`products-list-${idx}`}
                        value={row.title}
                        onChange={(e)=>{
                          const title = e.target.value;
                          const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                          setCart((prev)=> prev.map((r,i)=> i===idx ? {
                            id: p?.id || '',
                            title,
                            price: (p ? (p.price ?? 0) : (r.price || '')).toString(),
                            qty: r.qty || '1',
                          } : r));
                        }}
                        onBlur={(e)=>{
                          const title = e.currentTarget.value;
                          const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                          if (p) setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, id: p.id, title: p.title, price: (p.price ?? 0).toString() } : r));
                        }}
                      />
                      <datalist id={`products-list-${idx}`}>
                        {orgProducts.map((p)=> (<option key={p.id} value={p.title} />))}
                      </datalist>
                    </div>
                    <div>
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Количество</div>) : null}
                      <input className="w-20 sm:w-24 rounded border px-2 h-9 text-sm" placeholder="Кол-во" value={row.qty} onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, qty: e.target.value } : r))} />
                    </div>
                    <div>
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Цена, ₽</div>) : null}
                      {(() => {
                        const base = String(row.price || '').replace('.', ',');
                        const v = Number(commission.replace(',', '.'));
                        const commissionValid = isAgentSale && ((commissionType === 'percent' && v >= 0) || (commissionType === 'fixed' && v > 0));
                        // Пересчитываем от исходных цен при каждом изменении qty/price
                        const numeric = cart.map((c) => ({ title: c.title, price: Number(String(c.price || '0').replace(',', '.')), qty: Number(String(c.qty || '1').replace(',', '.')) }));
                        const adjusted = commissionValid ? applyAgentCommissionToCart(numeric, commissionType, v).adjusted : numeric;
                        const shown = commissionValid ? (adjusted[idx]?.price ?? Number(String(row.price||'0').replace(',', '.'))) : Number(String(row.price||'0').replace(',', '.'));
                        return (
                          <input
                            className="w-24 sm:w-28 rounded border px-2 h-9 text-sm"
                            placeholder="Цена"
                            value={commissionValid ? shown.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : base}
                            onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, price: e.target.value.replace(',', '.') } : r))}
                          />
                        );
                      })()}
                    </div>
                    <div className="flex flex-col">
                      {idx===0 ? (<div className="text-xs mb-1 invisible">label</div>) : null}
                      <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border flex items-center justify-center" onClick={()=> setCart((prev)=> prev.filter((_,i)=> i!==idx))}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
              {(() => {
                const v = Number(commission.replace(',', '.'));
                const commissionValid = isAgentSale && ((commissionType === 'percent' && v >= 0) || (commissionType === 'fixed' && v > 0));
                if (!commissionValid || cart.length === 0) return null;
                const T = cart.reduce((sum, r) => sum + Number(String(r.price||'0').replace(',', '.')) * Number(String(r.qty||'1').replace(',', '.')), 0);
                const A = commissionType === 'percent' ? T * (v / 100) : v;
                const agentAmount = Math.round((Math.min(Math.max(A, 0), T) + Number.EPSILON) * 100) / 100;
                return (
                  <div className="overflow-x-auto sm:overflow-visible -mx-1 px-1 touch-pan-x">
                    <div className="flex items-center gap-2 w-max opacity-90">
                      <div className="relative flex-1 min-w-[8rem] sm:min-w-[14rem]">
                        <input className="w-full rounded border px-2 h-9 text-sm bg-gray-100" value={agentDesc || 'Услуги агента'} readOnly disabled />
                      </div>
                      <div>
                        <input className="w-16 sm:w-20 rounded border px-2 h-9 text-sm bg-gray-100" value="1" readOnly disabled />
                      </div>
                      <div>
                        <input className="w-24 sm:w-28 rounded border px-2 h-9 text-sm bg-gray-100" value={agentAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} readOnly disabled />
                      </div>
                      <div className="flex">
                        <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border text-gray-400 flex items-center justify-center self-center" disabled>✕</button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <button type="button" className="px-3 h-9 rounded border" onClick={()=> setCart((prev)=> [...prev, { id:'', title:'', price:'', qty:'1' }])}>+ Добавить</button>
              {(() => {
                const toNum = (v: string) => Number(String(v || '0').replace(',', '.'));
                // Считаем от оригинальных цен (numeric)
                const numeric = cart.map((c) => ({ price: toNum(c.price), qty: toNum(c.qty || '1') }));
                const v = Number(commission.replace(',', '.'));
                const commissionValidLocal = isAgentSale && ((commissionType === 'percent' && v >= 0) || (commissionType === 'fixed' && v > 0));
                const eff = (commissionValidLocal ? applyAgentCommissionToCart(numeric.map(x=>({ title:'', ...x })), commissionType, v).adjusted : numeric.map(x=>({ title:'', ...x }))).reduce((s,r)=> s + r.price * r.qty, 0);
                const T = numeric.reduce((s,r)=> s + r.price * r.qty, 0);
                const A = commissionValidLocal ? (commissionType === 'percent' ? T * (v / 100) : v) : 0;
                const total = eff + A;
                const formatted = Number.isFinite(total) ? total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
                return (
                  <div className="mt-2">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма, ₽</label>
                    <div className="w-44">
                      <input className="w-full rounded border pl-2 h-9 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700" value={formatted} readOnly disabled />
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
        {mode==='service' ? (
          <Textarea
            label="Описание услуги"
            placeholder="Например: Оплата консультации"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            required
          />
        ) : null}
        <Input
          label="Email покупателя (необязательно)"
          type="email"
          inputMode="email"
          pattern="^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
          placeholder="user@example.com"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
        />
        {mode==='service' ? (
          <div>
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">НДС</div>
            <select className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-950" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
              <option value="none">Без НДС</option>
              <option value="0">НДС 0%</option>
              <option value="5">НДС 5%</option>
              <option value="7">НДС 7%</option>
              <option value="10">НДС 10%</option>
              <option value="20">НДС 20%</option>
            </select>
          </div>
        ) : null}
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
          <div className="text-base font-semibold mb-1">Принимаете оплату как Агент?</div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isAgentSale}
              onChange={(e) => setIsAgentSale(e.target.checked)}
            />
            <span>Агентская продажа</span>
          </label>
          <div className="text-xs text-gray-500 mt-1">
            Разделите оплату между вами и самозанятым партнёром.
            <span className="ml-1 text-gray-700 dark:text-gray-300">Описание услуги агента:</span>
            <span className="ml-1 text-black dark:text-white">{agentDesc || 'Услуги агента'}</span>
            <span className="ml-1">(<a className="underline" href="/settings">изменить</a>)</span>
          </div>
        </div>
        {isAgentSale ? (
          <>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <select
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
                value={commissionType}
                onChange={(e) => setCommissionType(e.target.value as 'percent'|'fixed')}
              >
                <option value="percent">%</option>
                <option value="fixed">₽</option>
              </select>
              <Input
                type="text"
                placeholder="Комиссия"
                value={commission.replace('.', ',')}
                onChange={(e) => setCommission(e.target.value.replace(',', '.'))}
                onBlur={validateMinNet}
                required
                className="w-48"
              />
              <div className="relative flex-1 min-w-[14rem]">
                <input
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
                  placeholder="Телефон или ФИО партнёра"
                  value={(() => {
                    const digits = agentPhone.replace(/\D/g, '');
                    const found = partners.find((p) => p.phone.replace(/\D/g, '') === digits);
                    return found?.fio ? `${found.fio} — ${digits || agentPhone}` : agentPhone;
                  })()}
                  onChange={(e) => { setAgentPhone(e.target.value); setPartnersOpen(true); }}
                  onFocus={() => setPartnersOpen(true)}
                  onBlur={() => setTimeout(() => setPartnersOpen(false), 150)}
                />
                {/* никаких внешних подпісей ФИО */}
                {partnersOpen ? (
                  <div className="absolute left-0 top-full mt-1 w-[22rem] max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow z-10">
                    {(() => {
                      const q = agentPhone.toLowerCase();
                      const qDigits = q.replace(/\D/g, '');
                      const items = partners.filter((p) => {
                        const phoneDigits = p.phone.replace(/\D/g, '');
                        const phoneOk = qDigits.length > 0 && phoneDigits.includes(qDigits);
                        const fioOk = (p.fio || '').toLowerCase().includes(q);
                        return qDigits.length > 0 ? phoneOk : (fioOk || phoneOk);
                      });
                      return items.length === 0 ? (
                        qDigits ? (
                          <div className="px-2 py-2 text-xs">
                            <button type="button" className="px-2 py-1 text-sm rounded border hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => {
                              const phoneDigits = agentPhone.replace(/\D/g, '');
                              if (!phoneDigits) return;
                              setPartnerLoading(true);
                              try {
                                const res = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneDigits }) });
                                const d = await res.json();
                                if (res.ok) {
                                  const p = d?.partner || {};
                                  const fio = p?.fio || null;
                                  setPartners((prev) => {
                                    const exists = prev.some((x) => x.phone.replace(/\D/g, '') === phoneDigits);
                                    return exists ? prev.map((x) => (x.phone.replace(/\D/g, '') === phoneDigits ? { phone: phoneDigits, fio } : x)) : [...prev, { phone: phoneDigits, fio }];
                                  });
                                  setPartnersOpen(false);
                                }
                              } catch {} finally { setPartnerLoading(false); }
                            }}>Добавить</button>
                          </div>
                        ) : (
                          <div className="px-2 py-2 text-xs text-gray-500">Ничего не найдено</div>
                        )
                      ) : (
                        items.map((p, i) => (
                          <button key={i} type="button" className="w-full text-left px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onMouseDown={() => { setAgentPhone(p.phone); setPartnersOpen(false); }}>
                            <span className="font-medium">{p.fio || 'Без имени'}</span>
                            <span className="text-gray-500"> — {p.phone}</span>
                          </button>
                        ))
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
          </>
        ) : null}
        <Button type="submit" disabled={loading || checkingExecutor}>{checkingExecutor ? `Проверяю${btnDots}` : (loading ? 'Создаю…' : (lastTaskId ? 'Повторить' : 'Создать'))}</Button>
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
                    showToast('Ссылка скопирована', 'success');
                  } catch {
                    showToast('Не удалось скопировать', 'error');
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
          <div className="mt-4">
            <div className="text-green-700 font-medium mb-2">Успешно оплачено</div>
            <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <div className="text-gray-500">Чек на покупку</div>
              {purchaseReceiptUrl ? (
                <a className="text-black dark:text-white font-semibold hover:underline" href={purchaseReceiptUrl} target="_blank" rel="noreferrer">Открыть</a>
              ) : (
                <div className="text-gray-600">Подгружаем{dots}</div>
              )}
              {taskIsAgent ? (
                <>
                  <div className="text-gray-500">Чек на комиссию</div>
                  {commissionReceiptUrl ? (
                    <a className="text-black dark:text-white font-semibold hover:underline" href={commissionReceiptUrl} target="_blank" rel="noreferrer">Открыть</a>
                  ) : (
                    <div className="text-gray-600">Подгружаем{dots}</div>
                  )}
                </>
              ) : null}
            </div>
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
                    if (paymentUrlRef.current !== found) {
                    setPaymentUrl(found);
                      paymentUrlRef.current = found;
                    try {
                        if (lastQrUrlRef.current !== found) {
                      const dataUrl = await QRCode.toDataURL(found, { margin: 1, scale: 6 });
                      setQrDataUrl(dataUrl);
                          lastQrUrlRef.current = found;
                        }
                    } catch {}
                    setMessage(null);
                    setLoading(false);
                    }
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
      </div>
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


