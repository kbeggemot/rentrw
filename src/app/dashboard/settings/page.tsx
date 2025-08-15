'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Passkey = { id: string; counter: number };

export default function SettingsPage() {
	const [currentMasked, setCurrentMasked] = useState<string | null>(null);
	const [token, setToken] = useState('');
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [keys, setKeys] = useState<Passkey[] | null>(null);
	const [keysLoading, setKeysLoading] = useState(false);
	const [keysMsg, setKeysMsg] = useState<string | null>(null);

	useEffect(() => {
		const load = async () => {
			try {
				const res = await fetch('/api/settings/token', { cache: 'no-store' });
				const data = await res.json();
				setCurrentMasked(data.token ?? null);
			} catch {
				setCurrentMasked(null);
			}
		};
		load();
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
			let data: { token?: string; error?: string } | null = null;
			try {
				data = text ? (JSON.parse(text) as { token?: string; error?: string }) : null;
			} catch {}
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

	const loadKeys = async () => {
		setKeysLoading(true);
		setKeysMsg(null);
		try {
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
	};

	useEffect(() => {
		loadKeys();
	}, []);

	const removeKey = async (id: string) => {
		if (!confirm('Удалить выбранный ключ? Вы не сможете использовать его для входа.')) return;
		try {
			const res = await fetch(`/api/auth/webauthn/list?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error || 'Не удалось удалить ключ');
			setKeys((prev) => (prev || []).filter((k) => k.id !== id));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Ошибка');
		}
	};

	return (
		<div className="max-w-xl">
			<h1 className="text-2xl font-bold mb-4">Настройки</h1>
			<form onSubmit={submit} className="space-y-4">
				<div>
					<label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">API токен</label>
					<Input
						type="password"
						placeholder={currentMasked ?? 'Введите токен'}
						value={token}
						onChange={(e) => setToken(e.target.value)}
					/>
					<p className="text-xs text-gray-500 mt-1">Токен хранится зашифрованно и на фронте отображается скрытым.</p>
				</div>
				<Button type="submit" disabled={saving || token.length === 0}>Сохранить</Button>
				{message ? (
					<div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
				) : null}
			</form>

			<div className="mt-8">
				<h2 className="text-lg font-semibold mb-2">Ключи входа (Face ID / Touch ID)</h2>
				{keysLoading ? (
					<div className="text-sm text-gray-600 dark:text-gray-300">Загрузка…</div>
				) : keysMsg ? (
					<div className="text-sm text-red-600">{keysMsg}</div>
				) : (
					<div className="space-y-2">
						{(keys || []).length === 0 ? (
							<div className="text-sm text-gray-600 dark:text-gray-300">Ключи не найдены на этом аккаунте.</div>
						) : (
							(keys || []).map((k) => (
								<div key={k.id} className="flex items-center justify-between border border-gray-200 dark:border-gray-800 rounded px-3 py-2">
									<div className="text-sm break-all">
										<div className="font-mono text-xs text-gray-700 dark:text-gray-300">{k.id}</div>
										<div className="text-xs text-gray-500">counter: {k.counter}</div>
									</div>
									<Button type="button" variant="secondary" onClick={() => removeKey(k.id)}>Удалить</Button>
								</div>
							))
						)}
					</div>
				)}
			</div>
		</div>
	);
}


