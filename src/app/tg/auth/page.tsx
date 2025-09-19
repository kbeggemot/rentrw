"use client";

import { useEffect, useMemo, useState } from 'react';

declare global {
  interface Window { Telegram?: any }
}

function getStartParam(): string | null {
  try {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'https://ypla.ru');
    const q = url.searchParams.get('tgWebAppStartParam');
    if (q && /^[A-Za-z0-9_-]{1,64}$/.test(q)) return q;
  } catch {}
  try {
    const p = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (typeof p === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p)) return p;
  } catch {}
  return null;
}

export default function TgAuthPage() {
  const [start, setStart] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
    } catch {}
    setReady(true);
    const s = getStartParam();
    setStart(s);
    // Persist Telegram user id in a short-lived cookie for cross-page correlation
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      const u = tg?.initDataUnsafe?.user;
      const id = u?.id;
      if (typeof id === 'number' || typeof id === 'string') {
        document.cookie = `tg_uid=${encodeURIComponent(String(id))}; Path=/; Max-Age=1800`;
      }
    } catch {}
    // If opened with share_phone, immediately request permissions and contact, and notify backend
    if (s === 'share_phone') {
      try {
        const tg = (window as any)?.Telegram?.WebApp;
        // Best-effort write access first
        try { tg?.requestWriteAccess?.(() => void 0); } catch {}
        // Notify backend we are awaiting contact (so webhook will be accepted)
        try {
          const initData: string | undefined = tg?.initData;
          fetch('/api/phone/await-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: initData || '' })
          }).catch(() => void 0);
        } catch {}
        // Request contact right away (some clients разрешают без клика)
        try { tg?.requestContact?.(() => void 0); } catch {}
      } catch {}
    }
  }, []);

  const showShare = useMemo(() => start === 'share_phone', [start]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-lg font-semibold mb-3">YPLA</h1>
      {showShare ? (
        <div className="space-y-2">
          <div className="text-sm text-gray-700 dark:text-gray-200">Успех! Запрос на номер отправлен.</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Подтвердите всплывающее окно Telegram (если появилось) и вернитесь на форму счёта в YPLA.</div>
        </div>
      ) : (
        <div className="text-sm text-gray-700 dark:text-gray-200">Откройте страницу из Телеграма</div>
      )}
    </div>
  );
}


