"use client";

import { useEffect } from 'react';

export default function ActionLoader() {
  useEffect(() => {
    function ensureStyles() {
      if (document.getElementById('admin-action-loader-style')) return;
      const style = document.createElement('style');
      style.id = 'admin-action-loader-style';
      style.textContent = `
      #admin-action-progress{position:fixed;top:0;left:0;height:3px;width:0;background:#3b82f6;z-index:99999;transition:width .4s ease;}
      #admin-action-overlay{position:fixed;inset:0;pointer-events:none;z-index:99998}
      `;
      document.head.appendChild(style);
    }
    function showProgress() {
      ensureStyles();
      let bar = document.getElementById('admin-action-progress') as HTMLDivElement | null;
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'admin-action-progress';
        document.body.appendChild(bar);
        // start animation
        requestAnimationFrame(() => { try { bar!.style.width = '70%'; } catch {} });
      }
      return bar;
    }
    function finishProgress() {
      const bar = document.getElementById('admin-action-progress') as HTMLDivElement | null;
      if (bar) {
        try { bar.style.width = '100%'; } catch {}
        setTimeout(() => { try { bar.remove(); } catch {} }, 300);
      }
    }
    const onSubmit = (ev: Event) => {
      const se = ev as SubmitEvent;
      const form = ev.target as HTMLFormElement | null;
      if (!form) return;
      if ((form.getAttribute('target') || '') === '_blank') return;
      // allow opt-out
      if (form.dataset.noLoader === '1') return;
      const btn = (se as any).submitter as HTMLButtonElement | undefined;
      if (btn) {
        try { btn.dataset.prevText = btn.textContent || ''; btn.disabled = true; btn.textContent = 'Загрузка...'; } catch {}
      }
      showProgress();
      // In case page doesn't navigate for some reason, auto-finish after 5s
      setTimeout(() => finishProgress(), 5000);
    };
    const onBeforeUnload = () => finishProgress();
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
  return null;
}


