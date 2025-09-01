"use client";

import { use, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export default function EditProductPage(props: { params: Promise<{ id?: string }> }) {
  // In Next 15, route params in Client Components are a Promise. Unwrap with React.use().
  const unwrapped = use(props.params) || {} as { id?: string };
  const id = decodeURIComponent(String(unwrapped.id || ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<'goods' | 'service'>('service');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<'усл' | 'шт' | 'упак' | 'гр' | 'кг' | 'м'>('усл');
  const [vat, setVat] = useState<'none' | '0' | '10' | '20'>('none');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Viewer state (fullscreen pop-up, like public payment page)
  const [viewer, setViewer] = useState<{ open: boolean; photos: string[]; index: number }>({ open: false, photos: [], index: 0 });
  const [fadeIn, setFadeIn] = useState(true);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);

  const showPrev = () => {
    setFadeIn(false);
    setTimeout(() => setFadeIn(true), 20);
    setViewer((v) => ({ ...v, index: (v.index - 1 + v.photos.length) % v.photos.length }));
  };
  const showNext = () => {
    setFadeIn(false);
    setTimeout(() => setFadeIn(true), 20);
    setViewer((v) => ({ ...v, index: (v.index + 1) % v.photos.length }));
  };

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
        const r = await fetch(`/api/products/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) { setError(j?.error || 'Ошибка загрузки'); return; }
        const p = j.item || {};
        setKind(p.kind === 'goods' ? 'goods' : 'service');
        setTitle(p.title || '');
        setCategory(p.category ?? null);
        setPrice(typeof p.price === 'number' ? String(p.price).replace('.', ',') : '');
        setUnit((['усл','шт','упак','гр','кг','м'].includes(p.unit) ? p.unit : 'усл') as any);
        setVat((['none','0','10','20'].includes(p.vat) ? p.vat : 'none') as any);
        setSku(p.sku || '');
        setDescription(p.description || '');
        const phs = Array.isArray(p.photos) ? p.photos : [];
        setPhotos(phs);
        setPreviews(phs);
      } catch {
        setError('Ошибка загрузки');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onSave = async () => {
    setError(null);
    try {
      const body = {
        kind,
        title: title.trim(),
        category: category?.trim() || null,
        price: Number(price.replace(',', '.')),
        unit,
        vat,
        sku: sku.trim() || null,
        description: description.trim() || null,
        photos,
      };
      const r = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setError(j?.error || 'Не удалось сохранить'); return; }
      window.location.href = '/products';
    } catch {
      setError('Не удалось сохранить');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">Редактировать позицию</h1>
          <a href="/products" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500">Загрузка…</div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <label className="block mb-1">Предмет расчёта</label>
              <div className="flex gap-4">
                <label className="inline-flex items-center gap-2"><input type="radio" value="service" checked={kind==='service'} onChange={() => setKind('service')} /><span>Услуга</span></label>
                <label className="inline-flex items-center gap-2"><input type="radio" value="goods" checked={kind==='goods'} onChange={() => setKind('goods')} /><span>Товар</span></label>
              </div>
            </div>
            <div>
              <label className="block mb-1">Наименование</label>
              <input className="w-full rounded border px-2 h-9" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1">Цена</label>
                <input className="w-full rounded border px-2 h-9" value={price.replace('.', ',')} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} />
              </div>
              <div>
                <label className="block mb-1">Ед.</label>
                <select className="w-full rounded border px-2 h-9" value={unit} onChange={(e) => setUnit(e.target.value as any)}>
                  {['усл','шт','упак','гр','кг','м'].map(u => (<option key={u} value={u}>{u}</option>))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1">НДС</label>
                <select className="w-full rounded border px-2 h-9" value={vat} onChange={(e) => setVat(e.target.value as any)}>
                  <option value="none">Без НДС</option>
                  <option value="0">0%</option>
                  <option value="10">10%</option>
                  <option value="20">20%</option>
                </select>
              </div>
              <div>
                <label className="block mb-1">Категория</label>
                <input className="w-full rounded border px-2 h-9" value={category || ''} onChange={(e) => setCategory(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block mb-1">Артикул</label>
              <input className="w-full rounded border px-2 h-9" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div>
              <label className="block mb-1">Описание</label>
              <textarea className="w-full rounded border px-2 py-2 min-h-[100px]" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {/* Фото: просмотр и добавление */}
            <div>
              <label className="block mb-1">Фото (до 5 шт.)</label>
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
                {(previews.length ? previews : photos).map((src, idx) => (
                  <div key={`${src}-${idx}`} className="relative w-28 h-28 border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden bg-white dark:bg-gray-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src.startsWith('.data/') ? `/api/products/${encodeURIComponent(id)}?path=${encodeURIComponent(src)}` : src}
                      alt="Фото"
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => {
                        try {
                          const list = (previews.length ? previews : photos).map((s) => s.startsWith('.data/') ? `/api/products/${encodeURIComponent(id)}?path=${encodeURIComponent(s)}` : s);
                          setViewer({ open: true, photos: list, index: idx });
                        } catch {}
                      }}
                    />
                    <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded p-1" aria-label="Удалить фото" onClick={() => {
                      setPhotos((arr) => arr.filter((_, i) => i !== idx));
                      const url = previews[idx];
                      if (url) { try { URL.revokeObjectURL(url); } catch {} }
                      setPreviews((arr) => arr.filter((_, i) => i !== idx));
                    }}>✕</button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Поддерживаются JPG, PNG, WEBP. До 5 МБ на файл.</p>
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
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            <div>
              <Button onClick={onSave}>Сохранить</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


