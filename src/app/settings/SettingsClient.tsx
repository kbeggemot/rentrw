"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { startRegistration as startWebAuthnReg, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';

type DefaultCommission = { type: 'percent' | 'fixed'; value: number } | null;
type Passkey = { id: string; counter: number };

export type SettingsPrefetch = {
  tokenMasked: string | null;
  emailMasked: string | null;
  emailVerified: boolean;
  accountPhone: string | null;
  agentDescription: string;
  defaultCommission: DefaultCommission;
  keys: Passkey[];
  payoutBik: string | null;
  payoutAccount: string | null;
  payoutOrgName: string | null;
};

export default function SettingsClient({ initial, userId }: { initial: SettingsPrefetch; userId?: string }) {
  const [currentMasked, setCurrentMasked] = useState<string | null>(initial.tokenMasked);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingToken, setDeletingToken] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [keys, setKeys] = useState<Passkey[] | null>(initial.keys);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysMsg, setKeysMsg] = useState<string | null>(null);

  const [emailMasked, setEmailMasked] = useState<string | null>(initial.emailMasked);
  const [emailVerified, setEmailVerified] = useState<boolean>(initial.emailVerified);
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailPending, setEmailPending] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailMsgKind, setEmailMsgKind] = useState<'info' | 'error'>('info');
  const [resendIn, setResendIn] = useState(0);

  const [accountPhone, setAccountPhone] = useState<string | null>(initial.accountPhone);
  const [agentDesc, setAgentDesc] = useState(initial.agentDescription);
  const [agentType, setAgentType] = useState<'percent' | 'fixed'>(initial.defaultCommission?.type || 'percent');
  const [agentValue, setAgentValue] = useState(
    typeof initial.defaultCommission?.value === 'number' ? String(initial.defaultCommission.value) : ''
  );
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingAgentDesc, setSavingAgentDesc] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  // payout requisites
  const [bik, setBik] = useState<string>(initial.payoutBik ?? '');
  const [account, setAccount] = useState<string>(initial.payoutAccount ?? '');
  const [savingPayout, setSavingPayout] = useState(false);
  const [orgName, setOrgName] = useState<string>(initial.payoutOrgName ?? '');
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3000); };

  // Local validation helpers for Russian bank requisites
  const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
  const isValidBik = (s: string) => onlyDigits(s).length === 9;
  const isValidAccount = (bikStr: string, accStr: string): boolean => {
    const bik = onlyDigits(bikStr);
    const acc = onlyDigits(accStr);
    if (bik.length !== 9 || acc.length !== 20) return false;
    const base = (bik.slice(-3) + acc).split('').map((d) => Number(d));
    if (base.length !== 23 || base.some((d) => Number.isNaN(d))) return false;
    const coeff: number[] = Array.from({ length: 23 }, (_, i) => [7, 1, 3][i % 3]);
    const sum = base.reduce((a, d, i) => a + d * coeff[i], 0);
    return sum % 10 === 0;
  };

  // Only fetch keys again if initial was empty and we need to populate
  useEffect(() => {
    if (initial.keys.length > 0) return;
    (async () => {
      try {
        setKeysLoading(true);
        const res = await fetch('/api/auth/webauthn/list', { cache: 'no-store', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки ключей');
        setKeys(Array.isArray(data?.items) ? data.items : []);
      } catch (e) {
        const m = e instanceof Error ? e.message : 'Ошибка';
        setKeysMsg(m);
      } finally {
        setKeysLoading(false);
      }
    })();
  }, [initial.keys.length]);

  // Hard-refresh critical settings only if SSR came empty; avoid email flip-flop
  useEffect(() => {
    const need = (
      currentMasked == null ||
      emailMasked == null ||
      accountPhone == null ||
      ((agentDesc ?? '').length === 0 && initial.defaultCommission == null) ||
      bik.length === 0 ||
      account.length === 0 ||
      orgName.length === 0
    );
    if (!need) return;
    (async () => {
      try {
        const [tRes, eRes, aRes, sRes, pRes] = await Promise.all([
          fetch('/api/settings/token', { cache: 'no-store', credentials: 'include' }),
          fetch('/api/settings/email', { cache: 'no-store', credentials: 'include' }),
          fetch('/api/settings/account', { cache: 'no-store', credentials: 'include' }),
          fetch('/api/settings/agent', { cache: 'no-store', credentials: 'include' }),
          fetch('/api/settings/payout', { cache: 'no-store', credentials: 'include' }),
        ]);
        // token
        try { const d = await tRes.json(); if (typeof d?.token === 'string' || d?.token === null) setCurrentMasked(d.token ?? null); } catch {}
        // email — use masked value from API, do not reveal full address client-side
        try { const d = await eRes.json(); if (typeof d?.email === 'string' || d?.email === null) setEmailMasked(d?.email ?? null); setEmailVerified(!!d?.verified); } catch {}
        // account
        try { const d = await aRes.json(); setAccountPhone(d?.phone ?? null); } catch {}
        // agent
        try {
          const d = await sRes.json();
          if (typeof d?.agentDescription === 'string') setAgentDesc(d.agentDescription);
          const dc = d?.defaultCommission as { type?: 'percent' | 'fixed'; value?: number } | undefined;
          if (dc && (dc.type === 'percent' || dc.type === 'fixed') && typeof dc.value === 'number') {
            setAgentType(dc.type);
            setAgentValue(String(dc.value));
          }
        } catch {}
        // payout
        try { const d = await pRes.json(); if (typeof d?.bik === 'string') setBik(d.bik); if (typeof d?.account === 'string') setAccount(d.account); if (typeof d?.orgName === 'string') setOrgName(d.orgName); } catch {}
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resend timer for email verification code
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // iOS Safari: verify WebAuthn status and force refresh keys if present
  useEffect(() => {
    (async () => {
      try {
        const sr = await fetch('/api/auth/webauthn/status', { cache: 'no-store', credentials: 'include' });
        const st = await sr.json();
        if (st?.hasAny) {
          try { localStorage.setItem('hasPasskey', '1'); } catch {}
          if (!Array.isArray(keys) || keys.length === 0) {
            const lr = await fetch('/api/auth/webauthn/list', { cache: 'no-store', credentials: 'include' });
            const ld = await lr.json();
            setKeys(Array.isArray(ld?.items) ? ld.items : []);
          }
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      let data: { token?: string; error?: string; inn?: string } | null = null;
      try { data = text ? (JSON.parse(text) as { token?: string; error?: string; inn?: string }) : null; } catch {}
      if (!res.ok) {
        const code = data?.error || text || 'ERROR';
        if (code === 'ORG_ALREADY_ADDED') {
          showToast('Эта организация уже добавлена', 'error');
          // переключение контекста уже произошло на сервере; мягко перезагрузим UI
          try { window.location.reload(); } catch {}
          return;
        }
        if (code === 'INVALID_TOKEN') throw new Error('Указан некорректный токен');
        if (code === 'TECH_ERROR') throw new Error('Техническая ошибка. Попробуйте ещё раз');
        throw new Error('Ошибка сохранения');
      }
      setCurrentMasked(data?.token ?? null);
      setToken('');
      setMessage('Токен сохранён');
      try { showToast('Токен сохранён', 'success'); } catch {}
      // Переключение на новую организацию — сервер уже выставил cookie; обновим страницу
      if (data?.inn) {
        try { window.location.reload(); } catch {}
      }
      // refresh payout org name after token save
      try {
        const pr = await fetch('/api/settings/payout', { cache: 'no-store' });
        const pd = await pr.json();
        if (typeof pd?.orgName === 'string') setOrgName(pd.orgName || '');
      } catch {}
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка';
      setMessage(message);
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteToken = async () => {
    setDeletingToken(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/token', { method: 'DELETE', credentials: 'include' });
      const t = await res.text();
      let d: any = null; try { d = t ? JSON.parse(t) : null; } catch {}
      if (!res.ok) throw new Error(d?.error || t || 'DELETE_FAILED');
      setCurrentMasked(null);
      setToken('');
      setMessage('Токен удалён');
      try { showToast('Токен удалён', 'success'); } catch {}
      setOrgName('');
      // Перезагрузим страницу, чтобы пересчитать серверные значения и баннеры в других разделах
      try { setTimeout(() => { window.location.reload(); }, 300); } catch {}
    } catch (e) {
      setMessage('Не удалось удалить токен');
      showToast('Не удалось удалить токен', 'error');
    } finally {
      setDeletingToken(false);
    }
  };

  const setupBiometry = async () => {
    setBioLoading(true);
    try {
      const supported = await browserSupportsWebAuthn();
      const platform = await platformAuthenticatorIsAvailable();
      if (!supported || !platform) throw new Error('Биометрия недоступна на этом устройстве');
      const init = await fetch('/api/auth/webauthn/register', { method: 'POST' });
      const { options, rpID, origin } = await init.json();
      const attResp = await startWebAuthnReg(options);
      const put = await fetch('/api/auth/webauthn/register', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: attResp, rpID, origin }) });
      if (!put.ok) throw new Error('Не удалось подключить Face ID / Touch ID');
      try {
        localStorage.setItem('hasPasskey', '1');
        const id = (attResp as any)?.id;
        if (typeof id === 'string' && id.length > 0) localStorage.setItem('passkeyId', id);
      } catch {}
      try { document.cookie = 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000'; } catch {}
      // обновить список ключей
      setKeysLoading(true);
      const kr = await fetch('/api/auth/webauthn/list', { cache: 'no-store' });
      const kd = await kr.json();
      setKeys(Array.isArray(kd?.items) ? kd.items : []);
    } catch (e) {
      const name = e && (e as any).name;
      if (name === 'NotAllowedError') {
        console.warn('webauthn register cancelled', e);
      } else {
        showToast(e instanceof Error ? e.message : 'Ошибка WebAuthn', 'error');
      }
    } finally {
      setBioLoading(false);
      setKeysLoading(false);
    }
  };

  const removeKey = async (id: string) => {
    if (!confirm('Удалить выбранный ключ?')) return;
    try {
      const res = await fetch(`/api/auth/webauthn/list?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Не удалось удалить ключ');
      const remain = typeof data?.remain === 'number' ? data.remain : undefined;
      setKeys((prev) => (prev || []).filter((k) => k.id !== id));
      if (remain === 0) {
        try { localStorage.removeItem('hasPasskey'); } catch {}
        try { document.cookie = 'has_passkey=; Path=/; Max-Age=0; SameSite=Lax'; } catch {}
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Ошибка', 'error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pt-0 pb-4">
      <h1 className="hidden md:block text-2xl font-bold mb-4">Настройки</h1>
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Токен Рокет Ворк</label>
          <div className="flex flex-col gap-3">
            {currentMasked ? (
              <div className="flex items-center gap-3">
                <Input type="text" value={currentMasked} readOnly className="min-w-[220px]" />
                <Button type="button" variant="secondary" loading={deletingToken} onClick={deleteToken}>Удалить токен</Button>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Input type="password" placeholder="Введите новый токен" value={token} onChange={(e) => setToken(e.target.value)} className="w-[320px] max-w-full" />
              <Button type="submit" disabled={token.length === 0} loading={saving}>{saving ? 'Сохраняю' : 'Сохранить'}</Button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Email</label>
          {!emailEditing ? (
            <div className="flex items-center gap-3">
              <Input type="text" value={emailMasked ?? ''} readOnly placeholder="Не указан" />
              <Button type="button" variant="secondary" onClick={() => { setEmailEditing(true); setEmailValue(''); setMessage(null); }}>
                Изменить email
              </Button>
              {emailMasked && !emailVerified ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    setSavingEmail(true);
                    setMessage(null);
                    setEmailMsg(null);
                    try {
                      // Re-send verification to saved full email on server (no masked email in payload)
                      const r = await fetch('/api/settings/email', { method: 'POST' });
                      if (!r.ok) throw new Error('SEND_FAILED');
                      setEmailVerified(false);
                      setEmailPending(true);
                      setResendIn(60);
                    } catch (e) {
                      setEmailMsgKind('error');
                      const msg = e instanceof Error ? e.message : 'SEND_FAILED';
                      setEmailMsg(/MASKED_EMAIL/.test(msg) ? 'Email указан как маска. Нажмите “Изменить email” и введите полный адрес.' : 'Не удалось отправить код');
                    } finally {
                      setSavingEmail(false);
                    }
                  }}
                >Отправить код</Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Input
                type="email"
                inputMode="email"
                pattern="^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
                placeholder="user@example.com"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                autoFocus
              />
              <Button
                type="button"
                loading={savingEmail}
                disabled={emailValue.trim().length === 0}
                onClick={async () => {
                  setSavingEmail(true);
                  setMessage(null);
                  try {
                    const r = await fetch('/api/settings/email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: emailValue.trim() }),
                    });
                    const t = await r.text();
                    const d = t ? JSON.parse(t) : {};
                    if (!r.ok) throw new Error(d?.error || t || 'Ошибка сохранения email');
                    setEmailMasked(d?.email ?? null);
                    setEmailEditing(false);
                    setEmailValue('');
                    setEmailVerified(false);
                    setEmailPending(true);
                    setResendIn(60);
                    setMessage('Код подтверждения отправлен на email');
                    try { showToast('Код подтверждения отправлен на email', 'success'); } catch {}
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : 'ERROR';
                    if (msg === 'EMAIL_TAKEN') {
                      setEmailMsgKind('error');
                      setEmailMsg('Такой e-mail уже используется');
                      setMessage(null);
                      setEmailEditing(false);
                    } else {
                      setMessage('Ошибка');
                    }
                  } finally {
                    setSavingEmail(false);
                  }
                }}
              >
                Сохранить
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setEmailEditing(false); setEmailValue(''); }}>
                Отмена
              </Button>
            </div>
          )}
        </div>
        {emailMasked && (!emailVerified || emailPending) ? (
          <div className="mt-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Подтверждение email</label>
            <div className="flex items-end gap-3">
              <Input
                type="text"
                placeholder="Код из письма"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                className="w-48"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={emailCode.trim().length === 0}
                onClick={async () => {
                  setSavingEmail(true);
                  setMessage(null);
                  setEmailMsg(null);
                  try {
                    const r = await fetch('/api/settings/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: emailCode.trim() }) });
                    const t = await r.text();
                    const d = t ? JSON.parse(t) : {};
                    if (!r.ok) throw new Error(d?.error || t || 'Ошибка подтверждения');
                    setEmailPending(false);
                    setEmailVerified(true);
                    setEmailCode('');
                    setMessage('Email подтверждён');
                    try { showToast('Email подтверждён', 'success'); } catch {}
                  } catch (e) {
                    setEmailMsgKind('error');
                    const raw = e instanceof Error ? e.message : 'Ошибка';
                    let friendly = raw;
                    if (/^INVALID_CODE$/i.test(raw)) friendly = 'Код указан неверно';
                    else if (/^EXPIRED$/i.test(raw)) friendly = 'Срок действия кода истёк';
                    else if (/^NO_PENDING$/i.test(raw)) friendly = 'Код не запрашивался или уже использован';
                    else if (/^INVALID_EMAIL$/i.test(raw)) friendly = 'Некорректный email';
                    setEmailMsg(friendly);
                  } finally {
                    setSavingEmail(false);
                  }
                }}
              >Подтвердить</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={resendIn > 0}
                onClick={async () => {
                  try {
                    const r = await fetch('/api/settings/email', { method: 'POST' });
                    if (!r.ok) throw new Error('SEND_FAILED');
                    setEmailVerified(false);
                    setEmailPending(true);
                    setResendIn(60);
                  } catch {
                    setEmailMsgKind('error');
                    setEmailMsg('Не удалось отправить код повторно');
                  }
                }}
              >{resendIn > 0 ? `Отправить повторно (${resendIn}с)` : 'Отправить повторно'}</Button>
            </div>
            {emailPending ? <div className="text-xs text-gray-500 mt-1">Мы отправили код на ваш email.</div> : null}
            {emailMsg ? (
              <div className={`text-sm mt-2 ${emailMsgKind === 'error' ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>{emailMsg}</div>
            ) : null}
          </div>
        ) : null}
        {emailVerified && !emailPending ? (
          emailMsgKind === 'error' && emailMsg ? (
            <div className="text-sm text-red-600">{emailMsg}</div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">Email подтверждён</div>
          )
        ) : null}

        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Учётная запись</label>
          <Input type="text" value={accountPhone ?? ''} readOnly placeholder="Нет данных" />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Реквизиты для вывода</h2>
          <div className="flex flex-col gap-3 max-w-md">
            <Input label="Наименование организации" value={orgName} readOnly placeholder="Будет заполнено автоматически после сохранения токена" />
            <Input label="БИК" placeholder="044525225" value={bik} onChange={(e) => setBik(e.target.value)} />
            <Input label="Номер счёта" placeholder="40702…" value={account} onChange={(e) => setAccount(e.target.value)} />
            <div>
              <Button type="button" variant="secondary" loading={savingPayout} onClick={async () => {
                setSavingPayout(true);
                try {
                  // Client-side validation first
                  const b = onlyDigits(bik);
                  const a = onlyDigits(account);
                  if (b.length !== 9) throw new Error('INVALID_BIK');
                  if (a.length !== 20) throw new Error('INVALID_ACC');
                  if (!isValidAccount(b, a)) throw new Error('INVALID_ACC_KEY');
                  const r = await fetch('/api/settings/payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bik, account }) });
                  const t = await r.text();
                  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch {}
                  if (!r.ok) throw new Error(d?.error || t || 'SAVE_FAILED');
                  if (d && typeof d.orgName === 'string') setOrgName(d.orgName || '');
                  setMessage('Реквизиты сохранены');
                  try { showToast('Реквизиты сохранены', 'success'); } catch {}
                } catch (e) {
                  const raw = e instanceof Error ? e.message : 'ERROR';
                  if (raw === 'INVALID_BIK') { setMessage('Введите корректный БИК (9 цифр)'); showToast('Введите корректный БИК (9 цифр)', 'error'); }
                  else if (raw === 'INVALID_ACC') { setMessage('Введите корректный номер счёта (20 цифр)'); showToast('Введите корректный номер счёта (20 цифр)', 'error'); }
                  else if (raw === 'INVALID_ACC_KEY') { setMessage('Некорректные реквизиты: неверный контрольный ключ счёта. Проверьте БИК и номер счёта.'); showToast('Неверный контрольный ключ счёта. Проверьте БИК и номер счёта.', 'error'); }
                  else if (raw === 'EXECUTOR_CREATE_FAILED') { setMessage('Не удалось подтвердить реквизиты в Рокет Ворк. Попробуйте позже.'); showToast('Не удалось подтвердить реквизиты в Рокет Ворк. Попробуйте позже.', 'error'); }
                  else { setMessage('Не удалось сохранить реквизиты'); showToast('Не удалось сохранить реквизиты', 'error'); }
                } finally {
                  setSavingPayout(false);
                }
              }}>Сохранить реквизиты</Button>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Агентские настройки</h2>
          <div className="mb-4">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание ваших услуг как агента</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground"
              rows={3}
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
            />
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                loading={savingAgentDesc}
                onClick={async () => {
                  setSavingAgentDesc(true);
                  try {
                    const r = await fetch('/api/settings/agent', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ agentDescription: agentDesc }),
                    });
                    const t = await r.text();
                    let d: any = null; try { d = t ? JSON.parse(t) : null; } catch {}
                    if (!r.ok) throw new Error('SAVE_FAILED');
                    if (typeof d?.agentDescription === 'string') setAgentDesc(d.agentDescription);
                    setMessage('Описание сохранено');
                    try { showToast('Описание сохранено', 'success'); } catch {}
                  } catch {
                    setMessage('Не удалось сохранить описание');
                  } finally {
                    setSavingAgentDesc(false);
                  }
                }}
              >Сохранить описание</Button>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Ваша стандартная агентская ставка</div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="agentType" value="percent" checked={agentType === 'percent'} onChange={() => setAgentType('percent')} />
                  <span>%</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="agentType" value="fixed" checked={agentType === 'fixed'} onChange={() => setAgentType('fixed')} />
                  <span>₽</span>
                </label>
              </div>
              <Input type="text" placeholder={agentType === 'percent' ? '0' : '0,00'} value={agentValue.replace('.', ',')} onChange={(e) => setAgentValue(e.target.value.replace(',', '.'))} className="w-32" />
              <Button
                type="button"
                variant="secondary"
                loading={savingAgent}
                onClick={async () => {
                  setSavingAgent(true);
                  try {
                    const payload = {
                      agentDescription: agentDesc,
                      defaultCommission: agentValue.trim().length > 0 ? { type: agentType, value: Number(agentValue) } : undefined,
                    };
                    const r = await fetch('/api/settings/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    if (!r.ok) throw new Error('SAVE_FAILED');
                    setMessage('Сохранено');
                    try { showToast('Настройки сохранены', 'success'); } catch {}
                  } catch {
                    setMessage('Не удалось сохранить');
                  } finally {
                    setSavingAgent(false);
                  }
                }}
              >Сохранить</Button>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Ключи входа (Face ID / Touch ID)</h2>
          {keysLoading ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">Загрузка…</div>
          ) : (keys && keys.length === 0) ? (
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">Ключи не найдены на этом аккаунте.</div>
              <Button type="button" variant="secondary" loading={bioLoading} onClick={setupBiometry}>Подключить</Button>
            </div>
          ) : keys ? (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between border border-gray-200 dark:border-gray-800 rounded px-3 py-2">
                  <div className="text-sm break-all">
                    <div className="font-mono text-xs text-gray-700 dark:text-gray-300">{k.id}</div>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => removeKey(k.id)}>Удалить</Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="secondary" loading={bioLoading} onClick={setupBiometry}>Добавить новый ключ</Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">Нет данных</div>
          )}
        </div>
      </form>
      </div>
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}


