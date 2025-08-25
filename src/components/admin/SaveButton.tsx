"use client";

import { useState } from 'react';

type Props = {
  label?: string;
  successText?: string;
  errorText?: string;
  className?: string;
};

export default function SaveButton({ label = 'Сохранить', successText = 'Сохранено', errorText = 'Ошибка сохранения', className = 'px-3 py-2 bg-gray-900 text-white rounded' }: Props) {
  const [loading, setLoading] = useState(false);

  function toast(text: string, kind: 'success' | 'error' | 'info' = 'info') {
    try {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.position = 'fixed';
      el.style.right = '12px';
      el.style.bottom = '12px';
      el.style.zIndex = '9999';
      el.style.padding = '10px 12px';
      el.style.borderRadius = '8px';
      el.style.color = kind === 'error' ? '#fff' : '#111';
      el.style.background = kind === 'error' ? '#ef4444' : (kind === 'success' ? '#86efac' : '#e5e7eb');
      el.style.boxShadow = '0 6px 20px rgba(0,0,0,.12)';
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch {} }, 2200);
    } catch {}
  }

  return (
    <button
      type="submit"
      disabled={loading}
      className={className + (loading ? ' opacity-70 cursor-not-allowed' : '')}
      onClick={async (e) => {
        e.preventDefault();
        if (loading) return;
        try {
          const btn = e.currentTarget as HTMLButtonElement;
          const form = btn.closest('form') as HTMLFormElement | null;
          if (!form) return;
          setLoading(true);
          const action = form.getAttribute('action') || form.action;
          const method = (form.getAttribute('method') || form.method || 'post').toUpperCase();
          const fd = new FormData(form);
          const controller = new AbortController();
          const timer = window.setTimeout(() => {
            try { controller.abort(); } catch {}
            // Надёжный фоллбек: нативная навигация (браузер сам последует редиректу)
            try { form.submit(); } catch { window.location.href = action; }
          }, 15000) as unknown as number;
          const res = await fetch(action, {
            method,
            body: fd,
            redirect: 'follow' as RequestRedirect,
            credentials: 'include',
            cache: 'no-store',
            keepalive: true,
            signal: controller.signal,
          });
          window.clearTimeout(timer);
          if (res.ok || (res.status >= 300 && res.status < 400) || res.status === 405) {
            toast(successText, 'success');
            // Follow redirect manually when possible
            const url = (res as any).url as string | undefined;
            if (url && url !== window.location.href) {
              window.location.href = url;
            } else {
              window.location.reload();
            }
          } else {
            let msg = errorText;
            try { const t = await res.text(); if (t) msg = `${errorText}: ${t.slice(0, 200)}`; } catch {}
            toast(msg, 'error');
            // Принудительно отправляем форму нативно, чтобы перейти по редиректу/увидеть серверную ошибку
            try { form.submit(); return; } catch { window.location.href = action; return; }
          }
        } catch {
          toast(errorText, 'error');
          // Фоллбек при исключении в fetch
          try {
            const btn = e.currentTarget as HTMLButtonElement;
            const form = btn.closest('form') as HTMLFormElement | null;
            if (form) { form.submit(); return; }
          } catch {}
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? 'Сохраняю…' : label}
    </button>
  );
}


