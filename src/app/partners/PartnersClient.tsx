"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Partner = { phone: string; fio: string | null; status: string | null; updatedAt: string };

// Format phone for display with +
function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `+${digits}` : phone;
}

export default function PartnersClient({ initial, hasTokenInitial }: { initial: Partner[]; hasTokenInitial?: boolean }) {
  const [partners, setPartners] = useState<Partner[]>(initial);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(typeof hasTokenInitial === 'boolean' ? hasTokenInitial : null);
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
  // SSR уже передал флаг; если он не был передан, проверим на клиенте
  useEffect(() => { if (typeof hasTokenInitial === 'boolean') setHasToken(hasTokenInitial); }, [hasTokenInitial]);
  useEffect(() => {
    if (typeof hasTokenInitial === 'boolean') return;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/settings/token', { cache: 'no-store', credentials: 'include' });
        const d = await r.json();
        if (!aborted) setHasToken(Boolean(d?.token));
      } catch {
        if (!aborted) setHasToken(false);
      }
    })();
    return () => { aborted = true; };
  }, [hasTokenInitial]);

  if (hasToken === false) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Для начала работы укажите токен своей организации, полученный в Рокет Ворк.
          </p>
          <a href="/settings" className="inline-block">
            <Button>Перейти в настройки</Button>
          </a>
        </div>
      </div>
    );
  }


  // SWR-lite: hydrate from local cache first for instant paint
  useEffect(() => {
    try {
      const raw = localStorage.getItem('partners_cache_v1');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
          const nc = typeof parsed?.nextCursor === 'string' ? parsed.nextCursor : null;
          if (Array.isArray(list) && list.length > 0) {
            setPartners((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
            setNextCursor(nc);
          }
        } catch {}
      }
    } catch {}
  }, []);

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
      try {
        const m = await fetch('/api/partners/meta', { cache: 'no-store', credentials: 'include' });
        const md = await m.json();
        if (typeof md?.total === 'number') setTotal(md.total);
      } catch {}
      const res = await fetch('/api/partners?limit=15', { cache: 'no-store', credentials: 'include' });
      const data = await res.json();
      const list = Array.isArray(data?.items) ? data.items : [];
      const nc = typeof data?.nextCursor === 'string' && data.nextCursor.length > 0 ? String(data.nextCursor) : null;
      setPartners((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      setNextCursor(nc);
      try { localStorage.setItem('partners_cache_v1', JSON.stringify({ items: list, nextCursor: nc })); } catch {}
    } catch {
      // keep previous list on error to avoid flicker
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/partners?limit=15&cursor=${encodeURIComponent(nextCursor)}`, { cache: 'no-store', credentials: 'include' });
      const d = await r.json();
      const list = Array.isArray(d?.items) ? d.items : [];
      const nc = typeof d?.nextCursor === 'string' && d.nextCursor.length > 0 ? String(d.nextCursor) : null;
      setNextCursor(nc);
      setPartners((prev) => {
        const map = new Map<string, Partner>();
        for (const it of prev) map.set(String(it.phone), it);
        for (const it of list) map.set(String(it.phone), it);
        const merged = Array.from(map.values());
        merged.sort((a: any, b: any) => {
          const at = Date.parse(a?.updatedAt || a?.createdAt || 0);
          const bt = Date.parse(b?.updatedAt || b?.createdAt || 0);
          if (Number.isNaN(at) && Number.isNaN(bt)) return String(a.phone || '').localeCompare(String(b.phone || ''));
          if (Number.isNaN(at)) return 1;
          if (Number.isNaN(bt)) return -1;
          if (bt !== at) return bt - at;
          return String(a.phone || '').localeCompare(String(b.phone || ''));
        });
        try { localStorage.setItem('partners_cache_v1', JSON.stringify({ items: merged, nextCursor: nc })); } catch {}
        return merged;
      });
    } catch {
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
              <div className="grid grid-cols-[7.25rem_1fr] gap-x-2 gap-y-1 text-[13px] leading-tight">
                <div className="text-xs text-gray-500">Телефон</div>
                <div className="font-medium">{formatPhoneForDisplay(p.phone)}</div>
                <div className="text-xs text-gray-500">ФИО</div>
                <div>{p.fio ?? '-'}</div>
                <div className="text-xs text-gray-500">Статус</div>
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
                <td className="px-3 py-2">{formatPhoneForDisplay(p.phone)}</td>
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
      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="text-gray-600 dark:text-gray-400">Строк: {partners.length}{typeof total === 'number' ? ` из ${total}` : ''}</div>
        {nextCursor ? (
          <Button variant="secondary" onClick={loadMore} disabled={loading}>{loading ? 'Загрузка…' : 'Показать ещё'}</Button>
        ) : null}
      </div>
    </div>
  );
}


