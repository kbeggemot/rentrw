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
    // Для корректной работы на iOS/desktop запрос номера запускаем только по клику пользователя
  }, []);

  const showShare = useMemo(() => start === 'share_phone', [start]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-lg font-semibold mb-3">YPLA</h1>
      {showShare ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">Поделиться номером телефона</div>
          {ready ? (
            <button
              className="inline-flex items-center justify-center h-10 px-4 rounded border border-gray-300 dark:border-gray-700 text-sm"
              onClick={() => {
                try {
                  const tg = (window as any)?.Telegram?.WebApp;
                  // (1) Необязательно: запрос права писать пользователю
                  try { tg?.requestWriteAccess?.(() => void 0); } catch {}
                  // (2) Сообщаем бэку, что ждём контакт
                  try {
                    const initData: string | undefined = tg?.initData;
                    fetch('/api/phone/await-contact', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ initData: initData || '' })
                    }).catch(() => void 0);
                  } catch {}
                  // (3) Нативный запрос номера
                  tg?.requestContact?.((shared: boolean) => {
                    if (shared) {
                      try { tg?.showAlert?.('Спасибо! Проверяем номер…'); } catch {}
                    } else {
                      try { tg?.showAlert?.('Вы отменили доступ к номеру'); } catch {}
                    }
                  });
                } catch {}
              }}
            >Поделиться номером</button>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-gray-700 dark:text-gray-200">Откройте страницу из Телеграма</div>
      )}
    </div>
  );
}


