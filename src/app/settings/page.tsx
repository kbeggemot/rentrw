"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { startRegistration as startWebAuthnReg, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';

function SettingsContent() {
  const [currentMasked, setCurrentMasked] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean>(false);
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailPending, setEmailPending] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailMsgKind, setEmailMsgKind] = useState<'info' | 'error'>('info');
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [agentDesc, setAgentDesc] = useState('');
  const [agentType, setAgentType] = useState<'percent' | 'fixed'>('percent');
  const [agentValue, setAgentValue] = useState('');
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingAgentDesc, setSavingAgentDesc] = useState(false);
  const [keys, setKeys] = useState<Array<{ id: string; counter: number }> | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysMsg, setKeysMsg] = useState<string | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const search = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings/token', { cache: 'no-store' });
        const data = await res.json();
        setCurrentMasked(data.token ?? null);
        // email загрузим отдельно
        try {
          const er = await fetch('/api/settings/email', { cache: 'no-store' });
          const ed = await er.json();
          setEmailMasked(ed?.email ?? null);
          setEmailVerified(Boolean(ed?.verified));
        } catch {}
        try {
          const ar = await fetch('/api/settings/account', { cache: 'no-store' });
          const ad = await ar.json();
          setAccountPhone(ad?.phone ?? null);
        } catch {}
        try {
          const sr = await fetch('/api/settings/agent', { cache: 'no-store' });
          const sd = await sr.json();
          if (typeof sd?.agentDescription === 'string') setAgentDesc(sd.agentDescription);
          if (sd?.defaultCommission?.type) setAgentType(sd.defaultCommission.type);
          if (typeof sd?.defaultCommission?.value === 'number') setAgentValue(String(sd.defaultCommission.value));
        } catch {}
        // загрузка ключей
        try {
          setKeysLoading(true);
          const kr = await fetch('/api/auth/webauthn/list', { cache: 'no-store' });
          const kd = await kr.json();
          if (!kr.ok) throw new Error(kd?.error || 'ERROR');
          setKeys(Array.isArray(kd?.items) ? kd.items : []);
        } catch (e) {
          setKeysMsg(e instanceof Error ? e.message : 'Ошибка');
          setKeys([]);
        } finally {
          setKeysLoading(false);
        }
        // Если пришли из меню (view=1) — показываем обзор (не режим ввода)
        const fromMenu = search.get('view') === '1';
        setEditing(fromMenu ? false : !data.token);
        setEmailEditing(false);
        if (fromMenu) {
          // очистим параметр, чтобы обновление страницы не зависело от него
          router.replace('/settings');
        }
      } catch {
        setCurrentMasked(null);
        setEditing(true);
      }
    };
    load();
  }, [search, router]);

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
      setEditing(false); // сразу показать обзор с заполненным инпутом
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
      try { localStorage.setItem('hasPasskey', '1'); } catch {}
      try { document.cookie = 'has_passkey=1; Path=/; SameSite=Lax; Max-Age=31536000'; } catch {}
      // обновить список ключей
      setKeysLoading(true);
      const kr = await fetch('/api/auth/webauthn/list', { cache: 'no-store' });
      const kd = await kr.json();
      setKeys(Array.isArray(kd?.items) ? kd.items : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка WebAuthn');
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
        {!editing ? (
          <>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Текущий токен</label>
              <Input type="text" value={currentMasked ?? ''} readOnly placeholder="Токен не задан" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setEditing(true); setToken(''); setMessage(null); }}
              >
                Изменить токен
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  setSaving(true);
                  setMessage(null);
                  try {
                    const res = await fetch('/api/settings/token', { method: 'DELETE' });
                    if (!res.ok) throw new Error('DELETE_FAILED');
                    setCurrentMasked(null);
                    setEditing(true);
                    setMessage('Токен удалён');
                  } catch {
                    setMessage('Не удалось удалить токен');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Удалить токен
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Новый токен</label>
              <Input
                type="password"
                placeholder="Введите новый токен"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-3 items-center">
              <Button type="submit" disabled={token.length === 0} loading={saving}>Сохранить</Button>
              {token.length > 0 ? (
                <Button type="button" variant="ghost" onClick={() => { setToken(''); setMessage(null); }}>
                  Отмена
                </Button>
              ) : null}
            </div>
          </>
        )}
        {/* Always show email and account sections, regardless of token state */}
        <div className="pt-6">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
          {!emailEditing ? (
            <div className="flex items-center gap-3">
              <Input type="text" value={emailMasked ?? ''} readOnly placeholder="Не указан" />
              <Button type="button" variant="secondary" onClick={() => { setEmailEditing(true); setEmailValue(''); setMessage(null); }}>
                Изменить e-mail
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
                    setEmailMsg(/MASKED_EMAIL/.test(msg) ? 'E-mail указан как маска. Нажмите “Изменить e-mail” и введите полный адрес.' : 'Не удалось отправить код');
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
                    if (!r.ok) throw new Error(d?.error || t || 'Ошибка сохранения e-mail');
                    setEmailMasked(d?.email ?? null);
                    setEmailEditing(false);
                    setEmailValue('');
                    setEmailPending(true);
                    setMessage('Код подтверждения отправлен на e-mail');
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
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Подтверждение e-mail</label>
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
                    setMessage('E-mail подтверждён');
                  } catch (e) {
                    setEmailMsgKind('error');
                    const raw = e instanceof Error ? e.message : 'Ошибка';
                    let friendly = raw;
                    if (/^INVALID_CODE$/i.test(raw)) friendly = 'Код указан неверно';
                    else if (/^EXPIRED$/i.test(raw)) friendly = 'Срок действия кода истёк';
                    else if (/^NO_PENDING$/i.test(raw)) friendly = 'Код не запрашивался или уже использован';
                    else if (/^INVALID_EMAIL$/i.test(raw)) friendly = 'Некорректный e-mail';
                    setEmailMsg(friendly);
                  } finally {
                    setSavingEmail(false);
                  }
                }}
              >Подтвердить</Button>
            </div>
            {emailPending ? <div className="text-xs text-gray-500 mt-1">Мы отправили код на ваш e-mail.</div> : null}
            {emailMsg ? (
              <div className={`text-sm mt-2 ${emailMsgKind === 'error' ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>{emailMsg}</div>
            ) : null}
          </div>
        ) : null}
        {emailVerified ? (
          emailMsgKind === 'error' && emailMsg ? (
            <div className="text-sm text-red-600">{emailMsg}</div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">E-mail подтверждён</div>
          )
        ) : null}
        <div className="pt-6">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Учётная запись</label>
          <Input type="text" value={accountPhone ?? ''} readOnly placeholder="Нет данных" />
        </div>
        <div className="pt-6">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание ваших услуг, как Агента</label>
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
                    <div className="text-xs text-gray-500">counter: {k.counter}</div>
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

        {message ? <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div> : null}
      </form>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}


