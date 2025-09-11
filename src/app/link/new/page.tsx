"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { applyAgentCommissionToCart } from '@/lib/pricing';

export default function NewLinkStandalonePage() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  useEffect(() => { (async () => { try { const r = await fetch('/api/settings/token', { cache: 'no-store' }); const d = await r.json(); setHasToken(Boolean(d?.token)); } catch { setHasToken(false); } })(); }, []);
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
  const [startEmptyCart, setStartEmptyCart] = useState(false);
  const [orgProducts, setOrgProducts] = useState<Array<{ id: string; title: string; price: number }>>([]);
  const [agentDesc, setAgentDesc] = useState<string | null>(null);
  const [defaultComm, setDefaultComm] = useState<{ type: 'percent' | 'fixed'; value: number } | null>(null);
  const [linkSumMode, setLinkSumMode] = useState<'custom' | 'fixed'>('custom');
  const [linkAmount, setLinkAmount] = useState('');
  const [linkVat, setLinkVat] = useState<'none' | '0' | '5' | '7' | '10' | '20'>('none');
  const [linkAgent, setLinkAgent] = useState(false);
  const [linkCommType, setLinkCommType] = useState<'percent' | 'fixed'>('percent');
  const [linkCommVal, setLinkCommVal] = useState('');
  const [linkPartner, setLinkPartner] = useState('');
  const [partners, setPartners] = useState<Array<{ phone: string; fio: string | null }>>([]);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [linkMethod, setLinkMethod] = useState<'any' | 'qr' | 'card'>('any');
  const [vanity, setVanity] = useState('');
  const [vanityTaken, setVanityTaken] = useState<boolean | null>(null);
  const [cartDisplay, setCartDisplay] = useState<'grid' | 'list'>('list');
  const [editingPriceIdx, setEditingPriceIdx] = useState<number | null>(null);
  // Terms document upload/select
  const [docs, setDocs] = useState<Array<{ hash: string; name?: string | null; size?: number }>>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showTermsUpload, setShowTermsUpload] = useState(false);

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
    // preload partners for agent selector
    // preload agent description
    (async () => {
      try {
        const r = await fetch('/api/settings/agent', { cache: 'no-store' });
        const j = await r.json();
        if (typeof j?.agentDescription === 'string') setAgentDesc(j.agentDescription);
        const dc = j?.defaultCommission as { type?: 'percent' | 'fixed'; value?: number } | undefined;
        if (dc && (dc.type === 'percent' || dc.type === 'fixed') && typeof dc.value === 'number') {
          setDefaultComm({ type: dc.type, value: dc.value });
        }
      } catch {}
    })();
    (async () => {
      try {
        const r = await fetch('/api/partners', { cache: 'no-store' });
        const d = await r.json();
        const arr = Array.isArray(d?.partners) ? d.partners : [];
        setPartners(arr.map((p: any) => ({ phone: String(p.phone || ''), fio: p.fio ?? null })));
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

  // preload existing docs to reuse
  useEffect(() => { (async () => { try { const r = await fetch('/api/docs', { cache: 'no-store' }); const d = await r.json(); const arr = Array.isArray(d?.items) ? d.items : []; setDocs(arr); setShowTermsUpload(false); } catch {} })(); }, []);

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

  // Derived cart with agent commission applied (for live preview)
  const cartNumeric = useMemo(() => (
    cart.map((c) => ({ title: c.title, price: Number(String(c.price || '0').replace(',', '.')), qty: Number(String(c.qty || '1').replace(',', '.')) }))
  ), [cart]);
  const commissionValid = useMemo(() => linkAgent && ((linkCommType === 'percent' && Number(linkCommVal.replace(',', '.')) >= 0) || (linkCommType === 'fixed' && Number(linkCommVal.replace(',', '.')) > 0)), [linkAgent, linkCommType, linkCommVal]);
  const effectiveCart = useMemo(() => {
    if (!commissionValid) return cartNumeric;
    const v = Number(linkCommVal.replace(',', '.'));
    try { return applyAgentCommissionToCart(cartNumeric, linkCommType, v).adjusted; } catch { return cartNumeric; }
  }, [cartNumeric, commissionValid, linkCommType, linkCommVal]);
  const agentLine = useMemo(() => {
    if (!commissionValid || effectiveCart.length === 0) return null;
    const T = cartNumeric.reduce((s, r) => s + r.price * r.qty, 0);
    const v = Number(linkCommVal.replace(',', '.'));
    const A = linkCommType === 'percent' ? T * (v / 100) : v;
    const agentAmount = Math.round((Math.min(Math.max(A, 0), T) + Number.EPSILON) * 100) / 100;
    return { title: agentDesc || 'Услуги агента', price: agentAmount, qty: 1 };
  }, [commissionValid, agentDesc, linkCommType, linkCommVal, cartNumeric, effectiveCart.length]);

  // Автоподстановка дефолтной ставки при включении агентской продажи
  useEffect(() => {
    if (!linkAgent) return;
    if (linkCommVal.trim().length > 0) return;
    if (!defaultComm) return;
    setLinkCommType(defaultComm.type);
    setLinkCommVal(String(defaultComm.value));
  }, [linkAgent, defaultComm]);

  // При смене настроек агента снимаем фокус с цены, чтобы показать пониженные значения
  useEffect(() => {
    setEditingPriceIdx(null);
  }, [linkAgent, linkCommType, linkCommVal]);

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
      if (selectedDoc) payload.termsDocHash = selectedDoc;
      if (mode === 'cart') {
        const normalized = cart.filter((c) => c.id).map((c) => ({
          id: c.id,
          title: c.title,
          price: Number((c.price || '0').replace(',', '.')),
          qty: Number((c.qty || '1').replace(',', '.')),
        })).filter((c) => c.price > 0 && c.qty > 0);
        if (normalized.length === 0) { showToast('Добавьте хотя бы одну позицию в корзину', 'error'); return; }
        // If agent — adjust prices proportionally and add agent line client-side
        if (linkAgent && linkCommType && linkCommVal.trim().length > 0) {
          const v = Number(linkCommVal.replace(',', '.'));
          if (Number.isFinite(v)) {
            const adj = applyAgentCommissionToCart(normalized.map(i => ({ title: i.title, price: i.price, qty: i.qty })), linkCommType, v);
            payload.cartItems = adj.adjusted;
            payload.agentDescription = agentDesc || null;
          } else {
            payload.cartItems = normalized;
          }
        } else {
          payload.cartItems = normalized;
        }
        payload.allowCartAdjust = allowCartAdjust;
        payload.startEmptyCart = allowCartAdjust ? startEmptyCart : false;
        payload.cartDisplay = cartDisplay;
        // Укажем исходную сумму для сервера (нормализуем в число с точкой)
        const total = normalized.reduce((sum, r) => sum + (r.price * r.qty), 0);
        payload.amountRub = Number.isFinite(total) ? total : undefined;
      }
      const r = await fetch('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) {
        const code = d?.error;
        if (code === 'MIN_10') { showToast('Сумма должна быть ≥ 10 ₽', 'error'); return; }
        if (code === 'MIN_NET_10') { showToast('Сумма за вычетом комиссии должна быть ≥ 10 ₽', 'error'); return; }
        if (code === 'AGENT_VAT_FORBIDDEN') { showToast('Самозанятый не может реализовывать позиции с НДС', 'error'); return; }
        if (code === 'TITLE_REQUIRED') showToast('Укажите название ссылки', 'error');
        else if (code === 'DESCRIPTION_REQUIRED') showToast('Укажите описание услуги', 'error');
        else if (code === 'INVALID_AMOUNT') showToast('Укажите корректную сумму', 'error');
        else if (code === 'COMMISSION_TYPE_REQUIRED') showToast('Выберите тип комиссии', 'error');
        else if (code === 'COMMISSION_VALUE_REQUIRED') showToast('Укажите комиссию агента', 'error');
        else if (code === 'COMMISSION_PERCENT_RANGE') showToast('Комиссия должна быть 0–100%', 'error');
        else if (code === 'COMMISSION_FIXED_POSITIVE') showToast('Укажите фиксированную комиссию (> 0)', 'error');
        else if (code === 'PARTNER_PHONE_REQUIRED') showToast('Укажите телефон партнёра', 'error');
        else if (code === 'PARTNER_NOT_REGISTERED') showToast('Партнёр не завершил регистрацию в Рокет Ворк', 'error');
        else if (code === 'PARTNER_NOT_VALIDATED') showToast('Партнёр не может принять оплату: нет статуса самозанятого', 'error');
        else if (code === 'PARTNER_NOT_VALIDATED_OR_NOT_SE_IP') showToast('Партнёр не может принять оплату: не смз или ип', 'error');
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
      let copied = false;
      try {
        await navigator.clipboard.writeText(new URL(`/link/${encodeURIComponent(d?.item?.code)}`, window.location.origin).toString());
        copied = true;
      } catch {}
      // Перенаправляем в общий раздел и показываем тост об успехе
      try {
        sessionStorage.setItem('flash', copied ? 'COPIED' : 'OK');
      } catch {}
      window.location.href = '/link';
    } catch {
      showToast('Не удалось создать ссылку', 'error');
    }
  };

  if (hasToken === false) {
    return (
      <div className="max-w-3xl mx-auto pt-0 pb-4">
        <header className="mb-4" style={{minHeight: '40px'}}>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Новая платёжная страница</h1>
            <a href="/link" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
          </div>
        </header>
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm max-w-3xl">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">Для начала работы укажите токен своей организации, полученный в Рокет Ворк.</p>
          <a href="/settings" className="inline-block">
            <button className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Перейти в настройки</button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <header className="mb-4" style={{minHeight: '40px'}}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Новая платёжная страница</h1>
          <a href="/link" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">Создайте постоянную ссылку для оплаты или собственный интернет-магазин</p>
      </header>

      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4 shadow-sm">
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
            <div className="text-base font-semibold mb-2">Что продаете?</div>
            <div className="flex gap-2 mb-3">
              <button type="button" className={`px-3 h-9 rounded border ${mode==='service'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('service')}>Свободная услуга</button>
              <button type="button" className={`px-3 h-9 rounded border ${mode==='cart'?'bg-black text-white':'bg-white text-black dark:text-black'}`} onClick={() => setMode('cart')}>Собрать корзину</button>
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
                      <div className="mt-2 w-44">
                        <input
                          className="block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 pl-2 h-9 text-sm"
                          value={linkAmount.replace('.', ',')}
                          onChange={(e) => {
                            // Нормализуем ввод: точка -> запятая в UI, но в стейте храним с точкой для вычислений
                            const raw = e.target.value.replace(/[^0-9,\.]/g, '');
                            const withComma = raw.replace(/\./g, ',');
                            // для внутреннего состояния заменим запятую на точку
                            const normalized = withComma.replace(/,/g, '.');
                            setLinkAmount(normalized);
                          }}
                          placeholder="0,00"
                          inputMode="decimal"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="md:flex-shrink-0">
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">НДС</label>
                    <select className="w-44 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkVat} onChange={(e) => setLinkVat(e.target.value as any)}>
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
              <div className="space-y-2">
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Выберите нужные позиции на витрине</label>
                <div className="space-y-2">
                  {cart.map((row, idx) => (
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
                              const norm = String(title || '').trim().toLowerCase();
                              if (norm === 'все позиции') {
                                setCart((prev) => {
                                  const key = (id: string, t: string) => `${id||''}::${t.toLowerCase()}`;
                                  const existing = new Set(prev.map(r => key(r.id, r.title)));
                                  const toAdd = orgProducts.filter(p => !existing.has(key(p.id, p.title)));
                                  if (toAdd.length === 0) return prev;
                                  const out = [...prev];
                                  const first = toAdd[0];
                                  out[idx] = { id: first.id, title: first.title, price: String(first.price ?? 0), qty: '1' };
                                  for (let j = 1; j < toAdd.length; j++) {
                                    const m = toAdd[j];
                                    out.push({ id: m.id, title: m.title, price: String(m.price ?? 0), qty: '1' });
                                  }
                                  return out;
                                });
                                return;
                              }
                              const p = orgProducts.find((x)=> x.title.toLowerCase() === norm);
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
                            <option value="Все позиции" />
                            {orgProducts.map((p)=> (<option key={p.id} value={p.title} />))}
                          </datalist>
                        </div>
                        <div>
                          {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Количество</div>) : null}
                          <input className="w-20 sm:w-24 rounded border px-2 h-9 text-sm" placeholder="Кол-во" value={row.qty} onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, qty: e.target.value } : r))} />
                        </div>
                        <div>
                          {idx===0 ? (<div className="text-xs text-gray-500 mb-1">Цена, ₽</div>) : null}
                          {(() => {
                            const baseNum = Number(String(row.price || '0').replace(',', '.'));
                            const shownNum = (commissionValid && editingPriceIdx !== idx && effectiveCart[idx]) ? Number(effectiveCart[idx].price || 0) : baseNum;
                            const shownStr = (commissionValid && editingPriceIdx !== idx)
                              ? shownNum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
                              : String(row.price || '').replace('.', ',');
                            return (
                              <input
                                className="w-24 sm:w-28 rounded border px-2 h-9 text-sm"
                                placeholder="Цена"
                                value={shownStr}
                                onFocus={() => setEditingPriceIdx(idx)}
                                onBlur={() => setEditingPriceIdx(null)}
                                onChange={(e)=> setCart((prev)=> prev.map((r,i)=> i===idx ? { ...r, price: e.target.value.replace(',', '.') } : r))}
                              />
                            );
                          })()}
                        </div>
                        <div className="flex flex-col">
                          {idx===0 ? (<div className="text-xs mb-1 invisible">label</div>) : null}
                          <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border flex items-center justify-center" onClick={()=> setCart((prev)=> prev.filter((_,i)=> i!==idx))}>✕</button>
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
                          <input className="w-20 sm:w-24 rounded border px-2 h-9 text-sm bg-gray-100" value="1" readOnly disabled />
                        </div>
                        <div>
                          <input className="w-24 sm:w-28 rounded border px-2 h-9 text-sm bg-gray-100" value={agentLine.price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })} readOnly disabled />
                        </div>
                        <div className="flex flex-col">
                          <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border text-gray-400 flex items-center justify-center" disabled>✕</button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <button type="button" className="px-3 h-9 rounded border" onClick={()=> setCart((prev)=> [...prev, { id:'', title:'', price:'', qty:'1' }])}>+ Добавить</button>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">Нет нужной позиции? <a className="underline" href="/products/new" target="_blank" onClick={()=> showToast('Откроем создание позиции в новом окне', 'info')}>Создать новую позицию на витрине</a></div>
                {/* Итоговая сумма по корзине (с учётом агентской) */}
                <div className="mt-2">
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Сумма, ₽</label>
                  <div className="w-44">
                    <input className="w-full rounded border pl-2 h-9 text-sm bg-gray-100 dark:bg-gray-900 dark:border-gray-700" value={(() => { const eff = effectiveCart.reduce((s,r)=> s + Number(r.price||0)*Number(r.qty||0), 0); const A = agentLine ? agentLine.price : 0; const total = eff + A; return Number.isFinite(total) ? total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; })()} readOnly disabled />
                  </div>
                </div>
                {/* Повторную подпись агентской комиссии под суммой убрали */}
              </div>
            )}
          </div>
          {/* Настройка отображения корзины (перенесено выше чекбокса) */}
          {mode === 'cart' ? (
            <div className="md:col-span-2">
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Отображение витрины</label>
              <div className="flex flex-wrap gap-2 text-sm">
                <label className={`flex items-center justify-center px-3 h-9 rounded border cursor-pointer text-center ${cartDisplay==='list'?'bg-black text-white':'bg-white text-black dark:text-black'}`} style={{ lineHeight: 1.1 }}>
                  <input type="radio" name="cart_display" className="hidden" checked={cartDisplay==='list'} onChange={() => setCartDisplay('list')} />
                  Показывать строками, маленькие превью
                </label>
                <label className={`flex items-center justify-center px-3 h-9 rounded border cursor-pointer text-center ${cartDisplay==='grid'?'bg-black text-white':'bg-white text-black dark:text-black'}`} style={{ lineHeight: 1.1 }}>
                  <input type="radio" name="cart_display" className="hidden" checked={cartDisplay==='grid'} onChange={() => setCartDisplay('grid')} />
                  Показывать сеткой, большие превью
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm mt-3">
                <input type="checkbox" checked={allowCartAdjust} onChange={(e)=> { const v = e.target.checked; setAllowCartAdjust(v); if (!v) setStartEmptyCart(false); }} />
                <span>Разрешить покупателю изменять набор и количество позиций</span>
              </label>
              <label className="flex items-center gap-2 text-sm mt-2">
                <input type="checkbox" checked={startEmptyCart} onChange={(e)=> setStartEmptyCart(e.target.checked)} disabled={!allowCartAdjust} />
                <span>Начинать с пустой корзины</span>
              </label>
            </div>
          ) : null}
          {/* Terms document block (placed before agent settings) */}
          <div className="md:col-span-2 mt-2">
            <div className="font-semibold mb-1">Документ для оплаты</div>
            <div className="text-xs text-gray-600 mb-2">Загрузите оферту с условиями: покажем ссылку и попросим согласие перед оплатой</div>
            <div className="mb-2">
              <select
                className="w-full md:w-[28rem] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
                value={(showTermsUpload && !selectedDoc) ? '__upload_new__' : (selectedDoc ?? '')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__upload_new__') {
                    setSelectedDoc(null);
                    setShowTermsUpload(true);
                  } else {
                    setShowTermsUpload(false);
                    setSelectedDoc(v || null);
                  }
                }}
              >
                <option value="">Не использовать</option>
                {docs.map((d) => (
                  <option key={d.hash} value={d.hash}>{d.name || `${d.hash.slice(0,8)}…`}</option>
                ))}
                <option value="__upload_new__">Добавить новый</option>
              </select>
            </div>

            {/* Показ загрузки только при выборе "Добавить новый" */}
            {showTermsUpload ? (
              <div>
                <div className="text-sm mb-1">Файл</div>
                <label className={`w-28 h-28 border border-dashed border-gray-300 dark:border-gray-700 rounded-md flex items-center justify-center text-xs cursor-pointer bg-white dark:bg-gray-900 ${uploading ? 'opacity-60' : ''}`}>
                  <input type="file" accept="application/pdf" className="hidden" disabled={uploading} onChange={async (e)=>{
                    const inputEl = e.currentTarget as HTMLInputElement | null;
                    const f = inputEl && inputEl.files ? inputEl.files[0] : null; if (!f) return;
                    if (f.type !== 'application/pdf') { showToast('Загрузите файл в формате PDF', 'error'); return; }
                    if (f.size > 5*1024*1024) { showToast('Файл слишком большой. Загрузите файл размером до 5 МБ', 'error'); return; }
                    try {
                      setUploading(true);
                      const body = await f.arrayBuffer();
                      const res = await fetch('/api/docs', { method:'POST', headers: { 'Content-Type': 'application/pdf', 'x-file-name': encodeURIComponent(f.name) }, body });
                      const d = await res.json();
                      if (!res.ok) {
                        const code = d?.error; if (code==='INVALID_FORMAT') showToast('Загрузите файл в формате PDF','error'); else if (code==='TOO_LARGE') showToast('Файл слишком большой. Загрузите файл размером до 5 МБ','error'); else showToast('Не удалось открыть файл. Попробуйте другой PDF','error');
                        return;
                      }
                      const h = d?.item?.hash; if (h) {
                        setSelectedDoc(h);
                        setDocs((prev)=> { const exists = prev.some(x=> x.hash===h); return exists ? prev.map(x=> x.hash===h ? { ...x, name: f.name, size: f.size } : x) : [{ hash: h, name: f.name, size: f.size }, ...prev]; });
                        // Refresh docs list to avoid any races and guarantee presence in dropdown
                        try {
                          const r2 = await fetch('/api/docs', { cache: 'no-store' });
                          const j2 = await r2.json();
                          const arr2 = Array.isArray(j2?.items) ? j2.items : [];
                          setDocs((prev)=>{
                            const by = new Map(prev.map(x=>[x.hash,x] as const));
                            for (const it of arr2) by.set(it.hash, { hash: it.hash, name: it.name, size: it.size });
                            return Array.from(by.values());
                          });
                        } catch {}
                        setShowTermsUpload(false);
                        showToast('Документ загружен','success');
                      }
                    } catch { showToast('Не удалось открыть файл. Попробуйте другой PDF', 'error'); }
                    finally { setUploading(false); if (inputEl) inputEl.value=''; }
                  }} />
                  <span>{uploading ? 'Загрузка…' : 'Добавить'}</span>
                </label>
                <div className="text-xs text-gray-600 mt-1">Только PDF. До 5 МБ на файл.</div>
              </div>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <div className="text-base font-semibold mb-1">Принимаете оплату как Агент?</div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={linkAgent} onChange={(e) => setLinkAgent(e.target.checked)} />
              <span>Агентская продажа</span>
            </label>
            <div className="text-xs text-gray-500 mt-1">
              Разделите оплату между вами и партнёром (самозанятым или ИП). Укажите свою долю вознаграждения.
              <span className="ml-1 text-gray-700 dark:text-gray-300">Описание услуги агента:</span>
              <span className="ml-1 text-black dark:text-white">{agentDesc || 'Услуги агента'}</span>
              <span className="ml-1">(<a href="/settings" className="underline">изменить</a>)</span>
            </div>
            {linkAgent ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <select className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" value={linkCommType} onChange={(e) => setLinkCommType(e.target.value as any)}>
                  <option value="percent">%</option>
                  <option value="fixed">₽</option>
                </select>
                <input className="w-32 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm" placeholder="Комиссия" value={linkCommVal} onChange={(e) => setLinkCommVal(e.target.value)} />
                <div className="relative flex-1 min-w-[14rem]">
                  <input
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 h-9 text-sm"
                    placeholder="Телефон или ФИО партнёра"
                    value={(() => {
                      const digits = linkPartner.replace(/\D/g, '');
                      const found = partners.find((p) => p.phone.replace(/\D/g, '') === digits);
                      return found?.fio ? `${found.fio} — ${digits || linkPartner}` : linkPartner;
                    })()}
                    onChange={(e) => { setLinkPartner(e.target.value); setPartnersOpen(true); }}
                    onFocus={() => setPartnersOpen(true)}
                    onBlur={() => setTimeout(() => setPartnersOpen(false), 150)}
                  />
                  {/* никаких внешних подписей */}
                  {partnersOpen ? (
                    <div className="absolute left-0 top-full mt-1 w-[22rem] max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow">
                      {(() => {
                        const q = linkPartner.toLowerCase();
                        const qDigits = q.replace(/\D/g, '');
                        const items = partners.filter((p) => {
                          const phoneDigits = p.phone.replace(/\D/g, '');
                          const phoneOk = qDigits.length > 0 && phoneDigits.includes(qDigits);
                          const fioOk = (p.fio || '').toLowerCase().includes(q);
                          return qDigits.length > 0 ? phoneOk : (fioOk || phoneOk);
                        });
                        return items.length === 0 ? (
                          qDigits ? (
                            <div className="px-2 py-2 text-xs">
                              <button type="button" className="px-2 py-1 text-sm rounded border hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async () => {
                                const phoneDigits = linkPartner.replace(/\D/g, '');
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
                            <div className="px-2 py-2 text-xs text-gray-500">Ничего не найдено</div>
                          )
                        ) : (
                          items.map((p, i) => (
                            <button key={i} type="button" className="w-full text-left px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-900" onMouseDown={() => { setLinkPartner(p.phone); setPartnersOpen(false); }}>
                              <span className="font-medium">{p.fio || 'Без имени'}</span>
                              <span className="text-gray-500"> — {p.phone}</span>
                            </button>
                          ))
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
                {/* без отдельной строки ФИО */}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={onCreate} disabled={uploading}>Создать</Button>
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


