"use client";
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Запускаем фоновое обновление продаж при входе в ЛК
    void fetch('/api/sales?refresh=1', { cache: 'no-store' }).catch(() => {});
  }, []);
  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr] md:grid-cols-[16rem_1fr] md:grid-rows-1">
      {/* Top bar with burger on mobile and narrow desktop */}
      <div className="md:hidden sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-2">
        <button
          aria-label="Открыть меню"
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-900"
          onClick={() => setOpen(true)}
        >
          {/* hamburger icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="text-sm font-medium">RentRW</div>
      </div>
      {/* Desktop sidebar (visible from md and up) */}
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {/* Drawer for mobile and narrow desktop */}
      {open ? (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 bg-background border-r border-gray-200 dark:border-gray-800 shadow-lg p-0">
            <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-800">
              <div className="text-sm font-medium">Меню</div>
              <button aria-label="Закрыть меню" className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-900" onClick={() => setOpen(false)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <Sidebar />
          </div>
        </div>
      ) : null}
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}


