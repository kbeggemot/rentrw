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
      onClick={() => { if (!loading) setLoading(true); }}
    >
      {loading ? 'Сохраняю…' : label}
    </button>
  );
}


