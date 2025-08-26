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
      #admin-action-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.05);z-index:99998}
      @keyframes adminSpin{to{transform:rotate(360deg)}}
      .admin-btn-loading{position:relative}
      .admin-btn-loading > .admin-spinner{width:16px;height:16px;border:2px solid #fff;border-right-color:transparent;border-radius:50%;display:inline-block;margin-right:8px;vertical-align:-3px;animation:adminSpin .8s linear infinite}
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
      const ov = document.getElementById('admin-action-overlay');
      if (ov) { try { ov.remove(); } catch {} }
    }
    function showOverlay() {
      ensureStyles();
      let ov = document.getElementById('admin-action-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'admin-action-overlay';
        const spinner = document.createElement('div');
        spinner.style.width = '36px';
        spinner.style.height = '36px';
        spinner.style.border = '3px solid #3b82f6';
        spinner.style.borderRightColor = 'transparent';
        spinner.style.borderRadius = '50%';
        spinner.style.animation = 'adminSpin .8s linear infinite';
        ov.appendChild(spinner);
        document.body.appendChild(ov);
      }
      return ov as HTMLDivElement;
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
        try {
          btn.dataset.prevHtml = btn.innerHTML;
          btn.disabled = true;
          btn.classList.add('admin-btn-loading');
          btn.innerHTML = '<span class="admin-spinner"></span>' + (btn.textContent || 'Загрузка...');
        } catch {}
      }
      showProgress();
      showOverlay();
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


