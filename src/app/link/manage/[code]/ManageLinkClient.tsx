"use client";

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { uploadPdfWithGetFallback } from '@/lib/chunkedUpload';

type Props = {
  code: string;
  link: any;
  items: any[];
  total: number;
  url: string;
  tg: string;
  showDocs?: boolean;
};

export default function ManageLinkClient(props: Props) {
  const { code, link, items, total, url, tg, showDocs } = props;
  const router = useRouter();
  const [isEnabled, setIsEnabled] = useState(!link?.disabled);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };
  const [docs, setDocs] = useState<Array<{ hash: string; name?: string | null; size?: number }>>([]);
  const [uploading, setUploading] = useState(false);

  // Load existing docs for user (to reuse)
  useEffect(() => { (async () => { try { const r = await fetch('/api/docs', { cache: 'no-store' }); const d = await r.json(); if (Array.isArray(d?.items)) setDocs(d.items); } catch {} })(); }, []);

  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <div className="mb-4">
        <div className="text-sm text-gray-600">Код: <span className="font-mono">/{code}</span></div>
      </div>
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4 space-y-4">
        {/* Document for payment (only in edit) */}
        {showDocs ? (<div>
          <div className="text-sm font-semibold mb-1">Документ для оплаты (необязательно)</div>
          <div className="text-xs text-gray-600 mb-2">Загрузите PDF-документ с условиями продажи/оказания услуг. На платёжной странице мы покажем ссылку на файл и чекбокс “Я принимаю условия”. Без согласия оплатить нельзя.</div>
          {docs.length > 0 ? (
            <div className="mb-2">
              <div className="text-xs text-gray-600 mb-1">Использовать ранее загруженный:</div>
              <div className="flex flex-wrap gap-2">
                {docs.map((d) => (
                  <button key={d.hash} className="px-2 h-8 border rounded text-sm" onClick={async()=>{
                    const body = { title: link.title, description: link.description, sumMode: link.sumMode, amountRub: link.amountRub, vatRate: link.vatRate, method: link.method, isAgent: link.isAgent, commissionType: link.commissionType, commissionValue: link.commissionValue, partnerPhone: link.partnerPhone, disabled: link.disabled, cartItems: link.cartItems, allowCartAdjust: link.allowCartAdjust, startEmptyCart: link.startEmptyCart, cartDisplay: link.cartDisplay, termsDocHash: d.hash } as any;
                    await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    showToast('Документ выбран', 'success');
                  }}>{d.name || `${d.hash.slice(0,8)}…`}</button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="border rounded p-3">
            <div className="text-sm mb-1">Файл</div>
            <label className={`flex items-center justify-center border-2 border-dashed rounded h-24 text-sm ${uploading ? 'opacity-60' : ''}`}>
              <input type="file" accept="application/pdf" className="hidden" onChange={async (e)=>{
                const f = e.currentTarget.files && e.currentTarget.files[0];
                if (!f) return;
                if (f.type !== 'application/pdf') { showToast('Загрузите файл в формате PDF', 'error'); return; }
                if (f.size > 5*1024*1024) { showToast('Файл слишком большой. Загрузите файл размером до 5 МБ', 'error'); return; }
                try {
                  setUploading(true);
                  const res = await uploadPdfWithGetFallback('/api/docs', f);
                  const d = await res.json();
                  if (!res.ok) {
                    const code = d?.error; if (code === 'INVALID_FORMAT') showToast('Загрузите файл в формате PDF', 'error'); else if (code === 'TOO_LARGE') showToast('Файл слишком большой. Загрузите файл размером до 5 МБ', 'error'); else showToast('Не удалось открыть файл. Попробуйте другой PDF', 'error');
                    return;
                  }
                  const hash = d?.item?.hash;
                  if (hash) {
                    setDocs((prev)=> [{ hash, name: f.name, size: f.size }, ...prev]);
                    const body = { title: link.title, description: link.description, sumMode: link.sumMode, amountRub: link.amountRub, vatRate: link.vatRate, method: link.method, isAgent: link.isAgent, commissionType: link.commissionType, commissionValue: link.commissionValue, partnerPhone: link.partnerPhone, disabled: link.disabled, cartItems: link.cartItems, allowCartAdjust: link.allowCartAdjust, startEmptyCart: link.startEmptyCart, cartDisplay: link.cartDisplay, termsDocHash: hash } as any;
                    await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    showToast('Документ загружен', 'success');
                  }
                } catch { showToast('Не удалось открыть файл. Попробуйте другой PDF', 'error'); }
                finally { setUploading(false); e.currentTarget.value=''; }
              }} />
              <span>{uploading ? 'Загрузка…' : 'Выберите файл'}</span>
            </label>
            <div className="text-xs text-gray-600 mt-1">Только PDF. До 5 МБ на файл.</div>
          </div>
        </div>) : null}
        <div>
          <div className="text-sm text-gray-600 mb-1">Ссылка на страницу</div>
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded border px-2 h-9 text-sm bg-gray-50 dark:bg-gray-900" value={url} readOnly />
            <button
              className="rounded border px-3 h-9 text-sm bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 active:translate-y-[1px] transition"
              onClick={async () => {
                try { await navigator.clipboard.writeText(url); showToast('Ссылка скопирована', 'success'); }
                catch { showToast('Не удалось скопировать', 'error'); }
              }}
            >Копировать</button>
          </div>
        </div>
        <div>
          <div className="text-sm text-gray-600 mb-1">Ссылка в Telegram</div>
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded border px-2 h-9 text-sm bg-gray-50 dark:bg-gray-900" value={tg} readOnly />
            <button
              className="rounded border px-3 h-9 text-sm bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 active:translate-y-[1px] transition"
              onClick={async () => {
                try { await navigator.clipboard.writeText(tg); showToast('Ссылка скопирована', 'success'); }
                catch { showToast('Не удалось скопировать', 'error'); }
              }}
            >Копировать</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/link/${encodeURIComponent(code)}/edit`} className="rounded border px-3 h-9 text-sm inline-flex items-center bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 active:translate-y-[1px] transition">Редактировать</a>
          <a href={`/api/links/${encodeURIComponent(code)}`} className={`rounded border px-3 h-9 text-sm inline-flex items-center ${uploading ? 'opacity-60 pointer-events-none' : 'bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 active:translate-y-[1px] transition'}`} onClick={(e)=>{ e.preventDefault(); if (uploading) return; if (!confirm('Удалить страницу?')) return; fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(()=>{ router.push('/link'); }); }}>Удалить</a>
          <div className="ml-auto inline-flex items-center gap-2">
            <label className="text-sm">Доступна покупателям</label>
            <input type="checkbox" checked={isEnabled} disabled={uploading} onChange={async (e)=>{
              const next = e.currentTarget.checked;
              setIsEnabled(next);
              const body = { title: link.title, description: link.description, sumMode: link.sumMode, amountRub: link.amountRub, vatRate: link.vatRate, method: link.method, isAgent: link.isAgent, commissionType: link.commissionType, commissionValue: link.commissionValue, partnerPhone: link.partnerPhone, disabled: !next, cartItems: link.cartItems, allowCartAdjust: link.allowCartAdjust, startEmptyCart: link.startEmptyCart, cartDisplay: link.cartDisplay };
              await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            }} />
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
        <div className="text-sm font-semibold mb-2">Успешные продажи</div>
        {items.length === 0 ? (
          <div className="text-sm text-gray-600">Нет данных</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="text-left px-3 py-2">№</th>
                  <th className="text-left px-3 py-2">Сумма</th>
                  <th className="text-left px-3 py-2">Статус</th>
                  <th className="text-left px-3 py-2">Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s: any) => (
                  <tr key={String(s.taskId)} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer" onClick={() => { router.push(`/sales/${encodeURIComponent(String(s.taskId))}`); }}>
                    <td className="px-3 py-2">{String(s.taskId)}</td>
                    <td className="px-3 py-2">{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s.amountGrossRub || 0))}</td>
                    <td className="px-3 py-2">{s.status || '-'}</td>
                    <td className="px-3 py-2">{s.createdAtRw ? new Date(s.createdAtRw).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-500 mt-2">Показаны {Math.min(20, total)} из {total}</div>
          </div>
        )}
      </div>
      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${toast.kind==='success'?'bg-green-600 text-white':toast.kind==='error'?'bg-red-600 text-white':'bg-gray-900 text-white'}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}


