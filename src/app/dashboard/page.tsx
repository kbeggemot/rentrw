"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { startRegistration as startWebAuthnReg } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/Button';

export default function DashboardPage() {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [showBioCta, setShowBioCta] = useState<boolean>(false);
  const [bioProcessing, setBioProcessing] = useState<boolean>(false);

  useEffect(() => {
    let aborted = false;
    const check = async () => {
      try {
        const res = await fetch('/api/settings/token', { cache: 'no-store' });
        const data = await res.json();
        if (!aborted) setHasToken(!!data?.token);
        // Проверяем, нужен ли показ CTA. Сам вызов WebAuthn требует пользовательский жест
        try {
          const st = await fetch('/api/auth/webauthn/status', { cache: 'no-store' });
          if (st.ok) {
            const s = await st.json();
            // Проверяем доступность платформенного аутентификатора (Face ID / Touch ID)
            let uvpaa = false;
            try { uvpaa = await (window as any).PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() || false; } catch { uvpaa = false; }
            if (!s?.hasAny && uvpaa) setShowBioCta(true);
          }
        } catch {}
      } catch {
        if (!aborted) setHasToken(false);
      }
    };
    check();
    return () => { aborted = true; };
  }, []);

  const fetchBalance = async () => {
    setLoading(true);
    setBalance(null);
    try {
      const res = await fetch('/api/rocketwork/account', { cache: 'no-store' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || 'Ошибка запроса');
      const amount: number | undefined = data?.balance;
      if (typeof amount === 'number') {
        setBalance(new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount));
      } else {
        setBalance('Нет данных');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ошибка';
      setBalance(message);
    } finally {
      setLoading(false);
    }
  };

  const setupBiometry = async () => {
    setBioProcessing(true);
    try {
      const init = await fetch('/api/auth/webauthn/register', { method: 'POST' });
      const { options, rpID, origin } = await init.json();
      // Безопасная нормализация полей, если сервер по какой-то причине вернул бинарные.
      try {
        if (options?.challenge && typeof options.challenge !== 'string') {
          options.challenge = Buffer.from(options.challenge).toString('base64url');
        }
        if (options?.user?.id && typeof options.user.id !== 'string') {
          options.user.id = Buffer.from(options.user.id).toString('base64url');
        }
        if (Array.isArray(options?.excludeCredentials)) {
          options.excludeCredentials = options.excludeCredentials.map((c: any) => ({
            ...c,
            id: typeof c.id === 'string' ? c.id : Buffer.from(c.id).toString('base64url'),
          }));
        }
      } catch {}
      const attResp = await startWebAuthnReg(options);
      await fetch('/api/auth/webauthn/register', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: attResp, rpID, origin }) });
      setShowBioCta(false);
      try {
        localStorage.setItem('hasPasskey', '1');
        const id = (attResp as any)?.id;
        if (typeof id === 'string' && id.length > 0) localStorage.setItem('passkeyId', id);
      } catch {}
      try { document.cookie = 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000'; } catch {}
    } catch (e) {
      const name = e && (e as any).name;
      if (name === 'NotAllowedError') {
        console.warn('webauthn register cancelled', e);
      } else {
        const msg = e instanceof Error ? `${e.name || 'Error'}: ${e.message}` : 'Ошибка WebAuthn';
        alert(`Не удалось подключить Face ID / Touch ID.\n${msg}`);
      }
    } finally {
      setBioProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Касса</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Принимайте оплату быстро и удобно</p>
        {/* Убрали CTA подключения Face ID / Touch ID с главной страницы */}
      </header>
      {hasToken === false ? (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Для начала работы укажите токен своей организации, полученный в Рокет Ворке.
          </p>
          <Link href="/settings" className="inline-block">
            <Button>Перейти в настройки</Button>
          </Link>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link href="/dashboard/accept" prefetch={false} className="w-full">
              <Button className="text-base w-full" fullWidth>
                Принять оплату
              </Button>
            </Link>
            <Button className="text-base" variant="secondary" onClick={fetchBalance} disabled={loading} fullWidth>
              {loading ? 'Загружаю…' : 'Показать баланс'}
            </Button>
          </div>
          {balance !== null ? (
            <div className="mt-4 text-sm text-gray-800 dark:text-gray-200">Баланс: {balance}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}


