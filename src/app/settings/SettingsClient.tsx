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
};

export default function SettingsClient({ initial }: { initial: SettingsPrefetch }) {
  const [currentMasked, setCurrentMasked] = useState<string | null>(initial.tokenMasked);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
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

  const [accountPhone, setAccountPhone] = useState<string | null>(initial.accountPhone);
  const [agentDesc, setAgentDesc] = useState(initial.agentDescription);
  const [agentType, setAgentType] = useState<'percent' | 'fixed'>(initial.defaultCommission?.type || 'percent');
  const [agentValue, setAgentValue] = useState(
    typeof initial.defaultCommission?.value === 'number' ? String(initial.defaultCommission.value) : ''
  );
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingAgentDesc, setSavingAgentDesc] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  // Only fetch keys again if initial was empty and we need to populate
  useEffect(() => {
    if (initial.keys.length > 0) return;
    (async () => {
      try {
        setKeysLoading(true);
        const res = await fetch('/api/auth/webauthn/list', { cache: 'no-store' });
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
      try { data = text ? (JSON.parse(text) as { token?: string; error?: string }) : null; } catch {}
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
        alert(e instanceof Error ? e.message : 'Ошибка WebAuthn');
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
      alert(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Настройки</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Текущий токен</label>
          <Input type="text" value={currentMasked ?? ''} readOnly placeholder="Токен не задан" />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={token.length === 0} loading={saving}>Сохранить</Button>
          <Input type="password" placeholder="Введите новый токен" value={token} onChange={(e) => setToken(e.target.value)} />
          {message ? (<div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>) : null}
        </div>

        <div className="pt-6">
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
                      setEmailPending(true);
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
                    setEmailPending(true);
                    setMessage('Код подтверждения отправлен на email');
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
        {emailMasked && !emailVerified ? (
          <div className="pt-3">
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
            </div>
            {emailPending ? <div className="text-xs text-gray-500 mt-1">Мы отправили код на ваш email.</div> : null}
            {emailMsg ? (
              <div className={`text-sm mt-2 ${emailMsgKind === 'error' ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>{emailMsg}</div>
            ) : null}
          </div>
        ) : null}
        {emailVerified ? (
          emailMsgKind === 'error' && emailMsg ? (
            <div className="text-sm text-red-600">{emailMsg}</div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">Email подтверждён</div>
          )
        ) : null}

        <div className="pt-6">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Учётная запись</label>
          <Input type="text" value={accountPhone ?? ''} readOnly placeholder="Нет данных" />
        </div>

        <div className="pt-6">
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
                  if (!r.ok) throw new Error('SAVE_FAILED');
                  setMessage('Описание сохранено');
                } catch {
                  setMessage('Не удалось сохранить описание');
                } finally {
                  setSavingAgentDesc(false);
                }
              }}
            >Сохранить описание</Button>
          </div>
        </div>

        <div className="pt-4">
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
            <Input type="number" step="0.01" placeholder={agentType === 'percent' ? '0' : '0.00'} value={agentValue} onChange={(e) => setAgentValue(e.target.value)} className="w-32" />
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
                } catch {
                  setMessage('Не удалось сохранить');
                } finally {
                  setSavingAgent(false);
                }
              }}
            >Сохранить</Button>
          </div>
        </div>

        <div className="pt-8">
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
  );
}


