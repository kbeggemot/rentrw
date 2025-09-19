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

  // Poll for saved phone if we know user id (after sharing in mini-app)
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
    if (!tgUserId) {
      const uidFromCookie = readCookie('tg_uid');
      if (uidFromCookie) setTgUserId(uidFromCookie);
    }
    if (!tgUserId) return;
    let cancelled = false;
    let timer: number | null = null;
    const fetchStatus = async () => {
      try {
        const r = await fetch(`/api/phone/status?uid=${encodeURIComponent(String(tgUserId))}`, { cache: 'no-store' });
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
  }, [tgUserId, phone]);

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
          <p className="text-sm text-gray-700 dark:text-gray-200">Поделитесь своим номером телефона — он должен совпадать с номером из Рокет Ворк.</p>
          <div className="flex flex-col gap-3">
            <a
              href="https://t.me/yplaru_bot/tg_auth?startapp=share_phone"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-10 px-4 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
            >Войти через Телеграм</a>
            {status ? <div className="text-xs text-gray-500 dark:text-gray-400">{status}</div> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-gray-700 dark:text-gray-200">Ваш номер: <strong>{phone}</strong></div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Продолжение создания счёта добавим следующим шагом.</div>
        </div>
      )}
    </div>
  );
}


