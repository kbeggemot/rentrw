"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

declare global {
  interface Window { Telegram?: any }
}

export default function InvoiceNewPage() {
  const [tgReady, setTgReady] = useState(false);
  const [tgUserId, setTgUserId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [waitId, setWaitId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [checkOk, setCheckOk] = useState<boolean | null>(null);
  const [fio, setFio] = useState<string | null>(null);
  const [companyType, setCompanyType] = useState<'ru' | 'foreign' | null>(null);
  const [payerInn, setPayerInn] = useState<string>('');
  const [payerTaxId, setPayerTaxId] = useState<string>('');
  const [payerAddress, setPayerAddress] = useState<string>('');
  const [payerName, setPayerName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2500); };
  const [serviceDescription, setServiceDescription] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [servicePeriodStart, setServicePeriodStart] = useState('');
  const [servicePeriodEnd, setServicePeriodEnd] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD');
  type StoredInvoice = { id: number; code?: string; createdAt: string; phone?: string; orgInn?: string; orgName?: string; email?: string | null; description?: string; amount?: string };
  const [createdList, setCreatedList] = useState<Array<StoredInvoice>>([]);
  const [listCursor, setListCursor] = useState<number | null>(0);
  const [listLoading, setListLoading] = useState(false);
  const isValidEmail = (s: string) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s.trim());
  const canCreate = useMemo(() => {
    if (!phone || !payerName || serviceDescription.trim().length === 0 || serviceAmount.trim().length === 0 || customerEmail.trim().length === 0) return false;
    if (companyType === 'ru') return payerInnValid();
    if (companyType === 'foreign') {
      if (payerTaxId.trim().length === 0 || payerAddress.trim().length === 0) return false;
      if (servicePeriodStart.trim().length === 0 || servicePeriodEnd.trim().length === 0) return false;
      return true;
    }
    return false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, payerName, serviceDescription, serviceAmount, companyType, payerInn, payerTaxId, payerAddress, servicePeriodStart, servicePeriodEnd, customerEmail]);
  function payerInnValid(): boolean { try { const d = (payerInn||'').replace(/\D/g,''); return d.length===10 || d.length===12; } catch { return false; } }
  const confirmDisabled = useMemo(() => {
    if (companyType === 'ru') { try { return (payerInn.replace(/\D/g, '').length < 10); } catch { return true; } }
    if (companyType === 'foreign') return payerTaxId.trim().length === 0;
    return true;
  }, [payerInn, companyType, payerTaxId]);

  const runCheck = useCallback(async () => {
    if (!phone || checking) return;
    setChecking(true); setCheckMsg(null); setCheckOk(null); setFio(null);
    const key = (() => { try { return `inv_check_${String(phone).replace(/\D/g, '')}`; } catch { return 'inv_check'; } })();
    try {
      const r = await fetch('/api/invoice/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.ok) {
        setCheckOk(true);
        setCheckMsg('Все в порядке');
        if (d?.fio) {
          setFio(String(d.fio));
          try { sessionStorage.setItem('inv_executor_fio', String(d.fio)); } catch {}
        }
        try { if (d?.inn) sessionStorage.setItem('inv_executor_inn', String(d.inn)); } catch {}
        try { sessionStorage.setItem(key, JSON.stringify({ ok: true, msg: 'Все в порядке', fio: d?.fio || null, ts: Date.now() })); } catch {}
      } else {
        setCheckOk(false);
        // Маппинг ошибок под стиль партнёров
        let msg = '';
        const code = String(d?.error || '').toUpperCase();
        if (code === 'PARTNER_NOT_REGISTERED') msg = 'Вы не завершили регистрацию в Рокет Ворке';
        else if (code === 'PARTNER_NOT_VALIDATED') msg = 'Вы не можете принять оплату: нет статуса самозанятого';
        else if (code === 'PARTNER_NOT_VALIDATED_OR_NOT_SE_IP') msg = 'Вы не можете принять оплату: вы не самозанятый (НПД)';
        else if (code === 'PARTNER_NO_PAYMENT_INFO') msg = 'У вас нет платёжных реквизитов';
        else msg = `${d?.message || d?.error || 'Ошибка'}`;
        setCheckMsg(msg);
        try { sessionStorage.setItem(key, JSON.stringify({ ok: false, msg, fio: null, ts: Date.now() })); } catch {}
      }
    } catch {
      setCheckOk(false);
      const msg = 'Ошибка запроса';
      setCheckMsg(msg);
      try { const key = `inv_check_${String(phone || '').replace(/\D/g, '')}`; sessionStorage.setItem(key, JSON.stringify({ ok: false, msg, fio: null, ts: Date.now() })); } catch {}
    } finally {
      setChecking(false);
    }
  }, [phone, checking]);

  useEffect(() => {
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      setTgReady(true);
      // Detect start_param to auto-open phone share
      const startParam = tg?.initDataUnsafe?.start_param || null;
      if (startParam === 'share_phone') {
        // Auto suggest sharing phone
        setStatus('Поделиться номером для проверки…');
      }
      // Try extract cached phone if previously saved on this page session (optimistic UI)
      const cached = sessionStorage.getItem('tg_shared_phone');
      if (cached) setPhone(cached);
      // Extract user id (best-effort)
      try {
        const raw = tg?.initDataUnsafe?.user?.id;
        if (typeof raw === 'number' || typeof raw === 'string') setTgUserId(String(raw));
      } catch {}
    } catch {}
  }, []);

  // Poll for saved phone by waitId (cross-app safe) or by user id as fallback
  useEffect(() => {
    // Try get uid from cookie if not set
    function readCookie(name: string): string | null {
      try {
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?:^|;\\s*)' + escapeRegExp(name) + '=([^;]+)');
        const m = document.cookie.match(re);
        return m ? decodeURIComponent(m[1]) : null;
      } catch { return null; }
    }
    // Initialize or reuse wait id
    try {
      let wid = sessionStorage.getItem('tg_wait_id');
      if (!wid) {
        wid = 'w' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('tg_wait_id', wid);
      }
      setWaitId(wid);
    } catch {}
    if (!tgUserId) {
      const uidFromCookie = readCookie('tg_uid');
      if (uidFromCookie) setTgUserId(uidFromCookie);
    }
    let cancelled = false;
    let timer: number | null = null;
    const fetchStatus = async () => {
      try {
        const r = await fetch(waitId ? `/api/phone/status?wait=${encodeURIComponent(String(waitId))}` : (tgUserId ? `/api/phone/status?uid=${encodeURIComponent(String(tgUserId))}` : '/api/phone/status'), { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        const ph = d?.phone ? String(d.phone) : null;
        if (!cancelled && ph) {
          setPhone(ph);
          try { sessionStorage.setItem('tg_shared_phone', ph); } catch {}
        }
      } catch {}
      if (!cancelled && !phone) timer = window.setTimeout(fetchStatus, 2000) as unknown as number;
    };
    fetchStatus();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [tgUserId, phone, waitId]);

  // Auto-show last known status and/or auto-check once when phone appears
  useEffect(() => {
    if (!phone) return;
    try {
      const key = `inv_check_${String(phone).replace(/\D/g, '')}`;
      const raw = sessionStorage.getItem(key);
      if (raw) {
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === 'object') {
            setCheckOk(Boolean(obj.ok));
            setCheckMsg(typeof obj.msg === 'string' ? obj.msg : null);
            setFio(obj.fio ? String(obj.fio) : null);
            return; // show cached status; кнопку спрячем если ok
          }
        } catch {}
      }
    } catch {}
    // If no cache — run initial check silently
    runCheck();
  }, [phone, runCheck]);

  const requestPhone = useCallback(async () => {
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      if (!tg) return;
      // 1) Попросим разрешение на сообщения, 2) затем запросим номер — оба запроса из одного клика
      setStatus('Запрашиваем разрешение на сообщения…');
      try {
        await new Promise<void>((resolve) => {
          try {
            tg.requestWriteAccess?.((allowed: boolean) => {
              if (allowed) {
                try { tg.showAlert?.('Спасибо! Мы сможем присылать уведомления в Telegram.'); } catch {}
              }
              resolve();
            });
          } catch { resolve(); }
        });
      } catch {}

      setStatus('Запрашиваем номер в Telegram…');
      await new Promise<void>((resolve) => {
        try {
          tg.requestContact((shared: any) => {
            if (shared) {
              try { tg.showAlert?.('Спасибо! Проверяем номер…'); } catch {}
              resolve();
            } else {
              try { tg.showAlert?.('Вы отменили доступ к номеру'); } catch {}
              resolve();
            }
          });
        } catch { resolve(); }
      });
      // Сообщим бэку, что ждём контакт (для маппинга webhook-а)
      try {
        const initData: string | undefined = (window as any)?.Telegram?.WebApp?.initData;
        await fetch('/api/phone/await-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initData || '' })
        });
      } catch {}
      setStatus('Ожидание контакта от Telegram…');
    } catch {
      setStatus('Не удалось запросить номер. Попробуйте ещё раз.');
    }
  }, []);

  const showLogin = useMemo(() => !phone, [phone]);

  const handleLogout = useCallback(() => {
    try {
      // Clear TG cookies used for linking mini-app sessions
      document.cookie = 'tg_uid=; Path=/; Max-Age=0';
      document.cookie = 'tg_fn=; Path=/; Max-Age=0';
      document.cookie = 'tg_ln=; Path=/; Max-Age=0';
      document.cookie = 'tg_un=; Path=/; Max-Age=0';
    } catch {}
    try { sessionStorage.removeItem('tg_shared_phone'); } catch {}
    try { sessionStorage.removeItem('tg_wait_id'); } catch {}
    try {
      const digits = String(phone || '').replace(/\D/g, '');
      if (digits) sessionStorage.removeItem(`inv_check_${digits}`);
    } catch {}
    setPhone(null);
    setTgUserId(null);
    setCheckOk(null);
    setCheckMsg(null);
    setFio(null);
    setOpening(false);
    setStatus(null);
    try { sessionStorage.removeItem('inv_executor_inn'); } catch {}
    try { sessionStorage.removeItem('inv_executor_fio'); } catch {}
  }, [phone]);

  return (
    <div className="max-w-xl mx-auto mt-6 md:mt-8 px-4 md:px-0 pb-10 md:pb-12">
      <header className="mb-4" style={{minHeight: '40px'}}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Создать счёт</h1>
          <a href="/invoice" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
        </div>
      </header>

      {showLogin ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-200">Поделитесь своим номером телефона — он должен совпадать с номером из Рокет Ворка.</p>
          <div className="flex flex-col gap-3">
            <a
              href={`https://t.me/yplaru_bot/tg_auth?startapp=${encodeURIComponent(`share_phone_${waitId || ''}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
                if (isLocal) {
                  e.preventDefault();
                  setPhone('+79851679287');
                  try { sessionStorage.setItem('tg_shared_phone', '+79851679287'); } catch {}
                  return;
                }
                setOpening(true); setStatus('Ожидаем подтверждение в Telegram…');
              }}
              className={`inline-flex items-center justify-center h-10 px-4 rounded text-sm text-white ${opening ? 'bg-blue-600 opacity-70' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {opening ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Ожидаем подтверждение в Telegram…
                </>
              ) : (
                'Войти через Телеграм'
              )}
            </a>
            {/* статус показываем только вне кнопки (например для ошибок) */}
            {(!opening && status) ? <div className="text-xs text-gray-500 dark:text-gray-400">{status}</div> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-base font-semibold mb-2 flex items-center justify-between">
              <div>Исполнитель</div>
              <button type="button" onClick={handleLogout} className="text-xs text-gray-500 hover:underline">выйти</button>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-200">Телефон: <strong>{phone}</strong></div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">
                Статус в Рокет Ворке: <strong>{checkOk ? (checkMsg || 'Все в порядке') : (checkMsg || '—')}</strong>
              </div>
              {checkOk !== true ? (
                <button
                  disabled={checking}
                  onClick={runCheck}
                  className={`ml-auto shrink-0 inline-flex items-center justify-center h-9 px-3 rounded text-sm ${checking ? 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {checking ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Проверяем…
                    </>
                  ) : 'Проверить еще раз'}
                </button>
              ) : null}
            </div>
            {fio ? (
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">ФИО: <strong>{fio}</strong></div>
            ) : null}
            {checkOk === false ? (
              <div className="mt-3 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                <span>Проверьте регистрацию в Рокет Ворке</span>
                <a href="https://trk.mail.ru/c/ss6nd8" target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-7 px-2 rounded border border-gray-300 dark:border-gray-700 text-xs">Перейти</a>
              </div>
            ) : null}
          </div>
          {checkOk === true ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-base font-semibold mb-2">Заказчик</div>
              {!companyType ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => setCompanyType('ru')}
                    className="flex-1 h-10 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >Российская компания</button>
                  <button
                    type="button"
                    onClick={() => setCompanyType('foreign')}
                    className="flex-1 h-10 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >Иностранная компания</button>
                </div>
              ) : null}
              {companyType === 'ru' ? (
              <>
              <div className="flex items-center gap-3">
                <Input
                  className="flex-1"
                  label="ИНН плательщика"
                  placeholder="10 или 12 цифр"
                  inputMode="numeric"
                  type="tel"
                  pattern="[0-9]*"
                  maxLength={12}
                  value={payerInn}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
                    setPayerInn(digits);
                  }}
                  hint="Укажите ИНН компании, которой вы оказываете услугу"
                />
                <button
                  type="button"
                  disabled={confirmDisabled || confirming}
                  onClick={async () => {
                    const inn = payerInn.replace(/\D/g, '');
                    if (inn.length < 10) return;
                    try {
                      setConfirming(true);
                      const r = await fetch('/api/invoice/dadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inn }) });
                      const d = await r.json().catch(() => ({}));
                      if (r.ok && d?.ok && d?.name) {
                        setPayerName(String(d.name));
                      } else if (r.status === 404 || String(d?.error || '') === 'NOT_FOUND') {
                        showToast('ИНН не найден, проверьте и попробуйте еще раз', 'error');
                      } else {
                        showToast('Что-то пошло не так. Попробуйте позднее', 'error');
                      }
                    } catch {
                      showToast('Что-то пошло не так. Попробуйте позднее', 'error');
                    } finally {
                      setConfirming(false);
                    }
                  }}
                  className={`shrink-0 inline-flex items-center justify-center h-9 px-3 rounded text-sm ${confirmDisabled || confirming
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-not-allowed'
                    : (payerName ? 'bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-700'
                      : 'bg-blue-600 hover:bg-blue-700 text-white')}`}
                >
                  {confirming ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Подтверждаем…
                    </>
                  ) : 'Подтвердить'}
                </button>
              </div>
              {payerName ? (
                <>
                  <div className="mt-3">
                    <Input label="Наименование" value={payerName} readOnly />
                  </div>
                  <div className="mt-3 grid grid-cols-1">
                    <Input
                      label="Email"
                      placeholder="roboto@example.com"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      hint="Укажите контактную почту для отправки счёта Заказчику"
                    />
                  </div>
                </>
              ) : null}
              </>
              ) : null}
              {companyType === 'foreign' ? (
                <>
                  <Input
                    label="TAX ID плательщика"
                    placeholder="Например: GB123456789"
                    value={payerTaxId}
                    onChange={(e) => {
                      setPayerTaxId(e.target.value);
                      if (e.target.value.trim().length > 0) setPayerName(`Компания (Tax ID: ${e.target.value})`);
                    }}
                    hint="Укажите регистрационный налоговый номер компании (VAT, TIN, EIN и т.п.). Этот номер необходим для корректного оформления документов"
                  />
                  <div className="mt-3">
                    <Textarea
                      label="Адрес юридического лица-плательщика"
                      placeholder="Например: 123 Main St, New York, NY 10001, USA"
                      rows={3}
                      value={payerAddress}
                      onChange={(e) => setPayerAddress(e.target.value)}
                      hint="Укажите адрес компании на английском языке (включая страну регистрации)"
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-1">
                    <Input
                      label="Email"
                      placeholder="roboto@example.com"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      hint="Укажите контактную почту для отправки счёта Заказчику"
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {(() => {
            if (companyType === 'ru') {
              return payerName && customerEmail.trim().length > 0;
            }
            if (companyType === 'foreign') {
              return payerTaxId.trim().length > 0 && payerAddress.trim().length > 0 && customerEmail.trim().length > 0;
            }
            return false;
          })() ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-base font-semibold mb-2">Услуги</div>
              {companyType === 'foreign' ? (
                <>
                  <Textarea
                    label="Описание на английском языке"
                    placeholder="Например: Design project development according to specifications"
                    maxLength={128}
                    value={serviceDescription}
                    onChange={(e) => setServiceDescription(e.target.value)}
                    hint="Укажите, за что вы выставляете счёт Заказчику. Не более 128 символов"
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Дата начала"
                      type="date"
                      value={servicePeriodStart}
                      onChange={(e) => setServicePeriodStart(e.target.value)}
                    />
                    <Input
                      label="Дата окончания"
                      type="date"
                      value={servicePeriodEnd}
                      onChange={(e) => setServicePeriodEnd(e.target.value)}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Валюта счета</label>
                      <select
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white text-black dark:bg-gray-800 dark:text-white px-3 h-9 text-sm"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR')}
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <Input
                      label="Стоимость"
                      placeholder="200"
                      inputMode="decimal"
                      type="text"
                      value={serviceAmount}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
                        const i = raw.indexOf(',');
                        const val = i === -1 ? raw : raw.slice(0, i + 1) + raw.slice(i + 1).replace(/,/g, '');
                        setServiceAmount(val);
                      }}
                      hint={`Укажите стоимость ваших услуг в выбранной валюте. С этой суммы будет удержана комиссия сервиса в размере 6%+25 ${currency}`}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Textarea
                    label="Описание"
                    placeholder="Например: разработка дизайн-проекта логотипа компании согласно ТЗ"
                    maxLength={128}
                    value={serviceDescription}
                    onChange={(e) => setServiceDescription(e.target.value)}
                    hint="Укажите, за что вы выставляете счёт Заказчику. Этот текст попадёт в чек НПД. Не более 128 символов"
                  />
                  <div className="mt-3">
                    <Input
                      className="w-full"
                      label="Стоимость"
                      placeholder="0"
                      inputMode="decimal"
                      type="text"
                      value={serviceAmount}
                      onChange={(e) => {
                        // Allow only digits and separators; display comma, keep only one comma
                        const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
                        const i = raw.indexOf(',');
                        const val = i === -1 ? raw : raw.slice(0, i + 1) + raw.slice(i + 1).replace(/,/g, '');
                        setServiceAmount(val);
                      }}
                      hint="Укажите стоимость ваших услуг до удержания налогов и комиссий в рублях"
                    />
                  </div>
                </>
              )}
            </div>
          ) : null}
          {canCreate ? (
            <div className="mt-4">
              <button
                className={`w-full h-10 rounded text-white text-sm ${listLoading ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                disabled={listLoading}
                onClick={async () => {
                  if (!customerEmail || !isValidEmail(customerEmail)) {
                    showToast('Укажите корректный email', 'error');
                    return;
                  }
                  if (companyType === 'foreign') {
                    const amt = Number(String(serviceAmount).replace(',', '.'));
                    if (!Number.isFinite(amt) || amt < 200) {
                      showToast('Минимальная стоимость для иностранной компании — 200 в выбранной валюте', 'error');
                      return;
                    }
                    const startDate = new Date(servicePeriodStart);
                    const endDate = new Date(servicePeriodEnd);
                    if (endDate < startDate) {
                      showToast('Дата окончания не может быть раньше даты начала', 'error');
                      return;
                    }
                  }
                  try {
                    setListLoading(true);
                    const payload = {
                      phone,
                      payerType: companyType || 'ru',
                      orgInn: companyType === 'ru' ? payerInn : '',
                      orgName: payerName,
                      taxId: companyType === 'foreign' ? payerTaxId : null,
                      address: companyType === 'foreign' ? payerAddress : null,
                      email: customerEmail || null,
                      description: serviceDescription.slice(0,128),
                      amount: serviceAmount,
                      currency: companyType === 'foreign' ? currency : null,
                      servicePeriodStart: companyType === 'foreign' ? servicePeriodStart : null,
                      servicePeriodEnd: companyType === 'foreign' ? servicePeriodEnd : null,
                      executorFio: fio || (sessionStorage.getItem('inv_executor_fio') || null),
                      executorInn: (sessionStorage.getItem('inv_executor_inn') || null)
                    };
                    const r = await fetch('/api/invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    const d = await r.json().catch(()=>({}));
                    if (r.ok && d?.ok && d?.invoice?.id) {
                      const url = `/invoice/${d?.invoice?.code || d.invoice.id}`;
                      // Обновляем таблицу и очищаем поля
                      try { setCreatedList([{ ...d.invoice }, ...createdList]); } catch {}
                      // Очистим поля заказчика и услуги
                      setCompanyType(null);
                      setPayerInn('');
                      setPayerTaxId('');
                      setPayerAddress('');
                      setPayerName(null);
                      setCustomerEmail('');
                      setServiceDescription('');
                      setServiceAmount('');
                      setServicePeriodStart('');
                      setServicePeriodEnd('');
                      setCurrency('USD');
                      // После появления строки в таблице — копируем ссылку и показываем тост
                      try { await navigator.clipboard.writeText(new URL(url, window.location.origin).toString()); } catch {}
                      showToast('Счёт создан, ссылка скопирована', 'success');
                    } else {
                      showToast('Не удалось создать счёт', 'error');
                    }
                  } catch { showToast('Не удалось создать счёт', 'error'); } finally { setListLoading(false); }
                }}
              >{listLoading ? 'Создаём…' : 'Создать счёт'}</button>
            </div>
          ) : null}
          {/* Список созданных счетов (не показываем, если пусто) */}
          <CreatedInvoices phoneDigits={String(phone||'').replace(/\D/g,'')} createdList={createdList} setCreatedList={setCreatedList} cursor={listCursor} setCursor={setListCursor} loading={listLoading} setLoading={setListLoading} onRepeat={(inv)=>{
            if (checkOk !== true) {
              const msg = (checkMsg && String(checkMsg).trim().length > 0) ? String(checkMsg) : 'Вы не можете создать счёт: пройдите проверку в Рокет Ворке';
              showToast(msg, 'error');
              return;
            }
            setPayerInn(String(inv.orgInn||''));
            setPayerName(inv.orgName ? String(inv.orgName) : null);
            setCustomerEmail(inv.email ? String(inv.email) : '');
            setServiceDescription(inv.description ? String(inv.description) : '');
            setServiceAmount(inv.amount ? String(inv.amount) : '');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }} />
          {toast ? (
            <div className={`fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-sm shadow-md ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}`}>{toast.msg}</div>
          ) : null}
          
        </div>
      )}
    </div>
  );
}

function CreatedInvoices({ phoneDigits, createdList, setCreatedList, cursor, setCursor, loading, setLoading, onRepeat }: { phoneDigits: string; createdList: Array<{ id: number; createdAt: string; phone?: string; orgInn?: string; orgName?: string; email?: string | null; description?: string; amount?: string }>; setCreatedList: (v: any) => void; cursor: number | null; setCursor: (v: number | null) => void; loading: boolean; setLoading: (v: boolean) => void; onRepeat: (inv: any) => void }) {
  const [initialized, setInitialized] = React.useState(false as any);
  React.useEffect(() => {
    let cancelled = false;
    if (initialized) return;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/invoice?limit=5&cursor=0${phoneDigits?`&phone=${encodeURIComponent(phoneDigits)}`:''}`, { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        if (!cancelled && Array.isArray(d?.items)) {
          setCreatedList(d.items.map((it: any) => ({ ...it })));
          setCursor(typeof d?.nextCursor === 'number' ? d.nextCursor : null);
        }
      } catch {}
      setLoading(false);
      setInitialized(true);
    })();
    return () => { cancelled = true; };
  }, [initialized, setCreatedList, setCursor, setLoading, phoneDigits]);

  if (createdList.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-base font-semibold mb-2">Созданные счета</div>
      <div className="border rounded border-gray-200 dark:border-gray-800 overflow-x-auto">
      <table className="min-w-[32rem] w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr><th className="text-left px-3 py-2">Номер</th><th className="text-left px-3 py-2">Создан</th><th className="text-left px-3 py-2">Ссылка</th><th className="text-left px-3 py-2">Действия</th></tr>
        </thead>
        <tbody>
          {createdList.map((it) => (
            <tr key={it.id} className="border-t border-gray-100 dark:border-gray-800">
              <td className="px-3 py-2">{it.id}</td>
              <td className="px-3 py-2">{(() => { const dt = new Date(it.createdAt); const dS = dt.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }); const tS = dt.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' }); return (<><span className="sm:inline">{dS}, </span><span className="block sm:inline">{tS}</span></>); })()}</td>
              <td className="px-3 py-2"><a className="text-blue-600 hover:underline" href={`/invoice/${(it as any).code || it.id}`} target="_blank" rel="noopener noreferrer">/invoice/{(it as any).code || it.id}</a></td>
              <td className="px-3 py-2"><button className="h-8 px-2 rounded border text-sm" onClick={() => onRepeat(it)}>Повторить</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor !== null ? (
        <div className="p-3">
          <button
            className="h-9 px-3 rounded border text-sm"
            disabled={loading}
            onClick={async () => {
              try {
                setLoading(true);
                const r = await fetch(`/api/invoice?limit=5&cursor=${cursor}${phoneDigits?`&phone=${encodeURIComponent(phoneDigits)}`:''}`, { cache: 'no-store' });
                const d = await r.json().catch(() => ({}));
                if (Array.isArray(d?.items) && d.items.length > 0) {
                  setCreatedList([...createdList, ...d.items.map((it: any) => ({ ...it }))]);
                  setCursor(typeof d?.nextCursor === 'number' ? d.nextCursor : null);
                } else setCursor(null);
              } catch { setCursor(null); }
              setLoading(false);
            }}
          >{loading ? 'Загрузка…' : 'Показать ещё'}</button>
        </div>
      ) : null}
      </div>
    </div>
  );
}


