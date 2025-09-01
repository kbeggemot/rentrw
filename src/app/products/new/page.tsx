"use client";

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function NewProductPage() {
  const [kind, setKind] = useState<'goods' | 'service'>('service');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<'усл' | 'шт' | 'упак' | 'гр' | 'кг' | 'м'>('усл');
  const [vat, setVat] = useState<'none' | '0' | '5' | '7' | '10' | '20'>('none');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<{ open: boolean; photos: string[]; index: number }>({ open: false, photos: [], index: 0 });
  const [fadeIn, setFadeIn] = useState(true);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);

  const showPrev = () => { setFadeIn(false); setTimeout(() => setFadeIn(true), 20); setViewer((v) => ({ ...v, index: (v.index - 1 + v.photos.length) % v.photos.length })); };
  const showNext = () => { setFadeIn(false); setTimeout(() => setFadeIn(true), 20); setViewer((v) => ({ ...v, index: (v.index + 1) % v.photos.length })); };
  useEffect(() => {
    if (!viewer.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); showPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); showNext(); }
      else if (e.key === 'Escape') { e.preventDefault(); setViewer({ open: false, photos: [], index: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer.open]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/products?categories=1', { cache: 'no-store' });
        const j = await r.json();
        setCategories(Array.isArray(j?.categories) ? j.categories : []);
      } catch {}
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = {
        kind,
        title: title.trim(),
        category: category.trim() || null,
        price: Number(price.replace(',', '.')),
        unit,
        vat,
        sku: sku.trim() || null,
        description: description.trim() || null,
        photos,
      };
      const r = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      if (!r.ok) {
        try { const j = t ? JSON.parse(t) : null; setError(j?.error || 'Ошибка'); } catch { setError('Ошибка'); }
        return;
      }
      window.location.href = '/products';
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Новая торговая позиция</h1>
        <a href="/products" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
      </div>
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
        <form className="flex flex-col gap-3" onSubmit={submit}>
        <div>
          <label className="block text-sm mb-1">Предмет расчёта</label>
          <div className="flex gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="kind" value="service" checked={kind==='service'} onChange={() => setKind('service')} />
              <span>Услуга</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="kind" value="goods" checked={kind==='goods'} onChange={() => setKind('goods')} />
              <span>Товар</span>
            </label>
          </div>
        </div>
        <Input label="Наименование" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <Input label="Цена" type="text" inputMode="decimal" value={price.replace('.', ',')} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} required />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Единица измерения</label>
            <select className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 h-9 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as any)}>
              {((kind==='service') ? ['усл'] : ['шт','упак','гр','кг','м']).map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Процент НДС</label>
            <select className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 h-9 text-sm" value={vat} onChange={(e) => setVat(e.target.value as any)}>
              <option value="none">Без НДС</option>
              <option value="0">0%</option>
              <option value="5">5%</option>
              <option value="7">7%</option>
              <option value="10">10%</option>
              <option value="20">20%</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Категория (необязательно)</label>
          {!useCustomCategory ? (
            <select
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 h-9 text-sm"
              value={category || ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__custom__') { setUseCustomCategory(true); setCategory(''); }
                else setCategory(v);
              }}
            >
              <option value="">— не выбрано —</option>
              {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
              <option value="__custom__">Новое значение…</option>
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 h-9 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Введите категорию"
              />
              <button type="button" className="text-sm px-2 py-1 rounded border" onClick={() => { setUseCustomCategory(false); setCategory(''); }}>Отменить</button>
            </div>
          )}
        </div>
        <Input label="Артикул продавца (необязательно)" value={sku} onChange={(e) => setSku(e.target.value)} />
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание (необязательно)</label>
          <textarea className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm min-h-[100px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {/* Photos */}
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Фото (необязательно, до 5 шт.)</label>
          <div className="flex flex-wrap gap-3 items-start">
            <label className="w-28 h-28 border border-dashed border-gray-300 dark:border-gray-700 rounded-md flex items-center justify-center text-xs cursor-pointer bg-white dark:bg-gray-900">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onClick={(e) => { try { (e.currentTarget as HTMLInputElement).value = ''; } catch {} }}
                disabled={uploading || photos.length >= 5}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (photos.length >= 5) { setError('Можно загрузить не более 5 фото'); return; }
                  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { setError('Поддерживаются JPG, PNG, WEBP'); return; }
                  if (file.size > 5 * 1024 * 1024) { setError('Максимальный размер файла 5 МБ'); return; }
                  setUploading(true);
                  setError(null);
                  let objUrl: string | null = null;
                  try {
                    objUrl = URL.createObjectURL(file);
                    setPreviews((p) => [...p, objUrl as string]);
                    const fd = new FormData();
                    fd.append('file', file);
                    const r = await fetch('/api/products/upload', { method: 'POST', body: fd });
                    const j = await r.json();
                    if (!r.ok) { setError('Не удалось загрузить фото'); return; }
                    setPhotos((p) => [...p, j.path]);
                  } catch {
                    setError('Не удалось загрузить фото');
                  } finally {
                    setUploading(false);
                    try { e.currentTarget.value = ''; } catch {}
                  }
                }}
              />
              {uploading ? 'Загрузка…' : 'Добавить'}
            </label>
            {previews.map((src, idx) => (
              <div key={src} className="relative w-28 h-28 border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden bg-white dark:bg-gray-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Фото" className="w-full h-full object-cover cursor-pointer" onClick={() => { try { setViewer({ open: true, photos: previews, index: idx }); } catch {} }} />
                <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded p-1" aria-label="Удалить фото" onClick={() => { setPhotos((arr) => arr.filter((_, i) => i !== idx)); const url = previews[idx]; if (url) { try { URL.revokeObjectURL(url); } catch {} } setPreviews((arr) => arr.filter((_, i) => i !== idx)); }}>✕</button>
              </div>
            ))}
            {viewer.open ? (
              <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={() => setViewer({ open: false, photos: [], index: 0 })}>
                <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewer.photos[viewer.index]}
                    alt="photo"
                    className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-300 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
                    style={{ transform: `translateX(${touchDeltaX}px)` }}
                    onTouchStart={(e) => { setTouchStartX(e.touches[0].clientX); setTouchDeltaX(0); }}
                    onTouchMove={(e) => { if (touchStartX != null) setTouchDeltaX(e.touches[0].clientX - touchStartX); }}
                    onTouchEnd={() => { const threshold = 50; if (touchDeltaX > threshold) showPrev(); else if (touchDeltaX < -threshold) showNext(); setTouchStartX(null); setTouchDeltaX(0); }}
                  />
                  {viewer.photos.length > 1 ? (
                    <>
                      <button className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/70 rounded px-2 py-1" onClick={showPrev}>‹</button>
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/70 rounded px-2 py-1" onClick={showNext}>›</button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 mt-1">Поддерживаются JPG, PNG, WEBP. До 5 МБ на файл. Можно с камеры.</p>
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>{loading ? 'Сохранение…' : 'Сохранить'}</Button>
          <a href="/products" className="px-3 py-2 rounded-md border text-sm">Отмена</a>
        </div>
        </form>
      </div>
    </div>
  );
}


