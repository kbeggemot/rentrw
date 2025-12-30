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
  const [resendIn, setResendIn] = useState<number>(0);
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
    setResendIn(0);
    setIsRegister(false);
    setPhone('');
    setEmail('');
    setPassword('');
    setConfirm('');
    try { sessionStorage.removeItem('reg.pending'); } catch {}
  }, []);

  // Тикер обратного отсчёта для повторной отправки кода
  useEffect(() => {
    if (!isRegister || !awaitCode) return;
    if (resendIn <= 0) return;
    const t = setInterval(() => { setResendIn((s) => (s > 0 ? s - 1 : 0)); }, 1000);
    return () => clearInterval(t);
  }, [isRegister, awaitCode, resendIn]);

  // Определяем, показывать ли кнопку входа по биометрии (показываем сразу, если есть токен и ключ)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        if (getLocalOptOutIntent()) { if (!ignore) { setCanBioLogin(false); } return; }
        const supported = await browserSupportsWebAuthn();
        let platform = false;
        try { platform = await platformAuthenticatorIsAvailable(); } catch { platform = false; }
        // Наличие токена может быть недоступно до логина — ориентируемся на наличие ключа
        let hasToken = false;
        try {
          const r = await fetch('/api/settings/token', { cache: 'no-store', credentials: 'include' });
          const d = await r.json();
          hasToken = typeof d?.token === 'string';
        } catch { hasToken = true; }
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
          } else {
            // If we don't have a local keyId but server reports keys exist, still show button
            try {
              const st = await fetch('/api/auth/webauthn/status', { cache: 'no-store' });
              const s = await st.json();
              existsRemote = !!s?.hasAny;
            } catch {}
          }
          // Если пользователь включил глобальную отметку отказа, не показываем кнопку
          try {
            const st = await fetch('/api/auth/webauthn/status', { cache: 'no-store' });
            const s = await st.json();
            if (s?.optOut) { if (!ignore) setCanBioLogin(false); return; }
          } catch {}
        } catch {}
        // Показываем кнопку сразу, если есть токен, поддержка, и реальный ключ
        if (!ignore) setCanBioLogin(Boolean(supported && platform && keyId && existsRemote && !getLocalOptOutIntent()));
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
      const ok = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim());
      if (!ok) {
        setLoading(false);
        setPasswordError(null);
        setError('Укажите корректный email');
        return;
      }
    }
    try {
      const emailFlag = (typeof window !== 'undefined' && (window as any).__CFG__?.EMAIL_VER_REQ) ? '1' : (process.env.NEXT_PUBLIC_EMAIL_VERIFICATION_REQUIRED || '0');
      const endpoint = isRegister ? (emailFlag === '1' ? (awaitCode ? '/api/auth/register/confirm' : '/api/auth/register') : '/api/auth/register') : '/api/auth/login';
      // Client-side timeout + retry on NOT_LEADER (multi-instance) and AbortError
      let lastErr: unknown = null;
      let res: Response | null = null;
      let data: { error?: string } | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const controller = new AbortController();
        const t = window.setTimeout(() => controller.abort(), 20_000);
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(isRegister ? (endpoint.endsWith('/confirm') ? { phone, code: confirm.trim() } : { phone, password, email: email.trim() }) : { phone, password }),
            signal: controller.signal,
          });
          const text = await res.text();
          try { data = text ? (JSON.parse(text) as { error?: string }) : null; } catch { data = null; }
          if (res.status === 503 && data?.error === 'NOT_LEADER') {
            await new Promise((r) => setTimeout(r, 250 + attempt * 350));
            continue;
          }
          if (!res.ok) {
            // In some environments POST may be broken at ingress (504/5xx). For login we will try GET fallback below.
            if (!isRegister && endpoint === '/api/auth/login' && (res.status === 502 || res.status === 504 || res.status === 500)) break;
            throw new Error(data?.error || 'AUTH_ERROR');
          }
          break;
        } catch (e) {
          lastErr = e;
          if ((e as any)?.name === 'AbortError') {
            // For login we prefer switching to GET fallback rather than waiting multiple 20s POST attempts.
            if (!isRegister && endpoint === '/api/auth/login') break;
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 250 + attempt * 350));
              continue;
            }
          }
          throw e;
        } finally {
          try { window.clearTimeout(t); } catch {}
        }
      }

      // Hotfix fallback: in some environments POST can be unstable at ingress (504/timeouts), while GET works.
      // For login only (to avoid putting credentials in URL), try GET with Authorization: Basic.
      if (!isRegister && endpoint === '/api/auth/login') {
        if (!res || !res.ok) {
          const controller = new AbortController();
          const t = window.setTimeout(() => controller.abort(), 20_000);
          try {
            const basic = typeof window !== 'undefined' ? window.btoa(unescape(encodeURIComponent(`${phone}:${password}`))) : '';
            res = await fetch(endpoint + '?via=get', {
              method: 'GET',
              cache: 'no-store',
              headers: { Authorization: `Basic ${basic}` },
              signal: controller.signal,
            });
            const text = await res.text();
            try { data = text ? (JSON.parse(text) as { error?: string }) : null; } catch { data = null; }
            if (!res.ok) throw new Error(data?.error || 'AUTH_ERROR');
          } finally {
            try { window.clearTimeout(t); } catch {}
          }
        }
      }

      if (!res) throw (lastErr instanceof Error ? lastErr : new Error('AUTH_ERROR'));
      const requireEmail = emailFlag === '1';
      if (isRegister && requireEmail && !awaitCode) {
        // Перешли на шаг подтверждения
        setAwaitCode(true);
        setIsRegister(true);
        setResendIn(60);
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
      else if ((e as any)?.name === 'AbortError') setError('Таймаут запроса. Попробуйте ещё раз.');
      else setError('Ошибка. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
      <BrandMark size={160} />
      <h1 className="text-xl font-semibold mt-4 mb-1">{isRegister ? 'Регистрация' : 'Вход'}</h1>
      {/* helper text removed by request */}
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
        {isRegister && awaitCode ? (
          <div className="text-xs text-gray-600 dark:text-gray-400 -mt-2">
            {resendIn > 0 ? (
              <span>Можно отправить код повторно через {resendIn} с</span>
            ) : (
              <button type="button" className="text-foreground hover:underline" onClick={async () => {
                try {
                  setLoading(true);
                  await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password, email: email.trim() }) });
                  setResendIn(60);
                  setError('Мы отправили код на вашу почту. Проверьте входящие.');
                } catch {
                  setError('Не удалось отправить код. Попробуйте позже.');
                } finally {
                  setLoading(false);
                }
              }}>Отправить код ещё раз</button>
            )}
          </div>
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
                // Редирект обрабатывается текущей страницей; здесь ничего не делаем
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


