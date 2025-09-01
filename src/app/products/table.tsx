"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

type Item = {
  id: string;
  kind: 'goods' | 'service';
  title: string;
  category?: string | null;
  price: number;
  unit: 'усл' | 'шт' | 'упак' | 'гр' | 'кг' | 'м';
  vat: 'none' | '0' | '5' | '7' | '10' | '20';
  sku?: string | null;
};

export default function ProductsTable({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(Array.isArray(initialItems) ? initialItems : []);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  const onDelete = async (id: string) => {
    if (!confirm('Удалить позицию?')) return;
    try {
      const r = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) {
        showToast('Не удалось удалить', 'error');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      showToast('Удалено', 'success');
    } catch {
      showToast('Не удалось удалить', 'error');
    }
  };

  const fmtPrice = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));

  return (
    <>
      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {items.length === 0 ? (
          <div className="text-center text-gray-500 border rounded-lg p-4 bg-white dark:bg-gray-950">Пока пусто</div>
        ) : (
          items.map((p) => (
            <div key={p.id} className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 p-3">
              <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1 text-[13px] leading-tight">
                <div className="text-xs text-gray-500">Тип</div>
                <div>{p.kind === 'service' ? 'Услуга' : 'Товар'}</div>
                <div className="text-xs text-gray-500">Наименование</div>
                <div className="font-medium break-words">{p.title}</div>
                <div className="text-xs text-gray-500">Категория</div>
                <div>{p.category || '-'}</div>
                <div className="text-xs text-gray-500 whitespace-nowrap">Цена, {'\u00A0'}₽</div>
                <div>{fmtPrice(p.price)}</div>
                <div className="text-xs text-gray-500">Ед.</div>
                <div>{p.unit}</div>
                <div className="text-xs text-gray-500">НДС</div>
                <div>{p.vat === 'none' ? 'Без НДС' : `${p.vat}%`}</div>
                <div className="text-xs text-gray-500">Артикул</div>
                <div>{p.sku || '-'}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 items-center">
                <a href={`/products/edit/${encodeURIComponent(p.id)}`} className="inline-flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 h-9 px-3 text-sm text-black dark:text-white" aria-label="Редактировать">Редактировать</a>
                <div className="justify-self-end">
                  <Button variant="secondary" size="icon" aria-label="Удалить" onClick={() => onDelete(p.id)}>×</Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left p-2">Тип</th>
              <th className="text-left p-2">Наименование</th>
              <th className="text-left p-2">Категория</th>
              <th className="text-left p-2">Цена</th>
              <th className="text-left p-2">Ед.</th>
              <th className="text-left p-2">НДС</th>
              <th className="text-left p-2">Артикул</th>
              <th className="text-left p-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? items.map((p) => (
              <tr key={p.id} className="border-t border-gray-200 dark:border-gray-800">
                <td className="p-2">{p.kind === 'service' ? 'Услуга' : 'Товар'}</td>
                <td className="p-2">{p.title}</td>
                <td className="p-2">{p.category || ''}</td>
                <td className="p-2">{fmtPrice(p.price)}</td>
                <td className="p-2">{p.unit}</td>
                <td className="p-2">{p.vat === 'none' ? 'Без НДС' : `${p.vat}%`}</td>
                <td className="p-2">{p.sku || ''}</td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <a href={`/products/edit/${encodeURIComponent(p.id)}`} className="inline-flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 h-9 px-2 text-sm text-black dark:text-white" aria-label="Редактировать">Редактировать</a>
                    <Button variant="secondary" size="icon" aria-label="Удалить" onClick={() => onDelete(p.id)}>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 5l1 9h8l1-9" />
                        <path d="M2 5h12" />
                        <path d="M6 5V3h4v2" />
                      </svg>
                    </Button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="p-3 text-center text-gray-500" colSpan={8}>Пока пусто</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      ) : null}
    </>
  );
}



