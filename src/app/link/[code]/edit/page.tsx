"use client";

import { use, useEffect, useMemo, useState } from 'react';
import { applyAgentCommissionToCart } from '@/lib/pricing';
import { Button } from '@/components/ui/Button';

export default function EditLinkPage(props: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(props.params);
  const code = decodeURIComponent(rawCode);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3000); };

  // Common
  const [title, setTitle] = useState('');
  const [method, setMethod] = useState<'any' | 'qr' | 'card'>('any');
  const [isAgent, setIsAgent] = useState(false);
  const [initialIsAgent, setInitialIsAgent] = useState<boolean | null>(null);
  const [initialCommissionType, setInitialCommissionType] = useState<'percent' | 'fixed' | null>(null);
  const [initialCommissionValue, setInitialCommissionValue] = useState<number | null>(null);
  const [initialTotal, setInitialTotal] = useState<number | null>(null);
  const [commissionType, setCommissionType] = useState<'percent' | 'fixed'>('percent');
  const [commissionValue, setCommissionValue] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partners, setPartners] = useState<Array<{ phone: string; fio: string | null }>>([]);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [orgProducts, setOrgProducts] = useState<Array<{ id: string; title: string; price: number }>>([]);

  // Service specific
  const [mode, setMode] = useState<'service' | 'cart'>('service');
  const [description, setDescription] = useState('');
  const [sumMode, setSumMode] = useState<'custom' | 'fixed'>('custom');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState<'none' | '0' | '5' | '7' | '10' | '20'>('none');

  // Cart specific
  const [cartItems, setCartItems] = useState<Array<{ id?: string | null; title: string; price: string; qty: string }>>([]);
  const [editingPriceIdx, setEditingPriceIdx] = useState<number | null>(null);
  const [allowCartAdjust, setAllowCartAdjust] = useState(false);
  const [cartDisplay, setCartDisplay] = useState<'grid' | 'list'>('list');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || 'LOAD_ERROR');
        setTitle(d.title || '');
        setMethod(d.method || 'any');
        setIsAgent(!!d.isAgent);
        setInitialIsAgent(!!d.isAgent);
        setInitialCommissionType((d.commissionType === 'fixed' || d.commissionType === 'percent') ? d.commissionType : null);
        setInitialCommissionValue(typeof d.commissionValue === 'number' ? d.commissionValue : null);
        setInitialTotal(typeof d.amountRub === 'number' ? d.amountRub : null);
        setCommissionType((d.commissionType === 'fixed' || d.commissionType === 'percent') ? d.commissionType : 'percent');
        setCommissionValue(d.commissionValue != null ? String(d.commissionValue) : '');
        setPartnerPhone(d.partnerPhone || '');

        if (Array.isArray(d.cartItems) && d.cartItems.length > 0) {
          setMode('cart');
          setCartItems(d.cartItems.map((c: any) => ({ id: c?.id ?? null, title: String(c?.title || ''), price: String(c?.price ?? 0), qty: String(c?.qty ?? 1) })));
          setAllowCartAdjust(!!d.allowCartAdjust);
          setCartDisplay(d.cartDisplay === 'grid' ? 'grid' : 'list');
        } else {
          setMode('service');
          setDescription(d.description || '');
          setSumMode(d.sumMode === 'fixed' ? 'fixed' : 'custom');
          setAmount(d.amountRub != null ? String(d.amountRub) : '');
          setVatRate((['none','0','5','7','10','20'].includes(String(d.vatRate)) ? d.vatRate : 'none'));
        }
      } catch {
        showToast('Не удалось загрузить ссылку', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  // Preload partners for agent selector
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/partners', { cache: 'no-store' });
        const d = await r.json();
        const arr = Array.isArray(d?.partners) ? d.partners : [];
        setPartners(arr.map((p: any) => ({ phone: String(p.phone || ''), fio: p.fio ?? null })));
      } catch {}
    })();
  }, []);

  // Preload products for cart selector
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/products', { cache: 'no-store' });
        const d = await r.json();
        const items = Array.isArray(d?.items) ? d.items : [];
        setOrgProducts(items.map((p: any) => ({ id: p.id, title: p.title, price: Number(p.price || 0) })));
      } catch {}
    })();
  }, []);

  const numericCart = useMemo(() => cartItems.map((c) => ({ title: c.title, price: Number(String(c.price || '0').replace(',', '.')), qty: Number(String(c.qty || '1').replace(',', '.')) })), [cartItems]);
  const commissionValid = useMemo(() => isAgent && ((commissionType === 'percent' && Number(commissionValue.replace(',', '.')) >= 0) || (commissionType === 'fixed' && Number(commissionValue.replace(',', '.')) > 0)), [isAgent, commissionType, commissionValue]);
  const shouldApplyDisplayAdjustment = useMemo(() => {
    // Понижаем цены для отображения, если агент включён сейчас и ссылка изначально была без агента
    // (или исходное состояние ещё не успело загрузиться).
    return commissionValid && initialIsAgent !== true;
  }, [commissionValid, initialIsAgent]);
  const adjustedForDisplay = useMemo(() => {
    if (!shouldApplyDisplayAdjustment) return numericCart;
    const v = Number(commissionValue.replace(',', '.'));
    try { return applyAgentCommissionToCart(numericCart, commissionType, v).adjusted; } catch { return numericCart; }
  }, [shouldApplyDisplayAdjustment, numericCart, commissionType, commissionValue]);

  // When link is already agent and prices are stored lowered, recover one step so that UI shows
  // the expected single-lowered values based on the original total (amountRub) and commission.
  const displayFromStored = useMemo(() => {
    if (!commissionValid) return numericCart;
    const v = Number(commissionValue.replace(',', '.'));
    // If initialTotal (T) known, compute per-item lowered prices proportionally to T - A
    if (initialTotal != null && Number.isFinite(initialTotal)) {
      const A = commissionType === 'percent' ? initialTotal * (v / 100) : v;
      const effTarget = Math.max(initialTotal - A, 0);
      const effSaved = numericCart.reduce((s, r) => s + r.price * r.qty, 0);
      if (effSaved <= 0) return numericCart;
      const factor = effTarget / effSaved;
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      return numericCart.map((i) => ({ ...i, price: round2(i.price * factor) }));
    }
    // Fallback: if T unknown and percent — recover original via k; fixed cannot be recovered reliably without T
    if (commissionType === 'percent') {
      const k = 1 - v / 100;
      if (k > 0) {
        // original sum T = effSaved / k → share to items proportionally
        return numericCart.map((i) => ({ ...i, price: Math.round(((i.price / k) + Number.EPSILON) * 100) / 100 }));
      }
    }
    return numericCart;
  }, [commissionValid, numericCart, commissionType, commissionValue, initialTotal]);
  const agentLine = useMemo(() => {
    if (!commissionValid || numericCart.length === 0) return null;
    const v = Number(commissionValue.replace(',', '.'));
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    if (initialTotal != null && Number.isFinite(initialTotal)) {
      const A = commissionType === 'percent' ? initialTotal * (v / 100) : v;
      return { title: 'Услуги агента', price: round2(Math.max(0, A)), qty: 1 };
    }
    // Fallback from saved lowered values
    const effSum = numericCart.reduce((s, r) => s + r.price * r.qty, 0);
    if (commissionType === 'percent') {
      const k = 1 - v / 100; if (k <= 0) return { title: 'Услуги агента', price: 0, qty: 1 };
      const T = effSum / k; const A = T - effSum; return { title: 'Услуги агента', price: round2(Math.max(0, A)), qty: 1 };
    }
    return { title: 'Услуги агента', price: round2(Math.max(0, v)), qty: 1 };
  }, [commissionValid, commissionType, commissionValue, numericCart, initialTotal]);

  const totalCart = useMemo(() => {
    if (mode !== 'cart') return 0;
    const v = Number(commissionValue.replace(',', '.'));
    if (initialTotal != null && Number.isFinite(initialTotal)) return initialTotal;
    const commissionValidLocal = isAgent && ((commissionType === 'percent' && v >= 0) || (commissionType === 'fixed' && v > 0));
    const effBase = shouldApplyDisplayAdjustment ? adjustedForDisplay : numericCart;
    const eff = effBase.reduce((s, r) => s + r.price * r.qty, 0);
    let A = 0;
    if (commissionValidLocal) {
      if (commissionType === 'percent') {
        const k = 1 - (v / 100);
        A = k > 0 ? eff * (1 / k - 1) : 0;
      } else {
        A = v;
      }
    }
    return eff + (Math.round((A + Number.EPSILON) * 100) / 100);
  }, [mode, adjustedForDisplay, shouldApplyDisplayAdjustment, numericCart, isAgent, commissionType, commissionValue, initialTotal]);

  const onSave = async () => {
    try {
      const body: any = { title, method, isAgent };
      if (isAgent) {
        body.commissionType = commissionType;
        body.commissionValue = Number(commissionValue.replace(',', '.'));
        body.partnerPhone = partnerPhone;
      }
      if (mode === 'service') {
        body.description = description;
        body.sumMode = sumMode;
        if (sumMode === 'fixed') body.amountRub = Number(String(amount).replace(',', '.'));
        body.vatRate = vatRate;
      } else {
        body.cartItems = cartItems.map((c) => ({ id: c.id ?? null, title: c.title, price: Number(String(c.price).replace(',', '.')), qty: Number(String(c.qty).replace(',', '.')) }));
        body.allowCartAdjust = allowCartAdjust;
        body.amountRub = totalCart;
        body.cartDisplay = cartDisplay;
      }
      const r = await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'SAVE_ERROR');
      try { sessionStorage.setItem('flash', 'UPDATED'); } catch {}
      window.location.href = '/link';
    } catch (e) {
      showToast('Не удалось сохранить', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Редактирование платёжной страницы</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Тип и адрес страницы изменить нельзя</p>
      </header>

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка…</div>
      ) : (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Название</label>
              <input className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Тип оплаты</label>
              <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={method} onChange={(e) => setMethod(e.target.value as any)}>
                <option value="any">Любой</option>
                <option value="qr">СБП</option>
                <option value="card">Карта</option>
              </select>
            </div>
          </div>

          {/* Что продаете? */}
          <div className="mt-3">
            <div className="text-base font-semibold mb-2">Что продаете?</div>
            <div className="flex gap-2 mb-3">
              <button type="button" className={`px-3 h-9 rounded border ${mode==='service'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('service')}>Свободная услуга</button>
              <button type="button" className={`px-3 h-9 rounded border ${mode==='cart'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('cart')}>Собрать корзину</button>
            </div>
          </div>

          {mode === 'service' ? (
            <div className="mt-3">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание услуги</label>
              <textarea className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              <div className="mt-3 flex items-start gap-3">
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма</label>
                  <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={sumMode} onChange={(e) => setSumMode(e.target.value as any)}>
                    <option value="custom">Укажет покупатель</option>
                    <option value="fixed">Точная</option>
                  </select>
                  {sumMode === 'fixed' ? (
                    <div className="mt-2 w-44">
                      <input className="block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 pl-2 h-9 text-sm" value={amount.replace('.', ',')} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0,00" inputMode="decimal" />
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">НДС</label>
                  <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={vatRate} onChange={(e) => setVatRate(e.target.value as any)}>
                    <option value="none">Без НДС</option>
                    <option value="0">0%</option>
                    <option value="5">5%</option>
                    <option value="7">7%</option>
                    <option value="10">10%</option>
                    <option value="20">20%</option>
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Выберите нужные позиции на витрине</label>
              {cartItems.map((row, idx) => (
                <div key={idx} className="overflow-x-auto sm:overflow-visible -mx-1 px-1 touch-pan-x">
                  <div className="flex items-start gap-2 w-max">
                    <div className="relative flex-1 min-w-[8rem] sm:min-w-[14rem]">
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Наименование</div>) : null}
                      <input
                        className="w-full rounded border px-2 h-9 text-sm"
                        placeholder="Начните вводить название"
                        list={`products-list-${idx}`}
                        value={row.title}
                        onChange={(e)=>{
                          const title = e.target.value;
                          const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                          setCartItems((prev)=> prev.map((r,i)=> i===idx ? {
                            id: p?.id || null,
                            title,
                            price: (p ? (p.price ?? 0) : (r.price || '')).toString(),
                            qty: r.qty || '1',
                          } : r));
                        }}
                        onBlur={(e)=>{
                          const title = e.currentTarget.value;
                          const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                          if (p) setCartItems((prev)=> prev.map((r,i)=> i===idx ? { ...r, id: p.id, title: p.title, price: (p.price ?? 0).toString() } : r));
                        }}
                      />
                      <datalist id={`products-list-${idx}`}>
                        {orgProducts.map((p)=> (<option key={p.id} value={p.title} />))}
                      </datalist>
                    </div>
                    <div>
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Количество</div>) : null}
                      <input className="w-16 sm:w-20 rounded border px-2 h-9 text-sm" placeholder="Кол-во" value={row.qty} onChange={(e)=> setCartItems((prev)=> prev.map((r,i)=> i===idx ? { ...r, qty: e.target.value } : r))} />
                    </div>
                    <div>
                      {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Цена, ₽</div>) : null}
                      {(() => {
                        const baseNum = Number(String(row.price || '0').replace(',', '.'));
                        const shouldAdjustNow = shouldApplyDisplayAdjustment || (initialIsAgent === true);
                        const baseForView = initialIsAgent ? displayFromStored : adjustedForDisplay;
                        const shownNum = (shouldAdjustNow && editingPriceIdx !== idx)
                          ? (baseForView[idx]?.price ?? baseNum)
                          : baseNum;
                        const shownStr = (shouldAdjustNow && editingPriceIdx !== idx)
                          ? shownNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
                          : String(row.price || '').replace('.', ',');
                        return (
                          <input
                            className="w-24 sm:w-28 rounded border px-2 h-9 text-sm"
                            placeholder="Цена"
                            value={shownStr}
                            onFocus={() => setEditingPriceIdx(idx)}
                            onBlur={() => setEditingPriceIdx(null)}
                            onChange={(e)=> setCartItems((prev)=> prev.map((r,i)=> i===idx ? { ...r, price: e.target.value.replace(',', '.') } : r))}
                          />
                        );
                      })()}
                    </div>
                    <div className="flex flex-col">
                      {idx===0 ? (<div className="text-xs mb-1 invisible">label</div>) : null}
                      <button type="button" className="px-2 h-9 rounded border" onClick={()=> setCartItems((prev)=> prev.filter((_,i)=> i!==idx))}>Удалить</button>
                    </div>
                  </div>
                </div>
              ))}
              {agentLine ? (
                <div className="overflow-x-auto sm:overflow-visible -mx-1 px-1 touch-pan-x">
                  <div className="flex items-start gap-2 w-max opacity-90">
                    <div className="relative flex-1 min-w-[8rem] sm:min-w-[14rem]">
                      <input className="w-full rounded border px-2 h-9 text-sm bg-gray-100" value={agentLine.title} readOnly disabled />
                    </div>
                    <div>
                      <input className="w-16 sm:w-20 rounded border px-2 h-9 text-sm bg-gray-100" value="1" readOnly disabled />
                    </div>
                    <div>
                      <input className="w-24 sm:w-28 rounded border px-2 h-9 text-sm bg-gray-100" value={agentLine.price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} readOnly disabled />
                    </div>
                    <div className="flex flex-col">
                      <button type="button" className="px-2 h-9 rounded border text-gray-400" disabled>Удалить</button>
                    </div>
                  </div>
                </div>
              ) : null}
              <button type="button" className="px-3 h-9 rounded border" onClick={() => setCartItems((prev) => [...prev, { id: '', title: '', price: '', qty: '1' }])}>+ Добавить</button>
              {(() => {
                const v = Number(commissionValue.replace(',', '.'));
                const commissionValidLocal = isAgent && ((commissionType === 'percent' && v >= 0) || (commissionType === 'fixed' && v > 0));
                const base = shouldApplyDisplayAdjustment ? adjustedForDisplay : numericCart;
                const eff = base.reduce((s, r) => s + r.price * r.qty, 0);
                let A = 0;
                if (commissionValidLocal) {
                  if (commissionType === 'percent') {
                    const k = 1 - (v / 100);
                    A = k > 0 ? eff * (1 / k - 1) : 0;
                  } else {
                    A = v;
                  }
                }
                const total = eff + (Math.round((A + Number.EPSILON) * 100) / 100);
                const formatted = Number.isFinite(total) ? total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
                return (
                  <div className="mt-2">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма, ₽</label>
                    <div className="w-44">
                      <input className="w-full rounded border pl-2 h-9 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700" value={formatted} readOnly disabled />
                    </div>
                  </div>
                );
              })()}
              {/* Showcase display type */}
              <div className="mt-3">
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Отображение витрины</label>
                <div className="flex flex-wrap gap-2 text-sm">
                  <label className={`flex items-center justify-center px-3 h-9 rounded border cursor-pointer text-center ${cartDisplay==='list'?'bg-black text-white':'bg-white text-black dark:text-black'}`} style={{ lineHeight: 1.1 }}>
                    <input type="radio" name="cart_display" className="hidden" checked={cartDisplay==='list'} onChange={() => setCartDisplay('list')} />
                    Показывать строками, маленькие превью
                  </label>
                  <label className={`flex items-center justify-center px-3 h-9 rounded border cursor-pointer text-center ${cartDisplay==='grid'?'bg-black text-white':'bg-white text-black dark:text-black'}`} style={{ lineHeight: 1.1 }}>
                    <input type="radio" name="cart_display" className="hidden" checked={cartDisplay==='grid'} onChange={() => setCartDisplay('grid')} />
                    Показавать сеткой, большие превью
                  </label>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm mt-3">
                <input type="checkbox" checked={allowCartAdjust} onChange={(e) => setAllowCartAdjust(e.target.checked)} />
                <span>Разрешить покупателю изменять набор и количество позиций</span>
              </label>
            </div>
          )}

          <div className="mt-3">
            <div className="mt-2 mb-1 text-sm font-semibold">Принимаете оплату как Агент?</div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isAgent} onChange={(e) => setIsAgent(e.target.checked)} />
              <span>Агентская продажа</span>
            </label>
            <div className="text-xs text-gray-500 mt-1">Разделите оплату между вами и самозанятым партнёром. Описание ваших услуг — в <a href="/settings" className="underline">настройках</a>.</div>
            {isAgent ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <select className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={commissionType} onChange={(e) => setCommissionType(e.target.value as any)}>
                  <option value="percent">%</option>
                  <option value="fixed">₽</option>
                </select>
                <input className="w-32 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" placeholder="Комиссия" value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} />
                <div className="relative">
                  <input
                    className="w-56 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
                    placeholder="Телефон партнёра"
                    value={partnerPhone}
                    onChange={(e) => { setPartnerPhone(e.target.value); setPartnersOpen(true); }}
                    onFocus={() => setPartnersOpen(true)}
                    onBlur={() => setTimeout(() => setPartnersOpen(false), 150)}
                  />
                  {partnerPhone ? (
                    <div className="mt-1 text-xs text-gray-600 whitespace-normal md:whitespace-nowrap md:absolute md:top-0 md:left-full md:ml-2 md:h-9 md:flex md:items-center md:mt-0">
                      {partnerLoading ? (
                        <svg className="animate-spin h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
                      ) : (
                        (() => {
                          const digits = partnerPhone.replace(/\D/g, '');
                          const found = partners.find((p) => p.phone.replace(/\D/g, '') === digits);
                          return found?.fio || '';
                        })()
                      )}
                    </div>
                  ) : null}
                  {partnersOpen ? (
                    <div className="absolute z-10 mt-1 w-[22rem] max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow">
                      {(() => {
                        const q = partnerPhone.toLowerCase();
                        const qDigits = q.replace(/\D/g, '');
                        const items = partners.filter((p) => {
                          const phoneOk = p.phone.replace(/\D/g, '').includes(qDigits);
                          const fioOk = (p.fio || '').toLowerCase().includes(q);
                          return qDigits ? phoneOk : fioOk || phoneOk;
                        });
                        return items.length === 0 ? (
                          <div className="px-2 py-2 text-xs">
                            <button type="button" className="px-2 py-1 text-sm rounded border hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => {
                              const phoneDigits = partnerPhone.replace(/\D/g, '');
                              if (!phoneDigits) return;
                              setPartnerLoading(true);
                              try {
                                const res = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phoneDigits }) });
                                const d = await res.json();
                                if (!res.ok) {
                                  const msg = d?.error || 'Не удалось добавить партнёра';
                                  showToast(msg, 'error');
                                } else {
                                  const p = d?.partner || {};
                                  const fio = p?.fio || null;
                                  setPartners((prev) => {
                                    const exists = prev.some((x) => x.phone.replace(/\D/g, '') === phoneDigits);
                                    return exists ? prev.map((x) => (x.phone.replace(/\D/g, '') === phoneDigits ? { phone: phoneDigits, fio } : x)) : [...prev, { phone: phoneDigits, fio }];
                                  });
                                  setPartnersOpen(false);
                                }
                              } catch {
                                showToast('Не удалось добавить партнёра', 'error');
                              } finally {
                                setPartnerLoading(false);
                              }
                            }}>Добавить</button>
                          </div>
                        ) : (
                          items.map((p, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onClick={() => { setPartnerPhone(p.phone); setPartnersOpen(false); }}>
                              <span className="font-medium">{p.fio || 'Без имени'}</span>
                              <span className="text-gray-500"> — {p.phone}</span>
                            </button>
                          ))
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <Button onClick={onSave}>Сохранить</Button>
            <a className="ml-3 underline" href="/link">Назад к списку</a>
          </div>
        </div>
      )}

      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}


