"use client";

import { useState } from 'react';

export default function InstantResendLink(props: { userId: string | null | undefined; taskId: string | number | null | undefined }) {
  const userId = props.userId ? String(props.userId) : '';
  const taskId = props.taskId != null ? String(props.taskId) : '';
  const [loading, setLoading] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (loading) return;
    if (!confirm('Переотправить письмо выдачи?')) return;
    setLoading(true);
    try {
      const url = `/api/admin/actions/instant-resend?userId=${encodeURIComponent(userId)}&taskId=${encodeURIComponent(taskId)}`;
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      showToast(res.ok ? 'Письмо переотправлено' : 'Не удалось переотправить', res.ok);
    } catch {
      showToast('Не удалось переотправить', false);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string, ok: boolean) {
    const el = document.createElement('div');
    el.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  return (
    <button type="button" className="text-gray-500 hover:text-gray-700 underline ml-1 disabled:opacity-60" onClick={handleClick} disabled={loading}>
      (переотправить)
    </button>
  );
}


