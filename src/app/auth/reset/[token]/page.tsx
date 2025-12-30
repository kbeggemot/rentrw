'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/BrandMark';
import { postJsonWithGetFallback } from '@/lib/postFallback';

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || '');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password !== confirm) {
      setMsg('Пароли не совпадают');
      return;
    }
    const strongEnough = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
    if (!strongEnough) {
      setMsg('Пароль должен быть не короче 8 символов и содержать буквы и цифры');
      return;
    }
    setLoading(true);
    try {
      const res = await postJsonWithGetFallback('/api/auth/reset/confirm', { token, password });
      const t = await res.text();
      const d = t ? JSON.parse(t) : {};
      if (!res.ok) throw new Error(d?.error || t || 'ERROR');
      setMsg('Пароль обновлён. Теперь вы можете войти.');
      setTimeout(() => router.push('/auth'), 1200);
    } catch (e) {
      setMsg('Не удалось изменить пароль. Возможно, ссылка устарела.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm flex flex-col gap-3">
        <BrandMark />
        <h1 className="text-xl font-semibold mt-2">Смена пароля</h1>
        <Input label="Новый пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} passwordToggle required />
        <Input label="Повторите пароль" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} passwordToggle required />
        {msg ? <div className="text-sm text-gray-700 dark:text-gray-300">{msg}</div> : null}
        <Button type="submit" disabled={loading} fullWidth>{loading ? 'Сохраняю…' : 'Сохранить'}</Button>
      </form>
    </div>
  );
}


