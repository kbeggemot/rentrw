'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === '/dashboard') {
      // Активна на всех вложенных маршрутах дашборда
      return pathname.startsWith('/dashboard');
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 md:flex md:flex-col">
      <nav className="flex flex-col items-stretch gap-1 p-2">
        <Link
          href="/dashboard"
          className={`px-3 py-2 rounded-md text-sm w-full text-left ${
            isActive('/dashboard') ? 'bg-gray-100 dark:bg-gray-900 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
          }`}
        >
          Касса
        </Link>
        <Link
          href="/sales"
          className={`px-3 py-2 rounded-md text-sm w-full text-left ${
            isActive('/sales') ? 'bg-gray-100 dark:bg-gray-900 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
          }`}
        >
          Продажи
        </Link>
        <Link
          href="/partners"
          className={`px-3 py-2 rounded-md text-sm w-full text-left ${
            isActive('/partners') ? 'bg-gray-100 dark:bg-gray-900 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
          }`}
        >
          Партнёры
        </Link>
        <Link
          href="/settings?view=1"
          className={`px-3 py-2 rounded-md text-sm w-full text-left ${
            isActive('/settings') ? 'bg-gray-100 dark:bg-gray-900 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
          }`}
        >
          Настройки
        </Link>
      </nav>
      <div className="block md:hidden p-2 pt-0">
        <form action="/api/auth/logout" method="post" className="w-full">
          <button
            type="submit"
            className="px-3 py-2 rounded-md text-sm w-full text-left hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Выйти
          </button>
        </form>
      </div>
      <div className="hidden md:block mt-auto p-2">
        <form action="/api/auth/logout" method="post" className="w-full">
          <button
            type="submit"
            className="px-3 py-2 rounded-md text-sm w-full text-left hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Выйти
          </button>
        </form>
      </div>
    </aside>
  );
}


