"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { startRegistration as startWebAuthnReg, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';

export default function DashboardClient({ hasTokenInitial }: { hasTokenInitial: boolean }) {
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceRaw, setBalanceRaw] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasToken, setHasToken] = useState<boolean>(hasTokenInitial);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPendingTask, setWithdrawPendingTask] = useState<string | number | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDone, setWithdrawDone] = useState(false);
  const [history, setHistory] = useState<Array<{ taskId: string | number; amountRub: number; status?: string | null; createdAt: string; paidAt?: string | null }>>([]);
  const [showOptOutModal, setShowOptOutModal] = useState(false);
  const [optOutChecked, setOptOutChecked] = useState(true);
  // Toast notification
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info'; actionLabel?: string; actionHref?: string } | null>(null);
  // History UI: spoiler + pagination
  const [historyOpen, setHistoryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const paged = useMemo(() => history.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), [history, page]);
  const totalPages = Math.max(1, Math.ceil(history.length / pageSize));

  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info', actionLabel?: string, actionHref?: string) => {
    setToast({ msg, kind, actionLabel, actionHref });
    // auto-hide after 3s
    setTimeout(() => setToast(null), 3000);
  };

  // Permalinks state
  const [links, setLinks] = useState<Array<{ code: string; title: string; createdAt?: string }>>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkDesc, setLinkDesc] = useState('');
  const [linkSumMode, setLinkSumMode] = useState<'custom' | 'fixed'>('custom');
  const [linkAmount, setLinkAmount] = useState('');
  const [linkVat, setLinkVat] = useState<'none' | '0' | '10' | '20'>('none');
  const [linkAgent, setLinkAgent] = useState(false);
  const [linkCommType, setLinkCommType] = useState<'percent' | 'fixed'>('percent');
  const [linkCommVal, setLinkCommVal] = useState('');
  const [linkPartner, setLinkPartner] = useState('');
  const [linkMethod, setLinkMethod] = useState<'any' | 'qr' | 'card'>('any');

  // Sync with server-provided flag if it changes across navigations
  useEffect(() => { setHasToken(hasTokenInitial); }, [hasTokenInitial]);

  // Additional client-side confirmation to avoid stale SSR (no-store)
  // Не делаем авто‑refresh токена на монтировании.

  const fetchBalance = async (): Promise<number | null> => {
    setLoading(true);
    setBalance(null);
    try {
      const res = await fetch('/api/rocketwork/account', { cache: 'no-store' });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || 'Ошибка запроса');
      const amount: number | undefined = data?.balance;
      if (typeof amount === 'number') {
        setBalanceRaw(amount);
        setBalance(new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount));
        return amount;
      } else {
        setBalance('Нет данных');
        return null;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ошибка';
      setBalance(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const refreshHistory = async () => {
    try {
      const r = await fetch('/api/rocketwork/withdrawals', { cache: 'no-store' });
      const d = await r.json();
      const arr: Array<{ taskId: string | number; amountRub: number; status?: string | null; createdAt: string; paidAt?: string | null }> = Array.isArray(d?.items) ? d.items : [];
      setHistory(arr);
      setPage(1);
      // Дополнительно: вручную обновим статусы для всех не финальных записей
      const isFinal = (s: any) => {
        const st = String(s || '').toLowerCase();
        return st === 'paid' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'refunded';
      };
      const active = arr.filter((x) => !isFinal(x.status));
      if (active.length > 0) {
        await Promise.allSettled(active.map((x) => fetch(`/api/rocketwork/withdrawal-status/${encodeURIComponent(String(x.taskId))}`, { cache: 'no-store' })));
        const r2 = await fetch('/api/rocketwork/withdrawals', { cache: 'no-store' });
        const d2 = await r2.json();
        setHistory(Array.isArray(d2?.items) ? d2.items : []);
      }
    } catch {
      setHistory([]);
    }
  };

  const refreshLinks = async () => {
    try {
      const r = await fetch('/api/links', { cache: 'no-store' });
      const d = await r.json();
      if (Array.isArray(d?.items)) setLinks(d.items.map((x: any) => ({ code: x.code, title: x.title, createdAt: x.createdAt })));
    } catch {}
  };

  // On mount: load history and restore pending task (for spinner) if any
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/rocketwork/withdrawals', { cache: 'no-store' });
        const d = await r.json();
        const items = Array.isArray(d?.items) ? d.items : [];
        setHistory(items);
        const isFinal = (s: any) => {
          const st = String(s || '').toLowerCase();
          return st === 'paid' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'refunded';
        };
        const active = items.find((it: any) => !isFinal(it?.status));
        if (active && active.taskId) setWithdrawPendingTask(active.taskId);
        // Fallback to localStorage state if server store is empty yet
        try {
          const ls = localStorage.getItem('pendingWithdrawalTask');
          if (!active && ls) {
            // verify it's still active before showing spinner
            try {
              const st = await fetch(`/api/rocketwork/withdrawal-status/${encodeURIComponent(ls)}`, { cache: 'no-store' });
              const d2 = await st.json();
              const status = String(d2?.status || '').toLowerCase();
              if (status && status !== 'paid' && status !== 'error') setWithdrawPendingTask(ls);
              else { try { localStorage.removeItem('pendingWithdrawalTask'); } catch {} }
            } catch {}
          }
        } catch {}
      } catch {}
    })();
  }, []);

  // Load permanent links on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/links', { cache: 'no-store' });
        const d = await r.json();
        if (Array.isArray(d?.items)) setLinks(d.items.map((x: any) => ({ code: x.code, title: x.title, createdAt: x.createdAt })));
      } catch {}
    })();
  }, []);

  // Centralized polling for current pending task (persists across reloads) with backoff
  const pollingRef = useRef<number | null>(null);
  useEffect(() => {
    if (!withdrawPendingTask || withdrawDone) return;
    if (pollingRef.current) return;
    let cancelled = false;
    let tries = 0;
    const startDelay = 2000; // 2s
    const maxDelay = 60000; // 60s cap

    const schedule = (delay: number) => {
      if (cancelled) return;
      pollingRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        tries += 1;
        try {
          const st = await fetch(`/api/rocketwork/withdrawal-status/${encodeURIComponent(String(withdrawPendingTask))}`, { cache: 'no-store' });
          const d2 = await st.json();
          if (d2?.done) {
            if (pollingRef.current) { window.clearTimeout(pollingRef.current); pollingRef.current = null; }
            setWithdrawDone(true);
            setWithdrawPendingTask(null);
            try { localStorage.removeItem('pendingWithdrawalTask'); } catch {}
            await fetchBalance();
            await refreshHistory();
            showToast('Вывод завершён. Баланс обновлён.', 'success');
            setWithdrawAmount('');
            return;
          }
          // If RW returned error status, show toast and stop polling
          if (String(d2?.status || '').toLowerCase() === 'error') {
            if (pollingRef.current) { window.clearTimeout(pollingRef.current); pollingRef.current = null; }
            setWithdrawPendingTask(null);
            await refreshHistory();
            showToast('Вывод отклонён. Недостаточно средств на счёте', 'error');
            return;
          }
        } catch {}
        const nextDelay = Math.min(maxDelay, Math.round(startDelay * Math.pow(1.5, tries)));
        schedule(nextDelay);
      }, delay) as unknown as number;
    };
    schedule(startDelay);
    return () => {
      cancelled = true;
      if (pollingRef.current) { window.clearTimeout(pollingRef.current); pollingRef.current = null; }
    };
  }, [withdrawPendingTask, withdrawDone]);

  // Автопредложение добавить ключ сразу после входа (отложим на тик после first paint)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
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
        // Если ключи уже есть на аккаунте — синхронизируем локальный passkeyId и cookie и выходим
        if (s?.hasAny) {
          try {
            const hasIdLocal = typeof window !== 'undefined' ? localStorage.getItem('passkeyId') : null;
            if (!hasIdLocal) {
              const lr = await fetch('/api/auth/webauthn/list', { cache: 'no-store' });
              const ld = await lr.json();
              const firstId = Array.isArray(ld?.items) && ld.items.length > 0 ? ld.items[0]?.id : null;
              if (firstId) {
                try { localStorage.setItem('passkeyId', firstId); localStorage.setItem('hasPasskey', '1'); document.cookie = 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000'; } catch {}
              }
            }
          } catch {}
          return;
        }
        if (s?.optOut) return;
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
    };
    // слегка откладываем, чтобы не тормозить TTI
    const t = setTimeout(() => { if (!cancelled) run(); }, 300);
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <header className="mb-4">
        <h1 className="hidden md:block text-2xl font-bold">Касса</h1>
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
          </div>

          {/* Permanent links block */}
          <div className="mt-4">
            <Button
              variant="secondary"
              className="text-base w-full"
              fullWidth
              onClick={() => setLinkOpen((v) => !v)}
            >
              Создать постоянную ссылку на оплату
            </Button>
            {linkOpen ? (
              <div className="mt-3 border rounded-lg p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Название платежной ссылки</label>
                    <input className="w-full rounded-lg border px-2 h-9 text-sm" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">НДС</label>
                    <select className="w-40 rounded-lg border px-2 h-9 text-sm" value={linkVat} onChange={(e) => setLinkVat(e.target.value as any)}>
                      <option value="none">Без НДС</option>
                      <option value="0">0%</option>
                      <option value="10">10%</option>
                      <option value="20">20%</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Сумма</label>
                    <div className="flex items-center gap-2">
                      <select className="rounded-lg border px-2 h-9 text-sm" value={linkSumMode} onChange={(e) => setLinkSumMode(e.target.value as any)}>
                        <option value="custom">Укажет покупатель</option>
                        <option value="fixed">Фиксированная</option>
                      </select>
                      {linkSumMode === 'fixed' ? (
                        <input className="w-40 rounded-lg border px-2 h-9 text-sm" value={linkAmount} onChange={(e) => setLinkAmount(e.target.value)} placeholder="0.00" />
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Тип оплаты</label>
                    <select className="w-40 rounded-lg border px-2 h-9 text-sm" value={linkMethod} onChange={(e) => setLinkMethod(e.target.value as any)}>
                      <option value="any">Любой</option>
                      <option value="qr">СБП</option>
                      <option value="card">Карта</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-700 mb-1">Описание услуги</label>
                    <textarea className="w-full rounded-lg border px-2 py-2 text-sm" rows={2} value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={linkAgent} onChange={(e) => setLinkAgent(e.target.checked)} />
                      <span>Агентская продажа</span>
                    </label>
                    {linkAgent ? (
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <select className="rounded-lg border px-2 h-9 text-sm" value={linkCommType} onChange={(e) => setLinkCommType(e.target.value as any)}>
                          <option value="percent">%</option>
                          <option value="fixed">₽</option>
                        </select>
                        <input className="w-32 rounded-lg border px-2 h-9 text-sm" placeholder="Комиссия" value={linkCommVal} onChange={(e) => setLinkCommVal(e.target.value)} />
                        <input className="w-56 rounded-lg border px-2 h-9 text-sm" placeholder="Телефон партнёра" value={linkPartner} onChange={(e) => setLinkPartner(e.target.value)} />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  <Button
                    onClick={async () => {
                      try {
                        const payload: any = { title: linkTitle.trim(), description: linkDesc.trim(), sumMode: linkSumMode, amountRub: linkSumMode === 'fixed' ? Number(linkAmount.replace(',', '.')) : undefined, vatRate: linkVat, isAgent: linkAgent, commissionType: linkAgent ? linkCommType : undefined, commissionValue: linkAgent ? Number(linkCommVal.replace(',', '.')) : undefined, partnerPhone: linkAgent ? linkPartner.trim() : undefined, method: linkMethod };
                        const r = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d?.error || 'ERROR');
                        showToast('Ссылка создана', 'success');
                        setLinks((prev) => [{ code: d?.item?.code, title: d?.item?.title, createdAt: d?.item?.createdAt }, ...prev]);
                        setLinkTitle(''); setLinkDesc(''); setLinkAmount(''); setLinkAgent(false); setLinkCommVal(''); setLinkPartner(''); setLinkSumMode('custom'); setLinkVat('none'); setLinkMethod('any');
                      } catch (e) { showToast('Не удалось создать ссылку', 'error'); }
                    }}
                  >Сохранить</Button>
                </div>
              </div>
            ) : null}

            {/* Spoiler for the links list */}
            <div className="mt-3">
              <button type="button" className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-between" onClick={async () => { const next = !linksOpen; setLinksOpen(next); if (next && links.length === 0) { await refreshLinks(); } }}>
                <span className="text-base font-semibold">Мои постоянные ссылки</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${linksOpen ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {linksOpen ? (
                <div className="mt-2">
                  {links.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-500 border rounded-md bg-white dark:bg-gray-950">Ссылок нет</div>
                  ) : (
                    <div className="space-y-2">
                      {links.map((l) => (
                        <div key={l.code} className="flex items-center justify-between border rounded px-3 py-2">
                          <div className="text-sm"><a className="text-blue-600 hover:underline" href={`/link/${encodeURIComponent(l.code)}`} target="_blank" rel="noreferrer">{l.title || l.code}</a></div>
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" size="icon" onClick={async () => { try { await navigator.clipboard.writeText(new URL(`/link/${encodeURIComponent(l.code)}`, window.location.origin).toString()); showToast('Ссылка скопирована', 'success'); } catch {} }}>⧉</Button>
                            <Button variant="secondary" size="icon" onClick={async () => { if (!confirm('Удалить ссылку?')) return; try { await fetch(`/api/links/${encodeURIComponent(l.code)}`, { method: 'DELETE' }); setLinks((prev) => prev.filter((x) => x.code !== l.code)); } catch {} }}>🗑</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Деньги</h2>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <Button className="text-base" variant="secondary" onClick={fetchBalance} disabled={loading}>
                {loading ? 'Загружаю…' : 'Показать баланс'}
              </Button>
              {balance !== null ? (
                <div className="text-sm text-gray-800 dark:text-gray-200">Баланс: {balance}</div>
              ) : null}
            </div>
            <div className="flex items-end gap-3 max-w-md">
              <div className="flex-1">
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма к выводу (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 h-9 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                loading={withdrawing}
                disabled={withdrawing || Boolean(withdrawPendingTask)}
                onClick={async () => {
                  // Always refresh balance first and use the returned value to avoid stale state
                  const fresh = await fetchBalance();
                  const amountNum = Number(withdrawAmount.replace(',', '.'));
                  const bal = (fresh != null ? fresh : (balanceRaw ?? 0));
                  if (!Number.isFinite(amountNum) || amountNum <= 0) { showToast('Укажите сумму больше 0', 'error'); return; }
                  if (amountNum > bal) { showToast('Сумма вывода больше доступного баланса', 'error'); return; }
                  setWithdrawing(true);
                  try {
                    const res = await fetch('/api/rocketwork/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Withdrawal', amountRub: amountNum }) });
                    const d = await res.json();
                    if (!res.ok) throw new Error(d?.error || 'Ошибка вывода');
                    if (d?.error === 'WITHDRAWAL_IN_PROGRESS') { showToast('Уже есть незавершённый вывод. Дождитесь завершения.', 'error'); return; }
                    const taskId = d?.task_id;
                    setWithdrawPendingTask(taskId ?? '');
                    try { if (taskId) localStorage.setItem('pendingWithdrawalTask', String(taskId)); } catch {}
                  } catch (e) {
                    const raw = e instanceof Error ? e.message : 'ERROR';
                    if (raw === 'NO_PAYOUT_REQUISITES') {
                      showToast('Укажите БИК и номер счёта в настройках', 'error', 'Открыть настройки', '/settings');
                    } else if (raw === 'NO_INN') {
                      showToast('В аккаунте Рокет Ворк не найден ИНН организации', 'error');
                    } else if (raw === 'NO_TOKEN') {
                      showToast('Не задан токен API. Укажите токен в настройках', 'error', 'Открыть настройки', '/settings');
                    } else {
                      showToast('Ошибка вывода', 'error');
                    }
                  } finally {
                    setWithdrawing(false);
                  }
                }}
              >Вывести</Button>
            </div>

            {withdrawPendingTask ? (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Ждём завершения вывода…
              </div>
            ) : null}
            {/* success toast shown separately */}

            <div className="mt-6">
              <button type="button" className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-between" onClick={async () => { const next = !historyOpen; setHistoryOpen(next); if (next && history.length === 0) { await refreshHistory(); } }}>
                <span className="text-base font-semibold">История выводов</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${historyOpen ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {historyOpen ? (
                <>
                  <div className="flex items-center justify-between mb-2 mt-2">
                    <div />
                    <Button variant="ghost" onClick={async () => { await refreshHistory(); showToast('История обновлена', 'info'); }}>Обновить</Button>
                  </div>
                  <div className="overflow-x-auto bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="text-left px-3 py-2">№</th>
                          <th className="text-left px-3 py-2">Сумма</th>
                          <th className="text-left px-3 py-2">Статус</th>
                          <th className="text-left px-3 py-2">Создан</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-gray-500">Нет данных</td>
                          </tr>
                        ) : paged.map((h) => (
                          <tr key={String(h.taskId)} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-2">{String(h.taskId)}</td>
                            <td className="px-3 py-2">{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(h.amountRub)}</td>
                            <td className="px-3 py-2">{h.status ?? '-'}</td>
                            <td className="px-3 py-2">{new Date(h.createdAt).toLocaleString('ru-RU')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-gray-500">Стр. {page} из {totalPages}</div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Назад</Button>
                      <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Вперёд</Button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
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
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm flex items-center gap-3 ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
          <div>{toast.msg}</div>
          {toast.actionHref ? (
            <a href={toast.actionHref} className="underline font-medium hover:opacity-90 whitespace-nowrap">{toast.actionLabel || 'Открыть'}</a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


