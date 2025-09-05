"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';

export default function LinksStandalonePage() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  useEffect(() => { (async () => { try { const r = await fetch('/api/settings/token', { cache: 'no-store' }); const d = await r.json(); setHasToken(Boolean(d?.token)); } catch { setHasToken(false); } })(); }, []);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info'; actionLabel?: string; actionHref?: string } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info', actionLabel?: string, actionHref?: string) => {
    setToast({ msg, kind, actionLabel, actionHref });
    setTimeout(() => setToast(null), 3000);
  };

  const [links, setLinks] = useState<Array<{ code: string; title: string; createdAt?: string }>>([]);
  const [linksOpen, setLinksOpen] = useState(true);
  const [menuOpenCode, setMenuOpenCode] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Глобальное закрытие контекстного меню по клику вне
  useEffect(() => {
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-menu-root]')) return;
      setMenuOpenCode(null);
      setMenuPos(null);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('touchstart', close, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('touchstart', close, true);
    };
  }, []);

  const refreshLinks = async () => {
    try {
      const r = await fetch('/api/links', { cache: 'no-store' });
      const d = await r.json();
      if (Array.isArray(d?.items)) setLinks(d.items.map((x: any) => ({ code: x.code, title: x.title, createdAt: x.createdAt })));
    } catch {}
  };

  useEffect(() => { (async () => { await refreshLinks(); })(); }, []);
  // Flash success after redirect from creation
  useEffect(() => {
    try {
      const flag = sessionStorage.getItem('flash');
      if (flag === 'OK') {
        sessionStorage.removeItem('flash');
        showToast('Ссылка создана', 'success');
      } else if (flag === 'COPIED') {
        sessionStorage.removeItem('flash');
        showToast('Ссылка создана и скопирована', 'success');
      } else if (flag === 'UPDATED') {
        sessionStorage.removeItem('flash');
        showToast('Страница обновлена', 'success');
      }
    } catch {}
  }, []);

  if (hasToken === false) {
    return (
      <div className="max-w-3xl mx-auto pt-0 pb-4">
        <header className="mb-4" style={{minHeight: '40px'}}>
          <h1 className="text-2xl font-bold">Платежные страницы</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Создание и управление платёжными ссылками</p>
        </header>
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">Для начала работы укажите токен своей организации, полученный в Рокет Ворк.</p>
          <a href="/settings" className="inline-block">
            <button className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Перейти в настройки</button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <header className="mb-4" style={{minHeight: '40px'}}>
        <h1 className="hidden md:block text-2xl font-bold">Платежные страницы</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Создание и управление платёжными ссылками</p>
      </header>

      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
        <a href="/link/new">
          <Button variant="secondary" className="text-base w-full" fullWidth>
            Создать платежную страницу
          </Button>
        </a>

        <div className="mt-4">
          <button type="button" className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-between" onClick={async () => { const next = !linksOpen; setLinksOpen(next); if (next && links.length === 0) { await refreshLinks(); } }}>
            <span className="text-base font-semibold">Мои платежные страницы</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${linksOpen ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {linksOpen ? (
            <div className="mt-2 overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded">
              {links.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">Ссылок нет</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {links.map((l) => (
                    <div key={l.code} className="flex items-center justify-between px-3 py-2">
                      <div className="text-sm"><a className="text-black dark:text-white font-semibold hover:underline" href={`/link/${encodeURIComponent(l.code)}`} target="_blank" rel="noreferrer">{l.title || l.code}</a></div>
                      <div className="flex items-center gap-2 relative">
                        {/* tail preview of the URL as plain text */}
                        <div className="text-sm text-gray-600 dark:text-gray-400">/{l.code}</div>
                        <Button variant="secondary" size="icon" aria-label="Скопировать ссылку" onClick={async () => { try { await navigator.clipboard.writeText(new URL(`/link/${encodeURIComponent(l.code)}`, window.location.origin).toString()); showToast('Ссылка скопирована', 'success'); } catch {} }}>
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="6" y="3" width="7" height="9" rx="1" />
                            <rect x="3" y="6" width="7" height="9" rx="1" />
                          </svg>
                        </Button>
                        <Button asChild variant="secondary" size="icon" aria-label="Открыть в Telegram">
                          <a href={`https://t.me/yplaru_bot/link?startapp=${encodeURIComponent(l.code)}`} target="_blank" rel="noreferrer">
                            {/* paper plane icon */}
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M22 2L11 13" />
                              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                            </svg>
                          </a>
                        </Button>
                        {/* kebab menu for edit/delete */}
                        <Button variant="secondary" size="icon" aria-label="Действия" onClick={(ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenuPos({ top: r.bottom + 8, left: r.right - 192 }); setMenuOpenCode((prev) => (prev === l.code ? null : l.code)); }}>
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="3" cy="8" r="1" />
                            <circle cx="8" cy="8" r="1" />
                            <circle cx="13" cy="8" r="1" />
                          </svg>
                        </Button>
                        {/* Меню рендерим через портал, чтобы не обрезалось контейнером */}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {/* Портал для выпадающего меню, как на продажах */}
      {menuOpenCode && menuPos ? createPortal(
        <div className="fixed z-[10000]" style={{ top: menuPos.top, left: menuPos.left, width: 192 }} data-menu-root>
          <div className="w-48 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded shadow-sm">
            <a
              href={`/link/${encodeURIComponent(menuOpenCode)}/edit`}
              className="block px-3 py-2 text-sm font-medium text-left hover:bg-gray-50 dark:hover:bg-gray-900"
              onClick={() => setMenuOpenCode(null)}
            >Редактировать</a>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
              onClick={async () => {
                const code = menuOpenCode; setMenuOpenCode(null);
                if (!confirm('Удалить ссылку?')) return;
                try { await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE' }); setLinks((prev) => prev.filter((x) => x.code !== code)); } catch {}
              }}
            >Удалить</button>
          </div>
        </div>, document.body) : null}
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm flex items-center gap-3 ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
          <div>{toast.msg}</div>
          {toast.actionHref ? (
            <a href={toast.actionHref} className="underline font-medium hover:opacity-90 whitespace-nowrap">{toast.actionLabel || 'Открыть'}</a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


