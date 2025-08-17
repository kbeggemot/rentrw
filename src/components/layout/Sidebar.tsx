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
          prefetch
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
          prefetch
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
          prefetch
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
          prefetch
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


