'use client';

import Link from 'next/link';
import { startRegistration as startWebAuthnReg, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
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
  const [canBioLogin, setCanBioLogin] = useState(false);
  const [showOptOutModal, setShowOptOutModal] = useState(false);
  const [optOutChecked, setOptOutChecked] = useState(true);

  function getLocalOptOutIntent(): boolean {
    try { return localStorage.getItem('webauthn.optout.intent') === '1'; } catch { return false; }
  }
  function setLocalOptOutIntent(v: boolean) {
    try { if (v) localStorage.setItem('webauthn.optout.intent', '1'); else localStorage.removeItem('webauthn.optout.intent'); } catch {}
  }
  // duplicate state removed

  // На свежей загрузке / при переходе на страницу авторизации — сбрасываем любые промежуточные данные
  useEffect(() => {
    setAwaitCode(false);
    setIsRegister(false);
    setPhone('');
    setEmail('');
    setPassword('');
    setConfirm('');
    try { sessionStorage.removeItem('reg.pending'); } catch {}
  }, []);

  // Определяем, показывать ли кнопку входа по биометрии на этом устройстве
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        if (getLocalOptOutIntent()) { if (!ignore) { setCanBioLogin(false); } return; }
        const supported = await browserSupportsWebAuthn();
        let platform = false;
        try { platform = await platformAuthenticatorIsAvailable(); } catch { platform = false; }
        const keyId = typeof window !== 'undefined' ? window.localStorage?.getItem('passkeyId') : null;
        let existsRemote = false;
        try {
          if (keyId) {
            const r = await fetch(`/api/auth/webauthn/exists?id=${encodeURIComponent(keyId)}`, { cache: 'no-store' });
            const d = await r.json();
            existsRemote = !!d?.exists;
            if (!existsRemote) {
              try { window.localStorage.removeItem('passkeyId'); window.localStorage.removeItem('hasPasskey'); } catch {}
              try { document.cookie = 'has_passkey=; Path=/; Max-Age=0; SameSite=Lax'; } catch {}
            }
          }
          // Если пользователь включил глобальную отметку отказа, не показываем кнопку
          try {
            const st = await fetch('/api/auth/webauthn/status', { cache: 'no-store' });
            const s = await st.json();
            if (s?.optOut) { if (!ignore) setCanBioLogin(false); return; }
          } catch {}
        } catch {}
        // Показываем кнопку только если реально есть известный ключ на устройстве
        if (!ignore) setCanBioLogin(Boolean(supported && platform && keyId && existsRemote));
      } catch {
        if (!ignore) setCanBioLogin(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPasswordError(null);
    // Валидация пароля только на шаге ввода пароля (до отправки кода)
    if (isRegister && !awaitCode) {
      const strongEnough = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
      if (!strongEnough) {
        setLoading(false);
        setPasswordError('Пароль должен быть не короче 8 символов и содержать буквы и цифры');
        return;
      }
      if (password !== confirm) {
        setLoading(false);
        setPasswordError('Пароли не совпадают');
        return;
      }
      const ok = /.+@.+\..+/.test(email.trim());
      if (!ok) {
        setLoading(false);
        setPasswordError(null);
        setError('Укажите корректный email');
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
        // Сразу переходим в дашборд; предложение биометрии выполнится автоматически на дашборде
        try { sessionStorage.setItem('postLoginPrompt', '1'); } catch {}
        window.location.href = '/dashboard';
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AUTH_ERROR';
      if (msg === 'EMAIL_TAKEN') setError('Такой email уже используется');
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
            label="Email"
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
        <button onClick={() => { setIsRegister((v) => !v); setAwaitCode(false); try { sessionStorage.removeItem('reg.pending'); } catch {} }} className="text-foreground/80 hover:underline">
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
      {/* Кнопка входа по биометрии на экране логина */}
      {!isRegister && canBioLogin && (
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            fullWidth
            onClick={async () => {
              try {
                const ok = (await browserSupportsWebAuthn()) && (await platformAuthenticatorIsAvailable());
                if (!ok) { alert('Биометрия недоступна на этом устройстве'); return; }
                // Доп.проверка перед кликом: ключ ещё существует на сервере?
                try {
                  const keyId = typeof window !== 'undefined' ? window.localStorage?.getItem('passkeyId') : null;
                  if (keyId) {
                    const r = await fetch(`/api/auth/webauthn/exists?id=${encodeURIComponent(keyId)}`, { cache: 'no-store' });
                    const d = await r.json();
                    if (!d?.exists) {
                      try { window.localStorage.removeItem('hasPasskey'); window.localStorage.removeItem('passkeyId'); } catch {}
                      try { document.cookie = 'has_passkey=; Path=/; Max-Age=0; SameSite=Lax'; } catch {}
                      setCanBioLogin(false);
                      alert('Ключ входа удалён. Подключите Face ID / Touch ID заново в настройках.');
                      return;
                    }
                  }
                } catch {}
                const init = await fetch('/api/auth/webauthn/auth', { method: 'POST' });
                const { options, rpID, origin } = await init.json();
                try {
                  const toB64 = (v: any) => {
                    if (typeof v === 'string') return v;
                    if (v && ArrayBuffer.isView(v)) return Buffer.from(v as Uint8Array).toString('base64url');
                    if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v)).toString('base64url');
                    return v;
                  };
                  if (options?.challenge) options.challenge = toB64(options.challenge);
                  if (Array.isArray(options?.allowCredentials)) {
                    options.allowCredentials = options.allowCredentials.map((c: any) => ({
                      ...c,
                      id: toB64(c.id),
                      type: c.type || 'public-key',
                    }));
                  }
                } catch {}
                const assertion = await startAuthentication(options);
                const fin = await fetch('/api/auth/webauthn/auth', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: assertion, rpID, origin }) });
                if (!fin.ok) {
                  const t = await fin.text();
                  let msg = 'Не удалось выполнить вход по биометрии';
                  try {
                    const j = t ? JSON.parse(t) : null;
                    if (j?.error) msg += `\n${j.error}`;
                    if (j?.error === 'CRED_NOT_FOUND') {
                      try { window.localStorage.removeItem('hasPasskey'); window.localStorage.removeItem('passkeyId'); } catch {}
                      try { document.cookie = 'has_passkey=; Path=/; Max-Age=0; SameSite=Lax'; } catch {}
                      setCanBioLogin(false);
                    }
                  } catch {}
                  alert(msg);
                  return;
                }
                window.location.href = '/dashboard';
              } catch (e) {
                // Пользователь отменил системный диалог/таймаут → не шумим
                const name = e && (e as any).name;
                const msg = (e && (e as any).message) ? String((e as any).message) : '';
                const isCancel = name === 'NotAllowedError' || name === 'AbortError' || /not allowed/i.test(msg) || /timed out/i.test(msg) || /aborted/i.test(msg) || /user.*cancel/i.test(msg);
                if (isCancel) {
                  console.warn('webauthn cancelled', e);
                  // Предложим не показывать повторно
                  setShowOptOutModal(true);
                  return;
                }
                console.warn('webauthn login failed', e);
                const detail = e instanceof Error ? `${e.name || 'Error'}: ${e.message}` : '';
                alert(`Не удалось выполнить вход по биометрии${detail ? `\n${detail}` : ''}`);
              }
            }}
          >
            Войти по Face ID / Touch ID
          </Button>
        </div>
      )}
      {showOptOutModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-950 rounded-lg p-5 w-full max-w-md shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Биометрический вход</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">Этот способ можно подключить позже — в настройках.</p>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={optOutChecked} onChange={(e) => setOptOutChecked(e.target.checked)} />
              <span>Больше не предлагать подключение Face ID/Touch ID</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={async () => {
                try {
                  if (optOutChecked) {
                    const isLoggedIn = document.cookie.includes('session_user=');
                    if (isLoggedIn) {
                      await fetch('/api/auth/webauthn/optout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optOut: true }) });
                    } else {
                      setLocalOptOutIntent(true);
                    }
                  } else {
                    setLocalOptOutIntent(false);
                  }
                } catch {}
                setShowOptOutModal(false);
                if (optOutChecked) setCanBioLogin(false);
                if (pendingRedirect) { const to = pendingRedirect; setPendingRedirect(null); window.location.href = to; }
              }}>Понятно</Button>
            </div>
          </div>
        </div>
      )}
      {/* WebAuthn quick actions for authenticated session (registration of biometric key) */}
      {/* Кнопки биометрии специально скрыты на экране логина.
          Предложение добавления ключа выполнится автоматически сразу после успешного входа. */}
    </div>
  );
}


