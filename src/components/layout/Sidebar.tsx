'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

export function Sidebar() {
  const pathname = usePathname();
  const [pressedHref, setPressedHref] = useState<string | null>(null);
  useEffect(() => {
    // Сбрасываем подсветку после завершения перехода
    setPressedHref(null);
  }, [pathname]);
  const isActive = (href: string) => {
    if (href === '/dashboard') {
      // Активна на всех вложенных маршрутах дашборда
      return pathname.startsWith('/dashboard');
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 flex flex-col h-full md:h-screen md:sticky md:top-0 md:self-start md:overflow-auto">
      <nav className="flex flex-col items-stretch gap-1 p-2">
        <Link
          href="/dashboard"
          onMouseDown={() => setPressedHref('/dashboard')}
          onTouchStart={() => setPressedHref('/dashboard')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/dashboard') || pressedHref === '/dashboard'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Касса
        </Link>
        <Link
          href="/sales"
          onMouseDown={() => setPressedHref('/sales')}
          onTouchStart={() => setPressedHref('/sales')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/sales') || pressedHref === '/sales'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Продажи
        </Link>
        <Link
          href="/products"
          onMouseDown={() => setPressedHref('/products')}
          onTouchStart={() => setPressedHref('/products')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/products') || pressedHref === '/products'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Витрина
        </Link>
        <Link
          href="/partners"
          onMouseDown={() => setPressedHref('/partners')}
          onTouchStart={() => setPressedHref('/partners')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/partners') || pressedHref === '/partners'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Партнёры
        </Link>
        <Link
          href="/link"
          onMouseDown={() => setPressedHref('/link')}
          onTouchStart={() => setPressedHref('/link')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/link') || pressedHref === '/link'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Страницы
        </Link>
        <Link
          href="/settings?view=1"
          onMouseDown={() => setPressedHref('/settings')}
          onTouchStart={() => setPressedHref('/settings')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/settings') || pressedHref === '/settings'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Настройки
        </Link>
        <Link
          href="/admin?tab=invoices"
          onMouseDown={() => setPressedHref('/admin?tab=invoices')}
          onTouchStart={() => setPressedHref('/admin?tab=invoices')}
          prefetch={false}
          className={`px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
            isActive('/admin') && typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('tab') === 'invoices' || pressedHref === '/admin?tab=invoices'
              ? 'bg-gray-100 dark:bg-gray-900 font-medium'
              : 'hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900'
          }`}
        >
          Счета (админ)
        </Link>
      </nav>
      <div className="block md:hidden p-2 pt-0 mt-auto">
        {/* Организация: перенесена вниз, над кнопкой выхода */}
        <OrgSelectorWrapper />
        <form action="/api/auth/logout" method="post" className="w-full">
          <button
            type="submit"
            className="px-3 py-2 rounded-md text-sm w-full text-left hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900 transition-colors"
          >
            Выйти
          </button>
        </form>
      </div>
      <div className="hidden md:block mt-auto p-2">
        {/* Организация: перенесена вниз, над кнопкой выхода */}
        <OrgSelectorWrapper />
        <form action="/api/auth/logout" method="post" className="w-full">
          <button
            type="submit"
            className="px-3 py-2 rounded-md text-sm w-full text-left hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 active:dark:bg-gray-900 transition-colors"
          >
            Выйти
          </button>
        </form>
      </div>
    </aside>
  );
}

function OrgSelectorWrapper() {
  // Показываем селектор только если уже есть добавленные организации
  // (первичный вход без организаций — скрываем, даже если нет токена)
  const [visible, setVisible] = useState<boolean | null>(null);
  const [prefetched, setPrefetched] = useState<Array<{ inn: string; name: string | null; maskedToken?: string | null }> | null>(null);
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        // 1) Проверим локальный кэш
        try {
          const raw = localStorage.getItem('orgs_cache_v1');
          const arr = raw ? JSON.parse(raw) : null;
          if (Array.isArray(arr) && arr.length > 0) {
            if (!aborted) { setVisible(true); setPrefetched(arr); }
            // Не выходим: продолжаем делать сетевой запрос, чтобы обновить кэш
          }
        } catch {}
        // 2) Если есть выбранная организация в cookie — тоже показываем
        try {
          const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(document.cookie || '');
          if (m && m[1]) { if (!aborted) setVisible(true); /* нет данных для префетча */ }
        } catch {}
        // 3) Спросим у сервера (всегда, чтобы обновить кэш)
        const r = await fetch('/api/organizations', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        const items = Array.isArray(d?.items) ? d.items : [];
        if (!aborted) { setVisible(items.length > 0); setPrefetched(items); }
        try { localStorage.setItem('orgs_cache_v1', JSON.stringify(items)); } catch {}
      } catch {
        if (!aborted) setVisible(false);
      }
    })();
    return () => { aborted = true; };
  }, []);
  if (!visible) return null;
  return <OrgSelector prefetched={prefetched || undefined} />;
}

function OrgSelector({ prefetched }: { prefetched?: Array<{ inn: string; name: string | null; maskedToken?: string | null }> }) {
  const [orgs, setOrgs] = useState<Array<{ inn: string; name: string | null; maskedToken?: string | null }>>([]);
  const [inn, setInn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (prefetched && Array.isArray(prefetched)) {
          const items = prefetched;
          if (!cancelled) {
            setOrgs(items);
            try {
              const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(document.cookie || '');
              const cookieInn = m ? decodeURIComponent(m[1]) : null;
              const exists = cookieInn && items.some((o) => o.inn === cookieInn);
              setInn(exists ? cookieInn : (items[0]?.inn || null));
            } catch {
              setInn(items[0]?.inn || null);
            }
            setLoading(false);
            return;
          }
        }
        const r = await fetch('/api/organizations', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        const items: Array<{ inn: string; name: string | null }> = Array.isArray(d?.items) ? d.items : [];
        if (!cancelled) {
          setOrgs(items);
          try {
            const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(document.cookie || '');
            const cookieInn = m ? decodeURIComponent(m[1]) : null;
            const exists = cookieInn && items.some((o) => o.inn === cookieInn);
            setInn(exists ? cookieInn : (items[0]?.inn || null));
          } catch {
            setInn(items[0]?.inn || null);
          }
          try { localStorage.setItem('orgs_cache_v1', JSON.stringify(items)); } catch {}
        }
      } catch {
        if (!cancelled) { setOrgs([]); setInn(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (loading) {
    return (
      <div className="mb-2">
        <label className="block text-xs text-gray-500 mb-1">Организация</label>
        <select className="w-full px-2 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm" disabled>
          <option>Загрузка…</option>
        </select>
      </div>
    );
  }
  if (orgs.length === 0) return null;
  return (
    <div className="mb-2">
      <label className="block text-xs text-gray-500 mb-1">Организация</label>
      <select
        className="w-full px-2 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm"
        value={inn ?? ''}
        onChange={async (e) => {
          const next = e.target.value || '';
          setInn(next || null);
          try { await fetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inn: next }), credentials: 'include' }); } catch {}
          try { window.location.reload(); } catch {}
        }}
      >
        {orgs.map((o) => (
          <option key={o.inn} value={o.inn}>{o.name ? `${o.name} (${o.inn})` : o.inn}</option>
        ))}
      </select>
    </div>
  );
}


