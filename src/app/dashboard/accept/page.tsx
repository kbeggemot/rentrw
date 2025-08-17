'use client';

import { useEffect, useRef, useState } from 'react';
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
  const loadingRef = useRef<boolean>(false);
  const paymentUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const ref = pollAbortRef.current;
    return () => {
      ref.aborted = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
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
  }, [paymentUrl]);

  // Явный старт опроса после получения taskId, чтобы исключить конфликты эффектов
  const startPolling = (taskId: string | number) => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    // гарантируем «живой» флаг перед стартом
    pollAbortRef.current.aborted = false;
    setAttempt(0);
    const tick = async (n: number) => {
      if (pollAbortRef.current.aborted) return;
      if (paymentUrlRef.current) return;
      setAttempt(n);
      try {
        const stRes = await fetch(`/api/rocketwork/tasks/${taskId}?t=${Date.now()}`, { cache: 'no-store' });
        const stText = await stRes.text();
        const stData = stText ? JSON.parse(stText) : {};
        const found = (stData?.acquiring_order?.url as string | undefined)
          ?? (stData?.task?.acquiring_order?.url as string | undefined);
        const status = (stData?.acquiring_order?.status as string | undefined)
          ?? (stData?.task?.acquiring_order?.status as string | undefined);
        if (status) {
          const msg = `Ожидаем ссылку… (статус: ${status})`;
          setMessage((prev) => (prev === msg ? prev : msg));
        }
        if (stRes.ok && found) {
          setPaymentUrl(found);
          try {
            const dataUrl = await QRCode.toDataURL(found, { margin: 1, scale: 6 });
            setQrDataUrl(dataUrl);
          } catch {}
          setMessage(null);
          loadingRef.current = false;
          setLoading(false);
          return;
        }
      } catch {}
      pollTimerRef.current = setTimeout(() => tick(n + 1), 1500);
    };
    tick(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setMessageKind('info');
    const numAmount = Number(amount.replace(',', '.'));
    const numComm = Number(commission.replace(',', '.'));
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setMessage('Введите корректную сумму');
      setMessageKind('error');
      return;
    }
    if (isAgentSale) {
      if (!agentDesc || agentDesc.trim().length === 0) {
        setMessage('Заполните описание ваших услуг, как Агента, в настройках');
        setMessageKind('error');
        return;
      }
      if (commission.trim().length === 0) {
        setMessage('Укажите комиссию агента');
        return;
      }
      if (commissionType === 'percent') {
        if (!Number.isFinite(numComm) || numComm < 0 || numComm > 100) {
          setMessage('Комиссия должна быть в диапазоне 0–100%');
          setMessageKind('error');
          return;
        }
      } else {
        if (!Number.isFinite(numComm) || numComm <= 0) {
          setMessage('Укажите фиксированную комиссию в рублях (> 0)');
          setMessageKind('error');
          return;
        }
      }
      if (agentPhone.trim().length === 0) {
        setMessage('Укажите телефон партнёра');
        setMessageKind('error');
        return;
      }
    }
    // Отправка на серверный маршрут создания сделки
    try {
      loadingRef.current = true;
      setLoading(true);
      // схлопываем параметры под спойлер, раз локальная валидация прошла
      setCollapsed(true);
      paymentUrlRef.current = null;
      setPaymentUrl(null);
      setAttempt(0);
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
        }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || text || 'Ошибка создания сделки');

      const taskId: string | number | undefined = data?.task_id ?? data?.data?.id ?? data?.data?.task?.id;
      if (taskId !== undefined) {
        setLastTaskId(taskId);
        startPolling(taskId);
      } else {
        setLoading(false);
        setMessage('Не удалось получить идентификатор задачи');
        setMessageKind('error');
        setCollapsed(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      setMessage(msg);
      setMessageKind('error');
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
        <Button type="submit" disabled={loading}>{loading ? 'Создаю…' : (paymentUrl ? 'Повторить' : 'Продолжить')}</Button>
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
            {qrDataUrl ? (
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">QR для оплаты</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR code" className="w-48 h-48 border rounded" />
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
                  const urlRes = await fetch('/api/rocketwork/tasks/last', { cache: 'no-store' });
                  const txt = await urlRes.text();
                  const st = txt ? JSON.parse(txt) : {};
                  const found = st?.acquiring_order?.url as string | undefined;
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
            {lastTaskId ? <span className="text-gray-500">task: {String(lastTaskId)} · попытка {attempt}</span> : null}
          </div>
        ) : null}
        {message ? (
          <div className={`mt-2 text-sm ${messageKind === 'error' ? 'text-red-600' : messageKind === 'success' ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}`}>{message}</div>
        ) : null}
      </form>
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


