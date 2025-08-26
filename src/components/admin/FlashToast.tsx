"use client";

import { useEffect } from 'react';

function showToast(text: string, kind: 'success' | 'error' | 'info' = 'info') {
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

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function clearCookie(name: string, path: string = '/') {
  try { document.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=Lax`; } catch {}
}

export default function FlashToast() {
  useEffect(() => {
    const value = readCookie('flash');
    if (!value) return;
    // Clear cookie on all relevant paths
    clearCookie('flash', '/');
    clearCookie('flash', '/admin');
    clearCookie('flash', '/admin/sales');
    clearCookie('flash', '/admin/orgs');
    clearCookie('flash', '/admin/links');
    clearCookie('flash', '/admin/partners');
    if (value === 'SALE_SAVED' || value === 'LINK_SAVED' || value === 'ORG_SAVED' || value === 'PARTNER_SAVED' || value === 'OK') {
      showToast('Сохранено', 'success');
    } else {
      showToast(value, 'info');
    }
  }, []);
  return null;
}


