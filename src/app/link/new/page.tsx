"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export default function NewLinkStandalonePage() {
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info'; actionLabel?: string; actionHref?: string } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info', actionLabel?: string, actionHref?: string) => {
    setToast({ msg, kind, actionLabel, actionHref });
    setTimeout(() => setToast(null), 3000);
  };

  const [linkTitle, setLinkTitle] = useState('');
  const [linkDesc, setLinkDesc] = useState('');
  const [mode, setMode] = useState<'service' | 'cart'>('service');
  const [cart, setCart] = useState<Array<{ id: string; title: string; price: string; qty: string }>>([]);
  const [allowCartAdjust, setAllowCartAdjust] = useState(false);
  const [orgProducts, setOrgProducts] = useState<Array<{ id: string; title: string; price: number }>>([]);
  const [linkSumMode, setLinkSumMode] = useState<'custom' | 'fixed'>('custom');
  const [linkAmount, setLinkAmount] = useState('');
  const [linkVat, setLinkVat] = useState<'none' | '0' | '10' | '20'>('none');
  const [linkAgent, setLinkAgent] = useState(false);
  const [linkCommType, setLinkCommType] = useState<'percent' | 'fixed'>('percent');
  const [linkCommVal, setLinkCommVal] = useState('');
  const [linkPartner, setLinkPartner] = useState('');
  const [linkMethod, setLinkMethod] = useState<'any' | 'qr' | 'card'>('any');
  const [vanity, setVanity] = useState('');
  const [vanityTaken, setVanityTaken] = useState<boolean | null>(null);
  const translitMap: Record<string, string> = { 'ё':'yo','й':'y','ц':'ts','у':'u','к':'k','е':'e','н':'n','г':'g','ш':'sh','щ':'sch','з':'z','х':'h','ъ':'','ф':'f','ы':'y','в':'v','а':'a','п':'p','р':'r','о':'o','л':'l','д':'d','ж':'zh','э':'e','я':'ya','ч':'ch','с':'s','м':'m','и':'i','т':'t','ь':'','б':'b','ю':'yu' };
  const normalizeVanity = (s: string) => s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[а-яё]/g, (ch) => translitMap[ch] ?? ch)
    .replace(/[^a-z0-9-]/g, '');
  const blacklist = [
    'bad','fuck','shit','pizda','huy','blyad','whore','suka','deb','pidor','лох','mudak','govno',
    'sex','seks','porno','porn','porr','xxx','intim','bdsm','fetish','fetishy','swing',
    'anal','oral','minet','kunilingus','kuni','erotic','ero',
    'секс','порно','порево','эротик','эротика','интим','минет','кунилингус','анал','оральн',
    'проститут','шлюх','шлюха','бордель','стриптиз',
    'lgbt','lgbtq','lgbtqia','gay','gey','gei','lesbian','lez','lezb','queer','trans','transgender','transex','nonbinary','non-binary','nb','pride','rainbow',
    'гей','геи','гей','лесби','лесбиян','квир','транс','трансгендер','транссексу','небинар','прайд','радуга'
  ];
  const hasIllegalChars = (s: string) => /[^a-zA-Z0-9\-\sа-яА-ЯёЁ]/.test(s);
  const vanitySample = (() => {
    const v = vanity.trim();
    const norm = v ? normalizeVanity(v) : 'ваше-имя';
    return norm.length > 0 ? norm : 'ваше-имя';
  })();

  useEffect(() => {
    // preload products for cart mode selector
    (async () => {
      try {
        const r = await fetch('/api/products', { cache: 'no-store' });
        const d = await r.json();
        const items = Array.isArray(d?.items) ? d.items : [];
        setOrgProducts(items.map((p: any) => ({ id: p.id, title: p.title, price: Number(p.price || 0) })));
      } catch {}
    })();
    const id = setTimeout(async () => {
      const v = vanity.trim();
      if (!v) { setVanityTaken(null); return; }
      try {
        const norm = normalizeVanity(v);
        const r = await fetch(`/api/links?check=${encodeURIComponent(norm)}`, { cache: 'no-store' });
        const d = await r.json();
        setVanityTaken(Boolean(d?.taken));
      } catch { setVanityTaken(null); }
    }, 400);
    return () => clearTimeout(id);
  }, [vanity]);

  // Toast for taken vanity code (no inline error)
  useEffect(() => {
    if (vanityTaken === true) {
      showToast('Адрес уже занят. Выберите другой или используйте название по умолчанию.', 'error');
    }
  }, [vanityTaken]);

  const handleVanityBlur = async () => {
    const raw = vanity.trim();
    if (!raw) return;
    if (hasIllegalChars(raw)) { showToast('Можно использовать только буквы, цифры и дефис.', 'error'); }
    const norm = normalizeVanity(raw);
    if (norm !== vanity) setVanity(norm);
    if (norm.length < 3) { showToast('Слишком коротко: минимум 3 символа.', 'error'); return; }
    if (norm.length > 30) { showToast('Слишком длинно: максимум 30 символов.', 'error'); return; }
    if (blacklist.some((w) => norm.includes(w))) { showToast('Это имя использовать нельзя. Выберите другое.', 'error'); return; }
    try {
      const r = await fetch(`/api/links?check=${encodeURIComponent(norm)}`, { cache: 'no-store' });
      const d = await r.json();
      if (Boolean(d?.taken)) { showToast('Адрес уже занят. Выберите другой или используйте название по умолчанию.', 'error'); setVanityTaken(true); }
      else setVanityTaken(false);
    } catch {}
  };

  const onCreate = async () => {
    try {
      const amountNum = mode === 'service' && linkSumMode === 'fixed' ? Number(linkAmount.replace(',', '.')) : undefined;
      if (mode === 'service' && linkSumMode === 'fixed') {
        if (!Number.isFinite(amountNum as number) || (amountNum as number) <= 0) { showToast('Укажите корректную сумму', 'error'); return; }
        if (linkAgent && linkCommType && linkCommVal.trim().length > 0) {
          const comm = Number(linkCommVal.replace(',', '.'));
          if (Number.isFinite(comm)) {
            const retained = linkCommType === 'percent' ? ((amountNum as number) * (comm / 100)) : comm;
            const net = (amountNum as number) - retained;
            if (net < 10) { showToast('Сумма за вычетом комиссии должна быть ≥ 10 ₽', 'error'); return; }
          }
        } else if (!linkAgent && (amountNum as number) < 10) { showToast('Сумма должна быть ≥ 10 ₽', 'error'); return; }
      }
      if (linkAgent) {
        if (linkPartner.trim().length === 0) { showToast('Укажите телефон партнёра', 'error'); return; }
        if (linkCommVal.trim().length === 0) { showToast('Укажите комиссию агента', 'error'); return; }
        const comm = Number(linkCommVal.replace(',', '.'));
        if (!Number.isFinite(comm)) { showToast('Укажите корректную комиссию', 'error'); return; }
        if (linkCommType === 'percent') {
          if (comm < 0 || comm > 100) { showToast('Комиссия должна быть 0–100%', 'error'); return; }
        } else {
          if (comm <= 0) { showToast('Укажите фиксированную комиссию (> 0)', 'error'); return; }
        }
      }
      const payload: any = {
        title: linkTitle.trim(),
        description: mode === 'service' ? linkDesc.trim() : '',
        sumMode: mode === 'service' ? linkSumMode : 'fixed',
        amountRub: mode === 'service' ? amountNum : undefined,
        vatRate: mode === 'service' ? linkVat : 'none',
        isAgent: linkAgent,
        commissionType: linkAgent ? linkCommType : undefined,
        commissionValue: linkAgent ? Number(linkCommVal.replace(',', '.')) : undefined,
        partnerPhone: linkAgent ? linkPartner.trim() : undefined,
        method: linkMethod,
        preferredCode: vanity.trim() || undefined,
      };
      if (mode === 'cart') {
        const normalized = cart.filter((c) => c.id).map((c) => ({
          id: c.id,
          title: c.title,
          price: Number((c.price || '0').replace(',', '.')),
          qty: Number((c.qty || '1').replace(',', '.')),
        })).filter((c) => c.price > 0 && c.qty > 0);
        if (normalized.length === 0) { showToast('Добавьте хотя бы одну позицию в корзину', 'error'); return; }
        payload.cartItems = normalized;
        payload.allowCartAdjust = allowCartAdjust;
      }
      const r = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) {
        const code = d?.error;
        if (code === 'TITLE_REQUIRED') showToast('Укажите название ссылки', 'error');
        else if (code === 'DESCRIPTION_REQUIRED') showToast('Укажите описание услуги', 'error');
        else if (code === 'INVALID_AMOUNT') showToast('Укажите корректную сумму', 'error');
        else if (code === 'COMMISSION_TYPE_REQUIRED') showToast('Выберите тип комиссии', 'error');
        else if (code === 'COMMISSION_VALUE_REQUIRED') showToast('Укажите комиссию агента', 'error');
        else if (code === 'COMMISSION_PERCENT_RANGE') showToast('Комиссия должна быть 0–100%', 'error');
        else if (code === 'COMMISSION_FIXED_POSITIVE') showToast('Укажите фиксированную комиссию (> 0)', 'error');
        else if (code === 'PARTNER_PHONE_REQUIRED') showToast('Укажите телефон партнёра', 'error');
        else if (code === 'PARTNER_NOT_REGISTERED') showToast('Партнёр не завершил регистрацию в Рокет Ворк', 'error');
        else if (code === 'PARTNER_NOT_VALIDATED') showToast('Партнёр не самозанятый', 'error');
        else if (code === 'PARTNER_NO_PAYMENT_INFO') showToast('У партнёра нет платёжных реквизитов', 'error');
        else if (code === 'NO_TOKEN') showToast('Не задан токен API. Укажите токен в настройках', 'error', 'Открыть настройки', '/settings');
        else if (code === 'VANITY_INVALID') showToast('Можно использовать только буквы, цифры и дефис.', 'error');
        else if (code === 'VANITY_TOO_SHORT') showToast('Слишком коротко: минимум 3 символа.', 'error');
        else if (code === 'VANITY_TOO_LONG') showToast('Слишком длинно: максимум 30 символов.', 'error');
        else if (code === 'VANITY_TAKEN') showToast('Адрес уже занят. Выберите другой или используйте название по умолчанию.', 'error');
        else if (code === 'VANITY_FORBIDDEN') showToast('Это имя использовать нельзя. Выберите другое.', 'error');
        else showToast('Не удалось создать ссылку', 'error');
        return;
      }
      try { await navigator.clipboard.writeText(new URL(`/link/${encodeURIComponent(d?.item?.code)}`, window.location.origin).toString()); showToast('Ссылка создана и скопирована', 'success'); } catch { showToast('Ссылка создана', 'success'); }
    } catch {
      showToast('Не удалось создать ссылку', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Новая платёжная ссылка</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">Создайте постоянную ссылку для оплаты или собственный интернет-магазин</p>
      </header>

      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Название</label>
            <input className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} />
          </div>
          {/* НДС и сумма перенесены ниже, в блок "Свободная услуга" */}
          {/* Блок суммы перенесён ниже */}
          <div>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Тип оплаты</label>
            <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkMethod} onChange={(e) => setLinkMethod(e.target.value as any)}>
              <option value="any">Любой</option>
              <option value="qr">СБП</option>
              <option value="card">Карта</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Адрес вашей страницы в YPLA (необязательно)</label>
            <input
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
              placeholder="moya-ssylka"
              value={vanity}
              onChange={(e) => setVanity(e.target.value)}
              onBlur={handleVanityBlur}
            />
            <div className="text-xs text-gray-500 mt-1">Это короткое имя будет в ссылке: <span className="text-black dark:text-white">https://ypla.ru/link/{vanitySample}</span>. Только буквы, цифры и дефис.</div>
          </div>
          {/* Что продаете? */}
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">Что продаете?</label>
            <div className="flex gap-2 mb-3">
              <button type="button" className={`px-3 h-9 rounded border ${mode==='service'?'bg-black text-white':'bg-white'}`} onClick={() => setMode('service')}>Свободная услуга</button>
              <button type="button" className={`px-3 h-9 rounded border ${mode==='cart'?'bg-black text-white':'bg-white'}`} onClick={() => setMode('cart')}>Собрать корзину</button>
            </div>
            {mode==='service' ? (
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Описание услуги</label>
                <textarea className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-sm" rows={2} value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} />
                <div className="mt-3 space-y-3 md:space-y-0 md:flex md:items-start md:gap-3">
                  <div className="md:flex-shrink-0">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма</label>
                    <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkSumMode} onChange={(e) => setLinkSumMode(e.target.value as any)}>
                      <option value="custom">Укажет покупатель</option>
                      <option value="fixed">Точная</option>
                    </select>
                    {linkSumMode === 'fixed' ? (
                      <input className="block mt-2 w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkAmount} onChange={(e) => setLinkAmount(e.target.value)} placeholder="0.00" />
                    ) : null}
                  </div>
                  <div className="md:flex-shrink-0">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">НДС</label>
                    <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkVat} onChange={(e) => setLinkVat(e.target.value as any)}>
                      <option value="none">Без НДС</option>
                      <option value="0">0%</option>
                      <option value="10">10%</option>
                      <option value="20">20%</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-gray-600 dark:text-gray-400">Выберите нужные позиции на витрине</div>
                <div className="space-y-2">
                  {cart.map((row, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="relative">
                        <div className="text-xs text-gray-500 mb-1">Наименование</div>
                        <input
                          className="min-w-[14rem] rounded border px-2 h-9 text-sm"
                          placeholder="Начните вводить название"
                          list={`products-list-${idx}`}
                          value={row.title}
                          onChange={(e)=>{
                            const title = e.target.value;
                            const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                            setCart((prev)=> prev.map((r,i)=> i===idx ? {
                              id: p?.id || '',
                              title,
                              price: (p ? (p.price ?? 0) : (r.price || '')).toString(),
                              qty: r.qty || '1',
                            } : r));
                          }}
                          onBlur={(e)=>{
                            const title = e.currentTarget.value;
                            const p = orgProducts.find((x)=> x.title.toLowerCase() === title.toLowerCase());
                            if (p) setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, id: p.id, title: p.title, price: (p.price ?? 0).toString() } : r));
                          }}
                        />
                        <datalist id={`products-list-${idx}`}>
                          {orgProducts.map((p)=> (<option key={p.id} value={p.title} />))}
                        </datalist>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Количество</div>
                        <input className="w-20 rounded border px-2 h-9 text-sm" placeholder="Кол-во" value={row.qty} onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, qty: e.target.value } : r))} />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Цена, р</div>
                        <input className="w-28 rounded border px-2 h-9 text-sm" placeholder="Цена" value={row.price} onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, price: e.target.value } : r))} />
                      </div>
                      <div className="flex flex-col">
                        <div className="text-xs mb-1 invisible">label</div>
                        <button type="button" className="px-2 h-9 rounded border" onClick={()=> setCart((prev)=> prev.filter((_,i)=> i!==idx))}>Удалить</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="px-3 h-9 rounded border" onClick={()=> setCart((prev)=> [...prev, { id:'', title:'', price:'', qty:'1' }])}>+ Добавить</button>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Нет нужной позиции? <a className="underline" href="/products/new" target="_blank" onClick={()=> showToast('Откроем создание позиции в новом окне', 'info')}>Создать новую позицию на витрине</a></div>
                <label className="inline-flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={allowCartAdjust} onChange={(e)=> setAllowCartAdjust(e.target.checked)} />
                  <span>Разрешить покупателю изменять набор и количество позиций</span>
                </label>
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={linkAgent} onChange={(e) => setLinkAgent(e.target.checked)} />
              <span>Агентская продажа</span>
            </label>
            {linkAgent ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <select className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkCommType} onChange={(e) => setLinkCommType(e.target.value as any)}>
                  <option value="percent">%</option>
                  <option value="fixed">₽</option>
                </select>
                <input className="w-32 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" placeholder="Комиссия" value={linkCommVal} onChange={(e) => setLinkCommVal(e.target.value)} />
                <input className="w-56 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" placeholder="Телефон партнёра" value={linkPartner} onChange={(e) => setLinkPartner(e.target.value)} />
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={onCreate}>Создать</Button>
        </div>
      </div>

      {toast ? (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm flex items-center gap-3 ${toast.kind === 'success' ? 'bg-green-600 text-white' : toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
          <div>{toast.msg}</div>
          {toast.actionHref ? (
            <a href={toast.actionHref} className="underline font-medium hover:opacity-90 whitespace-nowrap">{toast.actionLabel || 'Открыть'}</a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


