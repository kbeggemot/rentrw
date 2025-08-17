"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { startRegistration as startWebAuthnReg, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';

export default function DashboardClient({ hasTokenInitial }: { hasTokenInitial: boolean }) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasToken] = useState<boolean>(hasTokenInitial);
  const [showOptOutModal, setShowOptOutModal] = useState(false);
  const [optOutChecked, setOptOutChecked] = useState(true);

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

  // Автопредложение добавить ключ сразу после входа
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flag = typeof window !== 'undefined' ? window.sessionStorage.getItem('postLoginPrompt') : null;
        if (!flag) return;
        window.sessionStorage.removeItem('postLoginPrompt');
        const supported = await browserSupportsWebAuthn();
        const platform = await platformAuthenticatorIsAvailable();
        if (!supported || !platform) return;
        const st = await fetch('/api/auth/webauthn/status', { cache: 'no-store' });
        if (!st.ok) return;
        const s = await st.json();
        if (s?.optOut || s?.hasAny) return;
        const init = await fetch('/api/auth/webauthn/register', { method: 'POST' });
        const { options, rpID, origin } = await init.json();
        if (cancelled) return;
        try {
          const attResp = await startWebAuthnReg(options);
          await fetch('/api/auth/webauthn/register', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: attResp, rpID, origin }) });
          try {
            const id = (attResp as any)?.id;
            if (typeof id === 'string' && id.length > 0) localStorage.setItem('passkeyId', id);
            localStorage.setItem('hasPasskey', '1');
            document.cookie = 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000';
          } catch {}
        } catch (e) {
          // Если пользователь отказался — покажем модалку с возможностью больше не предлагать
          const name = e && (e as any).name;
          const msg = (e && (e as any).message) ? String((e as any).message) : '';
          const isCancel = name === 'NotAllowedError' || name === 'AbortError' || /not allowed/i.test(msg) || /timed out/i.test(msg) || /aborted/i.test(msg) || /user.*cancel/i.test(msg);
          if (isCancel) { setShowOptOutModal(true); return; }
          console.warn('webauthn auto-prompt failed', e);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Касса</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Принимайте оплату быстро и удобно</p>
      </header>
      {hasToken === false ? (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Для начала работы укажите токен своей организации, полученный в Рокет Ворк.
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
                try { if (optOutChecked) await fetch('/api/auth/webauthn/optout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optOut: true }) }); } catch {}
                setShowOptOutModal(false);
              }}>Понятно</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


