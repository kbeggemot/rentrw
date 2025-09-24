"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

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
        if (d?.fio) setFio(String(d.fio));
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

  return (
    <div className="max-w-xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">Создать счёт</h1>

      {showLogin ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-200">Поделитесь своим номером телефона — он должен совпадать с номером из Рокет Ворка.</p>
          <div className="flex flex-col gap-3">
            <a
              href={`https://t.me/yplaru_bot/tg_auth?startapp=${encodeURIComponent(`share_phone_${waitId || ''}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { setOpening(true); setStatus('Ожидаем подтверждение в Telegram…'); }}
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
            <div className="text-sm font-medium mb-2">Исполнитель</div>
            <div className="text-sm text-gray-700 dark:text-gray-200">Телефон: <strong>{phone}</strong></div>
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              {(checkOk != null || checkMsg) ? (
                <div className="text-sm text-gray-700 dark:text-gray-200">
                  Статус в Рокет Ворке: {checkOk ? (<strong>{checkMsg || 'Все в порядке'}</strong>) : (<strong>{checkMsg || '—'}</strong>)}
                </div>
              ) : <div className="text-sm text-gray-700 dark:text-gray-200">Статус в Рокет Ворке: —</div>}
              {checkOk !== true ? (
                <button
                  disabled={checking}
                  onClick={runCheck}
                  className={`inline-flex items-center justify-center h-9 px-3 rounded text-sm ${checking ? 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {checking ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Проверяем…
                    </>
                  ) : 'Повторить'}
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
          <div className="text-xs text-gray-500 dark:text-gray-400">Продолжение создания счёта добавим следующим шагом.</div>
        </div>
      )}
    </div>
  );
}


