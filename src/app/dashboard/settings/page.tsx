'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function SettingsPage() {
  const [currentMasked, setCurrentMasked] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings/token', { cache: 'no-store' });
        const data = await res.json();
        setCurrentMasked(data.token ?? null);
      } catch {
        setCurrentMasked(null);
      }
    };
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const text = await res.text();
      let data: { token?: string; error?: string } | null = null;
      try {
        data = text ? (JSON.parse(text) as { token?: string; error?: string }) : null;
      } catch {}
      if (!res.ok) throw new Error(data?.error || text || 'Ошибка сохранения');
      setCurrentMasked(data?.token ?? null);
      setToken('');
      setMessage('Токен сохранён');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка';
      setMessage(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">Настройки</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">API токен</label>
          <Input
            type="password"
            placeholder={currentMasked ?? 'Введите токен'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Токен хранится зашифрованно и на фронте отображается скрытым.</p>
        </div>
        <Button type="submit" disabled={saving || token.length === 0}>Сохранить</Button>
        {message ? (
          <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
        ) : null}
      </form>
    </div>
  );
}


