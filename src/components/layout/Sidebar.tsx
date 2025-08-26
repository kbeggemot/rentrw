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
  try {
    const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(typeof document !== 'undefined' ? (document.cookie || '') : '');
    const cookieInn = m ? decodeURIComponent(m[1]) : null;
    try {
      const raw = localStorage.getItem('orgs_cache_v1');
      const arr = raw ? JSON.parse(raw) : null;
      const orgs = Array.isArray(arr) ? arr : [];
      const hide = !cookieInn && orgs.length === 0;
      return hide ? null : <OrgSelector />;
    } catch {
      return cookieInn ? <OrgSelector /> : null;
    }
  } catch {
    return null;
  }
}

function OrgSelector() {
  // Считываем cookie синхронно для начального значения, чтобы не мигать
  let cookieInn: string | null = null;
  try {
    const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(typeof document !== 'undefined' ? (document.cookie || '') : '');
    cookieInn = m ? decodeURIComponent(m[1]) : null;
  } catch {}
  const [orgs, setOrgs] = useState<Array<{ inn: string; name: string | null; maskedToken?: string | null }>>(() => {
    try { const raw = localStorage.getItem('orgs_cache_v1'); const arr = raw ? JSON.parse(raw) : null; return Array.isArray(arr) ? arr : []; } catch { return []; }
  });
  const [inn, setInn] = useState<string | null>(cookieInn);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/organizations', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        if (!cancelled && Array.isArray(d?.items)) {
          setOrgs(d.items);
          try { localStorage.setItem('orgs_cache_v1', JSON.stringify(d.items)); } catch {}
        }
      } catch {}
      if (inn == null) {
        try {
          const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(document.cookie || '');
          const val = m ? decodeURIComponent(m[1]) : null;
          if (!cancelled) setInn(val);
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [inn]);
  if (!mounted) {
    return (
      <div className="mb-2">
        <label className="block text-xs text-gray-500 mb-1">Организация</label>
        <select className="w-full px-2 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm" disabled>
          <option>Загрузка…</option>
        </select>
      </div>
    );
  }
  return (
    <div className="mb-2">
      <label className="block text-xs text-gray-500 mb-1">Организация</label>
      <select
        className="w-full px-2 h-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm"
        value={inn ?? (orgs[0]?.inn || '')}
        onChange={async (e) => {
          const next = e.target.value || '';
          setInn(next || null);
          try { await fetch('/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inn: next }), credentials: 'include' }); } catch {}
          // мягко перезагрузим страницу, чтобы применить контекст
          try { window.location.reload(); } catch {}
        }}
      >
        {(orgs && orgs.length > 0 ? orgs : (inn ? [{ inn, name: null }] : [])).map((o) => (
          <option key={o.inn} value={o.inn}>{o.name ? `${o.name} (${o.inn})` : o.inn}</option>
        ))}
      </select>
    </div>
  );
}


