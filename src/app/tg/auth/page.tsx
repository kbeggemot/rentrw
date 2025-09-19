"use client";

import { useEffect, useMemo, useState } from 'react';
import Script from 'next/script';

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
    // Для корректной работы на iOS/desktop запрос номера запускаем только по клику пользователя
  }, []);

  const showShare = useMemo(() => start === 'share_phone', [start]);

  // Unified handler to start share flow
  function startShareFlow(): void {
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      // Не показываем предварительный алерт — сразу системный запрос
      // Optional write access
      try { tg?.requestWriteAccess?.(() => void 0); } catch {}
      // Tell backend we're awaiting contact
      try {
        const initData: string | undefined = tg?.initData;
        fetch('/api/phone/await-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initData || '' })
        }).catch(() => void 0);
      } catch {}
      // Native contact request
      if (typeof tg?.requestContact === 'function') {
        tg.requestContact((shared: boolean) => {
          if (shared) {
            try { tg?.showAlert?.('Спасибо! Для продолжения вернитесь на экран создания счета'); } catch {}
          } else {
            try { tg?.showAlert?.('Вы отменили доступ к номеру'); } catch {}
          }
        });
      } else {
        try { tg?.showPopup?.({ title: 'Не поддерживается', message: 'Ваш клиент Telegram не поддерживает запрос номера из мини‑аппа. Обновите приложение и попробуйте снова.' }); } catch {}
      }
    } catch {}
  }

  // Show Telegram Bottom (Main) Button for better reliability inside WebView
  useEffect(() => {
    if (!ready || !showShare) return;
    let cleanup: (() => void) | null = null;
    try {
      const tg = (window as any)?.Telegram?.WebApp;
      const btn = (tg?.BottomButton || tg?.MainButton);
      if (btn) {
        try { btn.setText?.('Поделиться номером'); } catch {}
        try { btn.show?.(); } catch {}
        const handler = () => startShareFlow();
        try { tg?.onEvent?.('mainButtonClicked', handler); } catch {}
        cleanup = () => {
          try { tg?.offEvent?.('mainButtonClicked', handler); } catch {}
          try { btn.hide?.(); } catch {}
        };
      }
    } catch {}
    return () => { try { cleanup?.(); } catch {} };
  }, [ready, showShare]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="lazyOnload" />
      <h1 className="text-lg font-semibold mb-3">YPLA</h1>
      {showShare ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">Поделиться номером телефона</div>
          {ready ? (
            <button
              className="inline-flex items-center justify-center h-10 px-4 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm w-full"
              onClick={() => startShareFlow()}
            >Поделиться номером</button>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-gray-700 dark:text-gray-200">Откройте страницу из Телеграма</div>
      )}
    </div>
  );
}


