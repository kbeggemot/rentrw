"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Partner = { phone: string; fio: string | null; status: string | null; updatedAt: string };

export default function PartnersClient({ initial }: { initial: Partner[] }) {
  const [partners, setPartners] = useState<Partner[]>(initial);
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => p.phone.toLowerCase().includes(q) || (p.fio ? p.fio.toLowerCase().includes(q) : false));
  }, [partners, query]);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partners', { cache: 'no-store' });
      const data = await res.json();
      setPartners(Array.isArray(data?.partners) ? data.partners : []);
    } catch {
      setPartners([]);
    } finally {
      setLoading(false);
    }
  };

  const invite = async () => {
    setMessage(null);
    const ph = phone.trim();
    if (ph.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) });
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) throw new Error((data && data.error) || text || 'Ошибка');
      setPhone('');
      setMessage('Инвайт отправлен, данные обновлены');
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Партнёры</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="Телефон" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-56" />
        <Button onClick={invite} disabled={loading || phone.trim().length === 0}>{loading ? '...' : 'Пригласить'}</Button>
        <Input label="Поиск" placeholder="Телефон или ФИО" value={query} onChange={(e) => setQuery(e.target.value)} className="w-64" />
        <Button
          variant="ghost"
          onClick={async () => {
            setMessage(null);
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
      {message ? <div className="text-sm text-gray-600 dark:text-gray-300 mb-3">{message}</div> : null}
      <div className="overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="text-left px-3 py-2">Телефон</th>
              <th className="text-left px-3 py-2">ФИО</th>
              <th className="text-left px-3 py-2">Статус</th>
              <th className="text-left px-3 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-500">Нет партнёров</td>
              </tr>
            ) : filtered.map((p) => (
              <tr key={p.phone} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2">{p.phone}</td>
                <td className="px-3 py-2">{p.fio ?? '-'}</td>
                <td className="px-3 py-2">{p.status ?? '-'}</td>
                <td className="px-3 py-2">
                  <Link className="text-blue-600 hover:underline" href={`/dashboard/accept?agent=1&phone=${encodeURIComponent(p.phone)}`}>Создать оплату</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


