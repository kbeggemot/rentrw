'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function AuthForm() {
  const [isRegister, setIsRegister] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [awaitCode, setAwaitCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Restore pending registration state (in case of refresh)
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('reg.pending');
      if (pending) {
        const p = JSON.parse(pending) as { phone?: string; email?: string; awaitCode?: boolean };
        if (p.phone) setPhone(p.phone);
        if (p.email) setEmail(p.email);
        if (p.awaitCode) { setAwaitCode(true); setIsRegister(true); }
      }
    } catch {}
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPasswordError(null);
    // Простая валидация пароля на клиенте
    const strongEnough = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
    if (!strongEnough) {
      setLoading(false);
      setPasswordError('Пароль должен быть не короче 8 символов и содержать буквы и цифры');
      return;
    }
    if (isRegister && password !== confirm) {
      setLoading(false);
      setPasswordError('Пароли не совпадают');
      return;
    }
    if (isRegister && !awaitCode) {
      const ok = /.+@.+\..+/.test(email.trim());
      if (!ok) {
        setLoading(false);
        setPasswordError(null);
        setError('Укажите корректный e-mail');
        return;
      }
    }
    try {
      const endpoint = isRegister ? (awaitCode ? '/api/auth/register/confirm' : '/api/auth/register') : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isRegister ? (awaitCode ? { phone, code: confirm.trim() } : { phone, password, email: email.trim() }) : { phone, password }),
      });
      const text = await res.text();
      let data: { error?: string } | null = null;
      try { data = text ? (JSON.parse(text) as { error?: string }) : null; } catch {}
      if (!res.ok) throw new Error(data?.error || 'AUTH_ERROR');
      if (isRegister && !awaitCode) {
        // move to code step
        setAwaitCode(true);
        setIsRegister(true);
        try { sessionStorage.setItem('reg.pending', JSON.stringify({ phone, email: email.trim(), awaitCode: true })); } catch {}
        setError('Мы отправили код на вашу почту. Введите его, чтобы завершить регистрацию.');
        setPassword('');
        setConfirm('');
      } else {
        try { sessionStorage.removeItem('reg.pending'); } catch {}
        window.location.href = '/dashboard';
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AUTH_ERROR';
      if (msg === 'EMAIL_TAKEN') setError('Такой e-mail уже используется');
      else if (msg === 'USER_EXISTS') setError('Пользователь с таким телефоном уже существует');
      else if (msg === 'INVALID_CODE') setError('Неверный код подтверждения');
      else setError('Ошибка. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
      <BrandMark />
      <h1 className="text-xl font-semibold mt-4 mb-1">{isRegister ? 'Регистрация' : 'Вход'}</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Введите номер телефона и пароль</p>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {(!isRegister || (isRegister && !awaitCode)) ? (
          <Input
            label="Телефон"
            type="tel"
            inputMode="tel"
            placeholder="+7 900 000-00-00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        ) : null}
        {isRegister && !awaitCode ? (
          <Input
            label="E-mail"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        ) : null}
        {(!isRegister || (isRegister && !awaitCode)) ? (
          <Input
            label="Пароль"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            passwordToggle
            required
          />
        ) : null}
        {passwordError ? (
          <div className="text-xs text-red-600" role="alert">
            {passwordError}
          </div>
        ) : null}
        {isRegister && !awaitCode ? (
          <Input
            label="Повторите пароль"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            passwordToggle
            required
          />
        ) : null}
        {isRegister && awaitCode ? (
          <Input
            label="Код из письма"
            type="text"
            placeholder="000000"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        ) : null}
        {error ? (
          <div className="text-sm text-red-600" role="alert">
            {error}
          </div>
        ) : null}
        <Button type="submit" disabled={loading} fullWidth>
          {loading ? 'Подождите…' : isRegister ? 'Зарегистрироваться' : 'Войти'}
        </Button>
      </form>
      <div className="mt-4 text-sm flex items-center justify-between">
        <button onClick={() => setIsRegister((v) => !v)} className="text-foreground/80 hover:underline">
          {isRegister ? 'У меня уже есть аккаунт' : 'Создать аккаунт'}
        </button>
        <button
          className="text-foreground/80 hover:underline"
          type="button"
          onClick={async () => {
            if (!phone) {
              setError('Введите телефон для сброса пароля');
              return;
            }
            setLoading(true);
            setError(null);
            try {
              await fetch('/api/auth/reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim() }) });
              setError(null);
              alert('Письмо с инструкциями отправлено на почту');
            } catch {
              // Всегда показываем одинаковый результат
              alert('Письмо с инструкциями отправлено на почту');
            } finally {
              setLoading(false);
            }
          }}
        >
          Забыли пароль?
        </button>
      </div>
    </div>
  );
}


