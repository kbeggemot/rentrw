"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Partner = { phone: string; fio: string | null; status: string | null; updatedAt: string };

export default function PartnersClient({ initial }: { initial: Partner[] }) {
  const [partners, setPartners] = useState<Partner[]>(initial);
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const [sseOn, setSseOn] = useState(false);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => p.phone.toLowerCase().includes(q) || (p.fio ? p.fio.toLowerCase().includes(q) : false));
  }, [partners, query]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partners', { cache: 'no-store', credentials: 'include' });
      const data = await res.json();
      const list = Array.isArray(data?.partners) ? data.partners : [];
      setPartners((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    } catch {
      // keep previous list on error to avoid flicker
    } finally {
      setLoading(false);
    }
  };

  const invite = async () => {
    // no-op: toast used instead of inline message
    const ph = phone.trim();
    if (ph.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ phone: ph }) });
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) throw new Error((data && data.error) || text || 'Ошибка');
      setPhone('');
      showToast('Приглашение отправлено', 'success');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Подписка на серверные события (прод) и мягкое обновление партнёров
  useEffect(() => {
    if (sseOn) return;
    const isProd = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
    if (!isProd) return; // локаль без авто‑обновления
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data || '{}');
          if (msg && (msg.topic === 'partners:update')) {
            void reload();
          }
        } catch {}
      };
      setSseOn(true);
    } catch {}
    return () => { try { es?.close(); } catch {} };
  }, [sseOn]);

  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="hidden md:block text-2xl font-bold mb-4">Партнёры</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <Input label="Телефон" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-56" />
        <Button onClick={invite} disabled={loading || phone.trim().length === 0}>{loading ? '...' : 'Пригласить'}</Button>
        <Input label="Поиск" placeholder="Телефон или ФИО" value={query} onChange={(e) => setQuery(e.target.value)} className="w-64" />
        <Button
          variant="ghost"
          onClick={() => { setPhone(''); setQuery(''); }}
          disabled={loading}
        >Сбросить</Button>
        <Button
          variant="secondary"
          onClick={async () => {
            setLoading(true);
            try {
              await fetch('/api/partners/refresh', { method: 'POST' });
              await reload();
            } catch {}
            setLoading(false);
          }}
          disabled={loading}
        >Обновить</Button>
      </div>
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-sm shadow-md ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}`}>{toast.msg}</div>
      ) : null}

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {paged.length === 0 ? (
          <div className="text-center text-gray-500 border rounded-lg p-4 bg-white dark:bg-gray-950">Нет партнёров</div>
        ) : (
          paged.map((p) => (
            <div key={p.phone} className="border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-950 p-3">
              <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
                <div className="text-gray-500">Телефон</div>
                <div className="font-medium">{p.phone}</div>
                <div className="text-gray-500">ФИО</div>
                <div>{p.fio ?? '-'}</div>
                <div className="text-gray-500">Статус</div>
                <div>{p.status ?? '-'}</div>
              </div>
              <div className="mt-3"><Button asChild variant="secondary"><Link href={`/dashboard/accept?agent=1&phone=${encodeURIComponent(p.phone)}`}>Создать оплату</Link></Button></div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left px-3 py-2">Телефон</th>
              <th className="text-left px-3 py-2">ФИО</th>
              <th className="text-left px-3 py-2">Статус</th>
              <th className="text-left px-3 py-2 w-[230px]">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">Нет партнёров</td>
              </tr>
            ) : paged.map((p) => (
              <tr key={p.phone} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2">{p.phone}</td>
                <td className="px-3 py-2">{p.fio ?? '-'}</td>
                <td className="px-3 py-2">{p.status ?? '-'}</td>
                <td className="px-3 py-2">
                  <div className="inline-flex items-center gap-2">
                    <Button asChild variant="secondary"><Link href={`/dashboard/accept?agent=1&phone=${encodeURIComponent(p.phone)}`}>Создать оплату</Link></Button>
                    <Button
                    aria-label="Удалить"
                    variant="secondary"
                    size="icon"
                    onClick={async () => {
                      if (!confirm('Удалить партнёра из списка?')) return;
                      setDeleting(p.phone);
                      try {
                        const url = `/api/partners?phone=${encodeURIComponent(p.phone)}`;
                        await fetch(url, { method: 'DELETE', credentials: 'include' });
                        await reload();
                      } catch {}
                      setDeleting(null);
                    }}
                  >
                    {/* trash icon */}
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 5l1 9h8l1-9" />
                      <path d="M2 5h12" />
                      <path d="M6 5V3h4v2" />
                    </svg>
                  </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="text-gray-600 dark:text-gray-400">Строк: {Math.min(filtered.length, page * pageSize)} из {filtered.length}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Назад</Button>
            <div className="px-2 py-1">{page}</div>
            <Button variant="ghost" onClick={() => setPage((p) => (p * pageSize < filtered.length ? p + 1 : p))} disabled={page * pageSize >= filtered.length}>Вперёд</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}


