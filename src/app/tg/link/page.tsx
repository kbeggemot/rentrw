"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

declare global {
  interface Window { Telegram?: any }
}

function getStartParam(): string | null {
  try {
    const url = new URL(typeof window !== 'undefined' ? window.location.href : 'https://ypla.ru');
    // Telegram passes tgWebAppStartParam automatically
    const q = url.searchParams.get('tgWebAppStartParam');
    if (q && /^[A-Za-z0-9_-]{1,64}$/.test(q)) return q;
  } catch {}
  try {
    const p = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (typeof p === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p)) return p;
  } catch {}
  return null;
}

export default function TgLinkEntry() {
  const router = useRouter();
  const [msg, setMsg] = useState<string>('Открываем страницу…');

  useEffect(() => {
    try { (window as any)?.Telegram?.WebApp?.ready?.(); } catch {}
    try { (window as any)?.Telegram?.WebApp?.expand?.(); } catch {}
    const code = getStartParam();
    if (code) {
      // Extract Telegram user id if available and pass forward
      const getUid = (): string | null => {
        try {
          const raw = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
          if (typeof raw === 'number' || typeof raw === 'string') return String(raw);
        } catch {}
        try {
          const init: string | undefined = (window as any)?.Telegram?.WebApp?.initData;
          if (typeof init === 'string' && init.includes('user=')) {
            const sp = new URLSearchParams(init);
            const userStr = sp.get('user');
            if (userStr) { const obj = JSON.parse(userStr); const id = obj?.id; if (typeof id === 'number' || typeof id === 'string') return String(id); }
          }
        } catch {}
        return null;
      };
      const uid = getUid();
      try { if (uid) sessionStorage.setItem('tg_user_id', uid); } catch {}
      try { if (uid) document.cookie = `tg_uid=${encodeURIComponent(uid)}; Path=/; Max-Age=1800`; } catch {}
      // stay inside mini app webview, client-side navigation and pass uid
      const url = `/link/${encodeURIComponent(code)}?tg=1${uid ? `&tgu=${encodeURIComponent(uid)}` : ''}`;
      router.replace(url);
      return;
    }
    setMsg('Не удалось определить код страницы');
  }, [router]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-lg font-semibold mb-2">YPLA</h1>
      <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm">{msg}</div>
      <div className="mt-3">
        <button
          className="rounded border px-3 h-9 text-sm"
          onClick={() => { try { (window as any)?.Telegram?.WebApp?.close?.(); } catch {} }}
        >Закрыть</button>
      </div>
    </div>
  );
}


