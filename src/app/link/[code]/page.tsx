"use client";

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { applyAgentCommissionToCart } from '@/lib/pricing';

// Very lightweight RU genitive case inflector for full name like "Фамилия Имя Отчество"
// Covers common male patterns; indeclinable and rare patterns are returned unchanged
function declineSurnameGenitive(s: string): string {
  const low = s.toLowerCase();
  if (/^(ко|енко|их|ых)$/.test(low.slice(-3)) || /(?:ко|енко|иха|ых)$/i.test(s)) return s; // indeclinable
  if (/(ко|енко|их|ых|о|е|ё|и|у|ю)$/i.test(low)) return s; // indeclinable endings
  if (/(ский|цкий)$/i.test(low)) return s.slice(0, -2) + 'го';
  if (/(ий|ый|ой)$/i.test(low)) return s.slice(0, -2) + 'ого';
  if (/ь$/i.test(low)) return s.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(low)) return s + 'а';
  return s;
}
function declineNameGenitive(s: string): string {
  const irregular: Record<string, string> = {
    'Пётр': 'Петра', 'Петр': 'Петра', 'Лев': 'Льва', 'Павел': 'Павла', 'Яков': 'Якова',
    'Илья': 'Ильи', 'Фома': 'Фомы', 'Никита': 'Никиты', 'Андрей': 'Андрея', 'Сергей': 'Сергея',
    'Алексей': 'Алексея', 'Григорий': 'Григория', 'Матвей': 'Матвея', 'Юрий': 'Юрия', 'Дмитрий': 'Дмитрия'
  };
  if (irregular[s]) return irregular[s];
  const low = s.toLowerCase();
  if (/ий$/i.test(low)) return s.slice(0, -2) + 'ия';
  if (/й$/i.test(low)) return s.slice(0, -1) + 'я';
  if (/ь$/i.test(low)) return s.slice(0, -1) + 'я';
  if (/а$/i.test(low)) return s.slice(0, -1) + 'ы';
  if (/я$/i.test(low)) return s.slice(0, -1) + 'и';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(low)) return s + 'а';
  return s;
}
function declinePatronymicGenitive(s: string): string {
  const low = s.toLowerCase();
  if (/ович$/i.test(low)) return s + 'а'; // овича
  if (/евич$/i.test(low)) return s + 'а';
  if (/ич$/i.test(low)) return s + 'а';
  return s;
}
function declineFioGenitive(full: string): string {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return declineSurnameGenitive(parts[0]);
  if (parts.length === 2) return `${declineSurnameGenitive(parts[0])} ${declineNameGenitive(parts[1])}`;
  return `${declineSurnameGenitive(parts[0])} ${declineNameGenitive(parts[1])} ${declinePatronymicGenitive(parts[2])}`;
}

function declineOrgNameGenitive(name: string | null | undefined): string | null {
  if (!name) return null;
  const raw = String(name).trim();
  const m = /^\s*ИП\s+(.+)$/i.exec(raw);
  if (m) {
    const gen = declineFioGenitive(m[1].trim());
    return `ИП ${gen}`;
  }
  return raw;
}

type LinkData = {
  code: string;
  userId: string;
  title: string;
  description: string;
  orgName?: string | null;
  sumMode: 'custom' | 'fixed';
  amountRub?: number | null;
  vatRate?: 'none' | '0' | '5' | '7' | '10' | '20' | null;
  isAgent?: boolean;
  commissionType?: 'percent' | 'fixed' | null;
  commissionValue?: number | null;
  partnerPhone?: string | null;
  method?: 'any' | 'qr' | 'card';
  cartItems?: Array<{ id?: string | null; title: string; price: number; qty: number }> | null;
  allowCartAdjust?: boolean;
  cartDisplay?: 'list' | 'grid';
  agentDescription?: string | null;
};

export default function PublicPayPage(props: { params: Promise<{ code?: string }> }) {
  // In Next 15, route params in Client Components are a Promise. Unwrap with React.use()
  const unwrapped = use(props.params) || {} as { code?: string };
  const raw = typeof unwrapped.code === 'string' ? unwrapped.code : '';
  // Accept /link/[code] and /link/s/[code]
  const code = raw;
  const [data, setData] = useState<LinkData | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'qr' | 'card'>('qr');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (text: string) => { setToast(text); setTimeout(() => setToast(null), 3000); };
  const [started, setStarted] = useState(false);
  const [payLocked, setPayLocked] = useState(false);
  const [cart, setCart] = useState<Array<{ id?: string | null; title: string; price: number; qty: number }>>([]);
  const [addQuery, setAddQuery] = useState('');
  const [addHint, setAddHint] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewer, setViewer] = useState<{ open: boolean; photos: string[]; index: number }>({ open: false, photos: [], index: 0 });
  const [fadeIn, setFadeIn] = useState(true);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const [partnerFio, setPartnerFio] = useState<string | null>(null);
  const [agentDesc, setAgentDesc] = useState<string | null>(null);
  const orgNameGen = useMemo(() => declineOrgNameGenitive(data?.orgName || null), [data?.orgName]);
  const metaSentRef = useRef(false);

  function getTelegramUserId(): string | null {
    try {
      const raw = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      if (typeof raw === 'number' || typeof raw === 'string') return String(raw);
    } catch {}
    try {
      const init: string | undefined = (window as any)?.Telegram?.WebApp?.initData;
      if (typeof init === 'string' && init.includes('user=')) {
        const sp = new URLSearchParams(init);
        const userStr = sp.get('user');
        if (userStr) {
          const obj = JSON.parse(userStr);
          const id = obj?.id;
          if (typeof id === 'number' || typeof id === 'string') return String(id);
        }
      }
    } catch {}
    // Desktop Telegram may pass tgWebAppData in URL (search or hash). Try to parse
    try {
      const url = new URL(window.location.href);
      const param = url.searchParams.get('tgWebAppData') || (url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')).get('tgWebAppData') : null);
      if (param) {
        const decoded = decodeURIComponent(param);
        const sp = new URLSearchParams(decoded);
        const userStr = sp.get('user');
        if (userStr) {
          const obj = JSON.parse(userStr);
          const id = obj?.id;
          if (typeof id === 'number' || typeof id === 'string') return String(id);
        }
      }
    } catch {}
    return null;
  }

  function getTelegramUserMeta(): { id?: string | null; first_name?: string | null; last_name?: string | null; username?: string | null } {
    try {
      const u = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user;
      if (u && (typeof u === 'object')) {
        return {
          id: (typeof u.id === 'number' || typeof u.id === 'string') ? String(u.id) : null,
          first_name: typeof u.first_name === 'string' ? u.first_name : null,
          last_name: typeof u.last_name === 'string' ? u.last_name : null,
          username: typeof u.username === 'string' ? u.username : null,
        };
      }
    } catch {}
    try {
      const init: string | undefined = (window as any)?.Telegram?.WebApp?.initData;
      if (typeof init === 'string' && init.includes('user=')) {
        const sp = new URLSearchParams(init);
        const userStr = sp.get('user');
        if (userStr) {
          const obj = JSON.parse(userStr);
          return {
            id: (typeof obj?.id === 'number' || typeof obj?.id === 'string') ? String(obj.id) : null,
            first_name: typeof obj?.first_name === 'string' ? obj.first_name : null,
            last_name: typeof obj?.last_name === 'string' ? obj.last_name : null,
            username: typeof obj?.username === 'string' ? obj.username : null,
          };
        }
      }
    } catch {}
    try {
      const url = new URL(window.location.href);
      const packed = url.searchParams.get('tgWebAppData') || (url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')).get('tgWebAppData') : null);
      if (packed) {
        const decoded = decodeURIComponent(packed);
        const sp = new URLSearchParams(decoded);
        const userStr = sp.get('user');
        if (userStr) {
          const obj = JSON.parse(userStr);
          return {
            id: (typeof obj?.id === 'number' || typeof obj?.id === 'string') ? String(obj.id) : null,
            first_name: typeof obj?.first_name === 'string' ? obj.first_name : null,
            last_name: typeof obj?.last_name === 'string' ? obj.last_name : null,
            username: typeof obj?.username === 'string' ? obj.username : null,
          };
        }
      }
    } catch {}
    return {};
  }

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

  // Load current agent description from settings of link owner (respect selected org)
  useEffect(() => {
    (async () => {
      try {
        if (!data?.userId) return;
        const headers: Record<string, string> = { 'x-user-id': data.userId } as any;
        if (data?.orgName) {
          // org_inn может быть не на странице, попробуем взять его из cookie API уже умеет x-org-inn
          try {
            const cookieInn = document.cookie.split('; ').find((c) => c.startsWith('org_inn='))?.split('=')[1];
            if (cookieInn) headers['x-org-inn'] = decodeURIComponent(cookieInn);
          } catch {}
        }
        const r = await fetch('/api/settings/agent', { cache: 'no-store', headers });
        const j = await r.json().catch(() => ({}));
        if (typeof j?.agentDescription === 'string') setAgentDesc(j.agentDescription);
      } catch {}
    })();
  }, [data?.userId]);

  // Load partner FIO for agent sale header
  useEffect(() => {
    (async () => {
      try {
        const phone = (data?.isAgent && data?.partnerPhone) ? String(data.partnerPhone) : '';
        const digits = phone.replace(/\D/g, '');
        if (!digits) { setPartnerFio(null); return; }
        try {
          const cached = sessionStorage.getItem(`fio.g.${digits}`);
          if (cached && cached.trim().length > 0) setPartnerFio(cached);
        } catch {}
        const headers: Record<string, string> = data?.userId ? { 'x-user-id': data.userId } as any : {};
        // Передадим выбранную организацию, если есть (в веб‑вью cookie может не прийти)
        try {
          if (data?.orgName) {
            const cookieInn = document.cookie.split('; ').find((c) => c.startsWith('org_inn='))?.split('=')[1];
            if (cookieInn) headers['x-org-inn'] = decodeURIComponent(cookieInn);
          }
        } catch {}
        const r = await fetch(`/api/partners?phone=${encodeURIComponent(digits)}`, { cache: 'no-store', headers, credentials: 'include' as RequestCredentials });
        const d = await r.json().catch(() => ({}));
        const found = Array.isArray(d?.partners) ? (d.partners as any[]).find((p) => String(p.phone || '').replace(/\D/g, '') === digits) : null;
        const fioN = (found?.fio && String(found.fio).trim().length > 0) ? String(found.fio).trim() : null;
        const gen = fioN ? declineFioGenitive(fioN) : null;
        setPartnerFio(gen);
        try { if (gen) sessionStorage.setItem(`fio.g.${digits}`, gen); } catch {}
      } catch { setPartnerFio(null); }
    })();
  }, [data?.isAgent, data?.partnerPhone]);

  // Flow state
  const [taskId, setTaskId] = useState<string | number | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [awaitingPay, setAwaitingPay] = useState(false);
  const [payError, setPayError] = useState(false);
  const [receipts, setReceipts] = useState<{ prepay?: string | null; full?: string | null; commission?: string | null; npd?: string | null }>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [summary, setSummary] = useState<{ amountRub?: number; description?: string | null; createdAt?: string | null; items?: Array<{ title: string; qty: number }> | null } | null>(null);
  const [isSalePage, setIsSalePage] = useState(false);

  const pollRef = useRef<number | null>(null);
  const payUrlPollRef = useRef<number | null>(null);
  const payUrlFailRef = useRef<number>(0);
  const statusFailRef = useRef<number>(0);

  // Animated dots for pending states
  const [dots, setDots] = useState('.');
  useEffect(() => {
    let timer: number | null = null;
    const waitingForLink = Boolean(taskId) && !payUrl;
    // Keep animating if any receipt is still missing (e.g., commission not yet available)
    const someReceiptMissing = (!(receipts.prepay || receipts.full)) || (Boolean(data?.isAgent) && !receipts.commission);
    const waitingForConfirm = awaitingPay;
    const active = loading || waitingForLink || waitingForConfirm || someReceiptMissing;
    if (active) {
      timer = window.setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
      }, 400) as unknown as number;
    } else {
      setDots('.');
    }
    return () => { if (timer) window.clearInterval(timer); };
  }, [loading, taskId, payUrl, awaitingPay, receipts.prepay, receipts.full, receipts.commission, receipts.npd, data?.isAgent]);

  // Client-side fetch with timeout (browser fetch has no default timeout and may hang indefinitely)
  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000) => {
    const ms = Number.isFinite(Number(timeoutMs)) ? Math.max(1, Math.floor(Number(timeoutMs))) : 15_000;
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), ms) as unknown as number;
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      try { window.clearTimeout(t); } catch {}
    }
  };

  const toErrMsg = (e: unknown, fallback: string) => {
    if (e instanceof Error) {
      if ((e as any).name === 'AbortError') return 'Таймаут запроса. Попробуйте ещё раз.';
      const m = String(e.message || '').trim();
      return m || fallback;
    }
    return fallback;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve sale page by code first; fallback to payment link by code
      try {
        const r1 = await fetch(`/api/sale-page/${encodeURIComponent(code)}`, { cache: 'no-store' });
        if (r1.ok) {
          const d = await r1.json();
          const userId: string | undefined = d?.userId;
          const sale = d?.sale;
          setIsSalePage(true);
          if (userId) {
            setData((prev) => (prev || { code, userId, title: '', description: '' } as any));
            // Проверяем наличие активного токена организации для оплаты
            try {
              const orgRes = await fetch(`/api/organizations/status?uid=${encodeURIComponent(userId)}${d?.orgInn ? `&org=${encodeURIComponent(String(d.orgInn))}` : ''}`, { cache: 'no-store' });
              const orgD = await orgRes.json().catch(() => ({}));
              if (!orgRes.ok || orgD?.hasToken !== true) {
                setPayLocked(true);
                setMsg('Оплата временно недоступна. Пожалуйста, уточните детали у продавца.');
              }
            } catch {}
          }
          // Even если это код sale-page, подгрузим конфиг платёжной ссылки и сольём поля
          try {
            const lr = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store' });
            if (lr.ok) {
              const ld = await lr.json();
              if (!cancelled) {
                if (!ld?.orgName) {
                  setData(null);
                  setMsg('Ссылка не найдена');
                } else {
                setData((prev) => ({ ...(prev || {} as any), ...(ld || {} as any) } as any));
                if (ld?.sumMode === 'fixed' && typeof ld?.amountRub === 'number') setAmount(String(ld.amountRub));
                if (ld?.method === 'card') setMethod('card'); else setMethod('qr');
                  if (Array.isArray(ld?.cartItems)) {
                    try {
                      const startEmpty = !!(ld as any)?.startEmptyCart;
                      if (startEmpty && ld?.allowCartAdjust) {
                        setCart([]);
                      } else {
                        setCart((ld.cartItems as any[]).map((c: any) => ({ id: c?.id ?? null, title: String(c?.title || ''), price: Number(c?.price || 0), qty: Number(c?.qty || 1) })));
                      }
                    } catch {}
                  }
                }
              }
            }
          } catch {}

          if (sale) {
            setTaskId(sale.taskId);
            setSummaryFromSale(sale);
            // Open details automatically for sale pages to show success-like panel
            setDetailsOpen(true);
            try {
              const st = String(sale?.status || '').toLowerCase();
              if (st && ['paid','transfered','transferred'].includes(st)) setIsFinal(true);
            } catch {}
            // Подтянем itemsSnapshot из локального стора продаж
            try {
              if (userId && sale.taskId != null) {
                const sres = await fetch(`/api/sales/by-task/${encodeURIComponent(String(sale.taskId))}`, { cache: 'no-store', headers: { 'x-user-id': userId } as any });
                if (sres.ok) {
                  const sj = await sres.json();
                  const sl = sj?.sale;
                  const items = Array.isArray(sl?.itemsSnapshot) ? (sl.itemsSnapshot as any[]).map((i: any) => ({ title: String(i?.title || ''), qty: Number(i?.qty || 1) })) : null;
                  if (items && items.length > 0) setSummary((prev) => ({ ...(prev || {}), items }));
                }
              }
            } catch {}
          }
        } else {
          throw new Error('not_sale_page');
        }
      } catch {
        try {
          const res = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store' });
          const d = await res.json();
          if (!res.ok) throw new Error(d?.error || 'NOT_FOUND');
          if (cancelled) return;
          if (!d?.orgName) {
            setData(null);
            setMsg('Ссылка не найдена');
          } else {
          if (d?.disabled) {
            setData(null);
            setMsg('Ссылка не найдена');
          } else {
          // Seed cart state BEFORE exposing data to UI to avoid initial flicker
          try {
            if (Array.isArray(d?.cartItems)) {
              const startEmpty = !!(d as any)?.startEmptyCart;
              if (startEmpty && d?.allowCartAdjust) {
                setCart([]);
              } else {
                setCart((d.cartItems as any[]).map((c: any) => ({ id: c?.id ?? null, title: String(c?.title || ''), price: Number(c?.price || 0), qty: Number(c?.qty || 1) })));
              }
            }
          } catch {}
          setData(d);
          }
          }
          // Проверяем наличие токена и для режима оплаты по ссылке, если есть владелец
          try {
            if (d?.userId) {
              const orgRes = await fetch(`/api/organizations/status?uid=${encodeURIComponent(String(d.userId))}${d?.orgInn ? `&org=${encodeURIComponent(String(d.orgInn))}` : ''}`, { cache: 'no-store' });
              const orgD = await orgRes.json().catch(() => ({}));
              if (!orgRes.ok || orgD?.hasToken !== true) {
                setPayLocked(true);
                setMsg('Оплата временно недоступна. Пожалуйста, уточните детали у продавца.');
              }
            }
          } catch {}
          if (d?.sumMode === 'fixed' && typeof d?.amountRub === 'number') setAmount(String(d.amountRub));
          if (d?.method === 'card') setMethod('card'); else setMethod('qr');
          if (Array.isArray(d?.cartItems)) {
            try {
              const startEmpty = !!(d as any)?.startEmptyCart;
              if (startEmpty && d?.allowCartAdjust) {
                setCart([]);
              } else {
                setCart((d.cartItems as any[]).map((c: any) => ({ id: c?.id ?? null, title: String(c?.title || ''), price: Number(c?.price || 0), qty: Number(c?.qty || 1) })));
              }
            } catch {}
          }
        } catch (e) { if (!cancelled) setMsg('Ссылка не найдена'); }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  function setSummaryFromSale(sale: any) {
    try {
      const items = Array.isArray(sale?.itemsSnapshot) ? (sale.itemsSnapshot as any[]).map((i: any) => ({ title: String(i?.title || ''), qty: Number(i?.qty || 1) })) : null;
      setSummary({ amountRub: sale.amountRub, description: sale.description, createdAt: sale.createdAt, items });
      setReceipts({ prepay: sale.ofdUrl || null, full: sale.ofdFullUrl || null, commission: sale.commissionUrl || null, npd: sale.npdReceiptUri || null });
      if (typeof sale?.isAgent === 'boolean') setData((prev) => (prev ? { ...prev, isAgent: Boolean(sale.isAgent) } as any : prev));
    } catch {}
  }

  // Accept tgu from URL or session and use as fallback for payerTgId
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const tgu = url.searchParams.get('tgu');
      if (tgu) sessionStorage.setItem('tg_user_id', tgu);
    } catch {}
  }, []);

  function getTelegramUserIdStrong(): string | null {
    const fromFn = getTelegramUserId();
    if (fromFn) return fromFn;
    try { const v = sessionStorage.getItem('tg_user_id'); if (v) return v; } catch {}
    try {
      // cookie from Mini App entry
      const m = document.cookie.split('; ').find((c)=>c.startsWith('tg_uid='));
      if (m) { const v = decodeURIComponent(m.split('=')[1]); if (v) return v; }
    } catch {}
    try { const url = new URL(window.location.href); const tgu = url.searchParams.get('tgu'); if (tgu) return tgu; } catch {}
    return null;
  }

  function getTelegramUserMetaFromCookies(): { first_name?: string | null; last_name?: string | null; username?: string | null } {
    const read = (k: string) => { try { const m = document.cookie.split('; ').find((c)=>c.startsWith(`${k}=`)); return m ? decodeURIComponent(m.split('=')[1]) : null; } catch { return null; } };
    return { first_name: read('tg_fn'), last_name: read('tg_ln'), username: read('tg_un') };
  }

  // If returned from bank (?paid=1), try to restore last taskId from localStorage and resume polling
  useEffect(() => {
    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(search);
      if (params.get('paid') === '1' && !taskId) {
        const raw = localStorage.getItem(`lastPay:${code}`);
        const sidExpected = params.get('sid');
        if (raw) {
          const obj = JSON.parse(raw);
          const ttlOk = obj?.ts && (Date.now() - Number(obj.ts) < 1800000);
          const sidOk = !sidExpected || (obj?.sid && obj.sid === sidExpected);
          if (ttlOk && sidOk && obj && obj.taskId) {
            setTaskId(obj.taskId);
            setAwaitingPay(true);
            startPoll(obj.taskId);
            startPayUrlPoll(obj.taskId);
            try { localStorage.removeItem(`lastPay:${code}`); } catch {}
          }
        }
        try { const url = new URL(window.location.href); url.searchParams.delete('paid'); url.searchParams.delete('sid'); window.history.replaceState({}, '', url.toString()); } catch {}
      }
    } catch {}
    // run only once after initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // helpers
  const mskToday = () => new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
  const isValidEmail = (s: string) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s.trim());

  // adjusted (displayed) sum of items
  // Восстановим исходные цены за единицу из сохранённых пониженных (если агент был включен)
  const baseUnits = useMemo(() => {
    if (!data || !Array.isArray(data.cartItems)) return [] as number[];
    const currentUnits: Array<number | null> = (data.cartItems as any[]).map((c: any) => (typeof c?.priceCurrent === 'number' && Number.isFinite(c.priceCurrent) ? Number(c.priceCurrent) : null));
    const hasCurrent = currentUnits.some((v) => v != null);
    if (hasCurrent) {
      return currentUnits.map((v, idx) => (v != null ? v : Number((data.cartItems as any[])[idx]?.price || 0)));
    }
    // otherwise, restore from saved lowered units if agent link
    const savedUnits: number[] = (data.cartItems as any[]).map((c: any) => Number(c?.price || 0));
    if (!data.isAgent || !data.commissionType || typeof data.commissionValue !== 'number') return savedUnits;
    const v = Number(data.commissionValue);
    if (data.commissionType === 'percent') {
      const k = 1 - (v / 100);
      const restored = savedUnits.map((u) => (k > 0 ? Math.round(((u / k) + Number.EPSILON) * 100) / 100 : u));
      return restored;
    }
    // fixed — восстановим добавив долю на единицу из сохранённого общего количества
    const savedQty: number[] = (data.cartItems as any[]).map((c: any) => Number(c?.qty || 0));
    const totalQty = savedQty.reduce((s, q) => s + (Number.isFinite(q) ? q : 0), 0);
    const perUnit = totalQty > 0 ? (v / totalQty) : 0;
    return savedUnits.map((u) => Math.round(((u + perUnit) + Number.EPSILON) * 100) / 100);
  }, [data]);

  // Сумма отображаемых цен (после понижения, если агент включен)
  const cartAdjustedSum = useMemo(() => {
    if (!(Array.isArray(cart) && cart.length > 0)) return 0;
    const baseCart = cart.map((i, idx) => ({
      title: i.title,
      price: Number((baseUnits[idx] ?? i.price) || 0),
      qty: Number(i.qty || 0),
    }));
    if (!data?.isAgent || !data.commissionType || typeof data.commissionValue !== 'number') {
      const total = baseCart.reduce((s, r) => s + (Number(r.price || 0) * Number(r.qty || 0)), 0);
      return Number.isFinite(total) ? total : 0;
    }
    try {
      const adjusted = applyAgentCommissionToCart(baseCart, data.commissionType as any, Number(data.commissionValue)).adjusted;
      const total = adjusted.reduce((s, r) => s + r.price * r.qty, 0);
      return Number.isFinite(total) ? total : 0;
    } catch {
      const total = baseCart.reduce((s, r) => s + (Number(r.price || 0) * Number(r.qty || 0)), 0);
      return Number.isFinite(total) ? total : 0;
    }
  }, [cart, data?.isAgent, data?.commissionType, data?.commissionValue, baseUnits]);

  function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
  const agentLine = useMemo(() => {
    if (!data?.isAgent || !Array.isArray(cart) || cart.length === 0 || !data.commissionType || typeof data.commissionValue !== 'number') return null;
    try {
      const baseCart = cart.map((i, idx) => ({ title: i.title, price: Number((baseUnits[idx] ?? i.price) || 0), qty: Number(i.qty || 0) }));
      const res = applyAgentCommissionToCart(baseCart, data.commissionType as any, Number(data.commissionValue));
      return { title: agentDesc || data.agentDescription || 'Услуги агента', price: res.agentAmount, qty: 1 };
    } catch {
      return null;
    }
  }, [data?.isAgent, data?.commissionType, data?.commissionValue, data?.agentDescription, cart, baseUnits, agentDesc]);

  const effectiveCart = useMemo(() => {
    if (!(Array.isArray(cart) && cart.length > 0)) return cart;
    if (!data?.isAgent || !data.commissionType || typeof data.commissionValue !== 'number') return cart;
    try {
      const baseCart = cart.map((i, idx) => ({ title: i.title, price: Number((baseUnits[idx] ?? i.price) || 0), qty: Number(i.qty || 0) }));
      const adjusted = applyAgentCommissionToCart(baseCart, data.commissionType as any, Number(data.commissionValue)).adjusted;
      return adjusted.map((a, i) => ({ ...cart[i], price: a.price }));
    } catch {
      return cart;
    }
  }, [cart, data?.isAgent, data?.commissionType, data?.commissionValue, baseUnits]);

  const canPay = useMemo(() => {
    if (!data) return false;
    const isCartMode = Array.isArray(cart) && cart.length > 0;
    const n = isCartMode ? (cartAdjustedSum + (agentLine ? agentLine.price : 0)) : Number((data.sumMode === 'fixed' ? (data.amountRub ?? 0) : Number(amount.replace(',', '.'))));
    if (!Number.isFinite(n) || n <= 0) return false;
    const minOk = data.isAgent
      ? (n - (data.commissionType === 'percent' ? n * (Number(data.commissionValue || 0) / 100) : Number(data.commissionValue || 0))) >= 10
      : n >= 10;
    return minOk && isValidEmail(email);
  }, [data, amount, email, cartAdjustedSum, agentLine, cart]);

  // Validate before pay with detailed messages
  const validateBeforePay = (): boolean => {
    if (!data) return false;
    if (Array.isArray(cart) && cart.length > 0) {
      if (data.allowCartAdjust) {
        const badQty = cart.some((i) => !Number.isFinite(Number(i.qty)) || Number(i.qty) <= 0);
        if (badQty) { showToast('Ошибка суммы: количество должно быть больше нуля'); return false; }
      }
      const total = Number(cartAdjustedSum + (agentLine ? agentLine.price : 0));
      if (!(total > 0)) { showToast('Ошибка суммы: итоговая сумма должна быть больше нуля'); return false; }
    } else if (data.sumMode === 'custom') {
      const n = Number(String(amount || '0').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) { showToast('Ошибка суммы: введите положительное число'); return false; }
    }
    if (!isValidEmail(email)) { showToast('Введите корректный email'); return false; }
    return true;
  };

  const startPoll = (uid: string | number) => {
    if (pollRef.current) return;
    const tick = async () => {
      try {
        const r = await fetchWithTimeout(`/api/rocketwork/tasks/${encodeURIComponent(String(uid))}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: (() => {
            const h: Record<string, string> = {};
            if (data?.userId) h['x-user-id'] = String(data.userId);
            try { const inn = (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g,'') : ''; if (inn) h['x-org-inn'] = inn; } catch {}
            return h as any;
          })(),
        }, 15_000);
        if (!r.ok) {
          const d = await r.json().catch(() => ({} as any));
          const msg = String(d?.error || `Ошибка ${r.status}`);
          statusFailRef.current += 1;
          if (statusFailRef.current >= 6) {
            setPayError(true);
            setMsg(msg);
            if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
            setAwaitingPay(false);
            return;
          }
          throw new Error(msg);
        }
        statusFailRef.current = 0;
        const t = await r.json();
        const aoStatus = String((t?.acquiring_order?.status || t?.task?.acquiring_order?.status || '')).toLowerCase();
        if (aoStatus) setIsFinal(['paid', 'transfered', 'transferred'].includes(aoStatus));
        // Try to read receipts directly from RW if available (rare when with_ofd_receipt=false)
        const rwPre = t?.ofd_url || t?.acquiring_order?.ofd_url || null;
        const rwFull = t?.ofd_full_url || t?.acquiring_order?.ofd_full_url || null;
        const rwCom = t?.additional_commission_ofd_url || t?.task?.additional_commission_ofd_url || t?.additional_commission_url || t?.task?.additional_commission_url || null;
        const rwNpd = t?.receipt_uri || t?.task?.receipt_uri || null;
        // Prefer local sale store where callbacks and Ferma polling land
        let salePre: string | null | undefined;
        let saleFull: string | null | undefined;
        let saleCom: string | null | undefined;
        let saleNpd: string | null | undefined;
        try {
          const sres = await fetch(`/api/sales/by-task/${encodeURIComponent(String(uid))}`, { cache: 'no-store', headers: data?.userId ? { 'x-user-id': data.userId } as any : undefined });
          if (sres.ok) {
            const sj = await sres.json();
            const sl = sj?.sale;
            salePre = sl?.ofdUrl ?? null;
            saleFull = sl?.ofdFullUrl ?? null;
            saleCom = sl?.additionalCommissionOfdUrl ?? null;
            saleNpd = sl?.npdReceiptUri ?? null;
            try {
              const items = Array.isArray(sl?.itemsSnapshot) ? (sl.itemsSnapshot as any[]).map((i: any) => ({ title: String(i?.title || ''), qty: Number(i?.qty || 1) })) : null;
              if (items && items.length > 0) setSummary((prev) => ({ ...(prev || {}), items }));
            } catch {}
          }
        } catch {}
        const pre = (salePre ?? rwPre ?? null) as string | null;
        const full = (saleFull ?? rwFull ?? null) as string | null;
        const com = (saleCom ?? rwCom ?? null) as string | null;
        const npd = (saleNpd ?? rwNpd ?? null) as string | null;
        setReceipts({ prepay: pre, full, commission: com, npd });
        if (['paid', 'transfered', 'transferred'].includes(aoStatus)) {
          // Stop when we have purchase and, if agent sale, commission (or when any receipt exists and it's not agent)
          const purchaseReady = Boolean(pre || full);
          const commissionReady = data?.isAgent ? Boolean(com) : true;
          if ((purchaseReady && commissionReady) || npd) {
            if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
            setAwaitingPay(false);
            return;
          }
        }
      } catch (e) {
        const msg = toErrMsg(e, 'Ошибка сети. Попробуйте ещё раз.');
        statusFailRef.current += 1;
        if (statusFailRef.current >= 6) {
          setPayError(true);
          setMsg(msg);
          if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
          setAwaitingPay(false);
          return;
        }
      }
      pollRef.current = window.setTimeout(tick, 2000) as unknown as number;
    };
    pollRef.current = window.setTimeout(tick, 1000) as unknown as number;
  };

  const startPayUrlPoll = (uid: string | number) => {
    if (payUrlPollRef.current) return;
    const tick = async () => {
      try {
        const r = await fetchWithTimeout(`/api/rocketwork/task-status/${encodeURIComponent(String(uid))}`, {
          cache: 'no-store',
          headers: (() => {
            const h: Record<string, string> = {};
            if (data?.userId) h['x-user-id'] = String(data.userId);
            try { const inn = (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g,'') : ''; if (inn) h['x-org-inn'] = inn; } catch {}
            return h as any;
          })(),
        }, 15_000);
        if (!r.ok) {
          const d = await r.json().catch(() => ({} as any));
          const msg = String(d?.error || `Ошибка ${r.status}`);
          payUrlFailRef.current += 1;
          if (payUrlFailRef.current >= 6) {
            setPayError(true);
            setMsg(msg);
            if (payUrlPollRef.current) { window.clearTimeout(payUrlPollRef.current); payUrlPollRef.current = null; }
            setAwaitingPay(false);
            return;
          }
          throw new Error(msg);
        }
        payUrlFailRef.current = 0;
        const t = await r.json();
        const ao = (t && (t.acquiring_order || (t.task && t.task.acquiring_order))) || null;
        const url = ao?.url || ao?.payment_url || null;
        if (url) {
          setPayUrl(url);
          if (payUrlPollRef.current) { window.clearTimeout(payUrlPollRef.current); payUrlPollRef.current = null; }
          return;
        }
      } catch (e) {
        const msg = toErrMsg(e, 'Ошибка сети. Попробуйте ещё раз.');
        payUrlFailRef.current += 1;
        if (payUrlFailRef.current >= 6) {
          setPayError(true);
          setMsg(msg);
          if (payUrlPollRef.current) { window.clearTimeout(payUrlPollRef.current); payUrlPollRef.current = null; }
          setAwaitingPay(false);
          return;
        }
      }
      payUrlPollRef.current = window.setTimeout(tick, 1500) as unknown as number;
    };
    payUrlPollRef.current = window.setTimeout(tick, 1000) as unknown as number;
  };

  const goPay = async () => {
    if (!data) return;
    if (!validateBeforePay()) return;
    try {
      setStarted(true);
      setLoading(true);
      setMsg(null);
      setPayUrl(null);
      setTaskId(null);
      setDetailsOpen(true);
      setPayError(false);
      payUrlFailRef.current = 0;
      statusFailRef.current = 0;
      
      // Validate partner in RW for agent sales before creating task
      if (data.isAgent && data.partnerPhone) {
        try {
          const digits = String(data.partnerPhone).replace(/\D/g, '');
          const res = await fetchWithTimeout('/api/partners/validate', {
            method: 'POST',
            headers: (() => {
              const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-user-id': data.userId };
              try { const inn = (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g, '') : ''; if (inn) h['x-org-inn'] = inn; } catch {}
              return h as any;
            })(),
            body: JSON.stringify({ phone: digits })
          }, 25_000);
          
          if (!res.ok) {
            const errorData = await res.json();
            const code = errorData?.error;
            
            // Always update partner with current data from RW, even on error
            if (errorData?.partnerData) {
              try {
                await fetch('/api/partners', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId },
                  body: JSON.stringify(errorData.partnerData)
                });
              } catch (e) {
                // Silent fail - partner update is not critical for payment flow
              }
            }
            
            if (code === 'PARTNER_NOT_REGISTERED') setMsg('Партнёр не завершил регистрацию в Рокет Ворк');
            else if (code === 'PARTNER_NOT_VALIDATED') setMsg('Партнёр не может принять оплату: нет статуса самозанятого');
            else if (code === 'PARTNER_NO_PAYMENT_INFO') setMsg('Партнёр не указал платёжные реквизиты в Рокет Ворк');
            else setMsg('Ошибка проверки партнёра');
            setLoading(false);
            setStarted(false);
            setDetailsOpen(false);
            return;
          }
          
          const executorData = await res.json();
          
          // Auto-add/update partner if validation successful
          try {
            const fio = executorData?.executor ? [
              executorData.executor.last_name,
              executorData.executor.first_name, 
              executorData.executor.second_name
            ].filter(Boolean).join(' ').trim() : null;
            
            const partner = {
              phone: digits,
              fio: fio || null,
              status: executorData.status || null,
              inn: executorData.inn || null,
              updatedAt: new Date().toISOString(),
              hidden: false
            };
            
            await fetch('/api/partners', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId },
              body: JSON.stringify(partner)
            });
          } catch (e) {
            // Silent fail - partner update is not critical for payment flow
          }
        } catch (e) {
          setMsg(toErrMsg(e, 'Ошибка проверки партнёра'));
          setLoading(false);
          setStarted(false);
          setDetailsOpen(false);
          return;
        }
      }
      
      const isCartMode = Array.isArray(cart) && cart.length > 0;
      const amountNum = isCartMode ? Number(cartAdjustedSum + (agentLine ? agentLine.price : 0)) : (data.sumMode === 'fixed' ? (data.amountRub || 0) : Number(amount.replace(',', '.')));
      // Build cart for server: always use ORIGINAL unit prices (baseUnits) + current qty
      const baseCart = isCartMode ? cart.map((i, idx) => ({ id: i.id || null, title: i.title, price: Number((baseUnits[idx] ?? i.price) || 0), qty: Number(i.qty || 0) })) : [];
      const tgMeta = { ...getTelegramUserMeta(), ...getTelegramUserMetaFromCookies() };
      const body: any = {
        amountRub: amountNum,
        description: data.description,
        method: method === 'card' ? 'card' : 'qr',
        clientEmail: email.trim(),
        termsDocHash: (data as any)?.termsDocHash ? String((data as any).termsDocHash) : undefined,
        termsDocName: undefined,
        agentSale: !!data.isAgent,
        agentPhone: data.partnerPhone || undefined,
        commissionType: data.isAgent ? (data.commissionType || undefined) : undefined,
        commissionValue: data.isAgent ? (typeof data.commissionValue === 'number' ? data.commissionValue : undefined) : undefined,
        vatRate: (data.vatRate || 'none'),
        serviceEndDate: mskToday(),
        orgInn: (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g,'') : undefined,
        cartItems: isCartMode ? baseCart : undefined,
        linkCode: code,
        payerTgId: (() => { const id = getTelegramUserIdStrong(); return id ?? undefined; })(),
        payerTgFirstName: (tgMeta.first_name ?? undefined),
        payerTgLastName: (tgMeta.last_name ?? undefined),
        payerTgUsername: (tgMeta.username ?? undefined),
      };
      const res = await fetchWithTimeout('/api/rocketwork/tasks', {
        method: 'POST',
        headers: (() => {
          const h: Record<string, string> = { 'Content-Type': 'application/json' };
          if (data?.userId) h['x-user-id'] = String(data.userId);
          try { const inn = (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g,'') : ''; if (inn) h['x-org-inn'] = inn; } catch {}
          return h as any;
        })(),
        body: JSON.stringify(body)
      }, 30_000);
      const txt = await res.text();
      const d = txt ? JSON.parse(txt) : {};
      if (!res.ok) {
        const code = d?.error;
        if (code === 'Сумма должна быть не менее 10 рублей' || code === 'MIN_10') { setMsg('Сумма должна быть ≥ 10 ₽'); setLoading(false); setStarted(false); setDetailsOpen(false); return; }
        if (code === 'Сумма оплаты за вычетом комиссии должна быть не менее 10 рублей' || code === 'MIN_NET_10') { setMsg('Сумма за вычетом комиссии должна быть ≥ 10 ₽'); setLoading(false); setStarted(false); setDetailsOpen(false); return; }
        if (code === 'AGENT_VAT_FORBIDDEN') { setMsg('Самозанятый не может реализовывать позиции с НДС'); setLoading(false); setStarted(false); setDetailsOpen(false); return; }
        throw new Error(code || 'CREATE_FAILED');
      }
      const tId = d?.task_id;
      setTaskId(tId || null);
      try {
        if (tId && typeof window !== 'undefined') {
          const sidKey = `paySid:${code}`;
          let sid: string | null = sessionStorage.getItem(sidKey);
          if (!sid) {
            sid = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem(sidKey, String(sid));
          }
          localStorage.setItem(`lastPay:${code}`, JSON.stringify({ taskId: tId, ts: Date.now(), sid: String(sid) }));
        }
      } catch {}
      // Fire-and-forget: обновим мету сделки (payerTgId, linkCode) на сервере, чтобы гарантировать сохранение
      try {
        if (tId && data?.userId) {
          const tgId = getTelegramUserIdStrong();
          const meta = getTelegramUserMeta();
          await fetch('/api/sales/meta', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId }, body: JSON.stringify({ taskId: tId, payerTgId: tgId, linkCode: code, payerTgFirstName: meta.first_name ?? null, payerTgLastName: meta.last_name ?? null, payerTgUsername: meta.username ?? null }) });
          metaSentRef.current = true;
        }
      } catch {}
      const url = d?.data?.acquiring_order?.url || d?.data?.acquiring_order?.payment_url || null;
      if (url) setPayUrl(url); else startPayUrlPoll(tId);
      setAwaitingPay(false);
      startPoll(tId);
    } catch (e) {
      const msg = toErrMsg(e, 'Не удалось сформировать платежную ссылку');
      showToast('Не удалось сформировать платежную ссылку');
      setMsg(msg);
      setPayError(true);
      setStarted(false);
    } finally { setLoading(false); }
  };

  // Fallback: if we got taskId later (e.g., resumed or post-init), ensure meta is saved once
  useEffect(() => {
    try { (window as any)?.Telegram?.WebApp?.ready?.(); } catch {}
    if (!metaSentRef.current && taskId && data?.userId) {
      const id = getTelegramUserIdStrong();
      if (id) {
        metaSentRef.current = true;
        fetch('/api/sales/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': data.userId as any },
          body: JSON.stringify({ taskId, payerTgId: id, linkCode: code }),
        }).catch(() => {});
      }
    }
  }, [taskId, data?.userId, code]);

  // Terms consent state — declare before any early return to keep Hooks order stable
  const termsRequired = Boolean((data as any)?.termsDocHash);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const canStart = canPay && !started && !loading && !payLocked && (!termsRequired || termsAccepted);
  const actionBtnClasses = `inline-flex items-center justify-center rounded-lg ${canStart ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'} px-4 h-9 text-sm`;

  if (!data) {
    return (
      <div className="max-w-xl mx-auto">
        <h1 className="text-xl font-semibold mb-2">Оплата</h1>
        <div className="text-gray-600">{msg || 'Загрузка…'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">{data.title}</h1>
      {data.orgName ? (
        <div className="text-sm text-gray-600 mb-4">
          {data.isAgent && data.partnerPhone ? (
            <span>Оплата для {partnerFio || 'партнёра'}, через {orgNameGen || data.orgName}</span>
          ) : (
            <span>Оплата в пользу {orgNameGen || data.orgName}</span>
          )}
        </div>
      ) : null}
      <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4">
        {toast ? (<div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-black text-white text-sm px-3 py-2 rounded shadow">{toast}</div>) : null}
        {payLocked ? (
          <div className="text-sm text-gray-700">{msg || 'Оплата временно недоступна. Пожалуйста, уточните детали у продавца.'}</div>
        ) : (
        <>
        {Array.isArray(cart) && (cart.length > 0 || data.allowCartAdjust) ? (
          <div className="mb-3">
            <div className="text-sm text-gray-600 mb-2">{data.allowCartAdjust ? 'Соберите свою корзину' : 'Ваша корзина'}</div>
            {data.cartDisplay === 'list' ? (
              <div className="flex flex-col gap-2">
                {cart.map((item, idx) => (
                  <div key={idx} className="rounded border p-2 flex items-center gap-3 overflow-x-auto touch-pan-x">
                    <img
                      src={(() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const ph = Array.isArray(fromLink?.photos) ? fromLink.photos[0] : null; return ph || '/window.svg'; } catch { return '/window.svg'; } })()}
                      alt="preview"
                      className={(() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const has = Array.isArray(fromLink?.photos) && fromLink.photos.length > 0; return `h-9 w-9 rounded object-cover bg-gray-100 dark:bg-gray-900 ${has ? 'cursor-pointer' : 'cursor-default'}`; } catch { return 'h-9 w-9 rounded object-cover bg-gray-100 dark:bg-gray-900'; } })()}
                      onClick={() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const arr = Array.isArray(fromLink?.photos) ? (fromLink.photos as string[]) : []; if (!arr.length) return; setViewer({ open: true, photos: arr, index: 0 }); } catch {} }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-xs text-gray-600">Цена: {Number((effectiveCart[idx]?.price ?? item.price) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</div>
                    </div>
                    {data.allowCartAdjust ? (
                      <>
                        <input type="number" min={1} step={1} className="w-14 rounded border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-400" value={String(item.qty)} onChange={(e) => { const raw = e.target.value; const q = raw.trim() === '' ? 0 : Math.max(0, Number(raw)); setCart((prev) => prev.map((it, i) => i === idx ? { ...it, qty: q } : it)); }} />
                        <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border text-sm text-gray-700 flex items-center justify-center" onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}>✕</button>
                      </>
                    ) : null}
                  </div>
                ))}
                {agentLine ? (
                  <div className="rounded border p-2 flex items-center gap-3 bg-gray-50 dark:bg-gray-900">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{agentLine.title}</div>
                      <div className="text-xs text-gray-600">Цена: {Number(agentLine.price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {cart.map((item, idx) => (
                  <div key={idx} className="rounded border p-2">
                    <div className="relative w-full rounded overflow-hidden bg-gray-100 dark:bg-gray-900 mb-2" style={{ aspectRatio: '1 / 1' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={(() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const ph = Array.isArray(fromLink?.photos) ? fromLink.photos[0] : null; return ph || '/window.svg'; } catch { return '/window.svg'; } })()}
                        alt="item"
                        className={(() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const has = Array.isArray(fromLink?.photos) && fromLink.photos.length > 0; return `w-full h-full object-cover bg-gray-100 dark:bg-gray-900 ${has ? 'cursor-pointer' : 'cursor-default'}`; } catch { return 'w-full h-full object-cover bg-gray-100 dark:bg-gray-900'; } })()}
                        onClick={() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => ((id != null && x?.id != null && String(x.id) === String(id)) || x?.title === item.title)) : null; const arr = Array.isArray(fromLink?.photos) ? (fromLink.photos as string[]) : []; if (!arr.length) return; setViewer({ open: true, photos: arr, index: 0 }); } catch {} }}
                      />
                      {(() => { try { const id = item.id || null; const fromLink = Array.isArray(data.cartItems) ? (data.cartItems as any[]).find((x: any) => (x?.id ?? null) === (id ?? null) || x?.title === item.title) : null; const count = Array.isArray(fromLink?.photos) ? fromLink.photos.length : 0; if (count > 1) { return (<></>); } } catch {} return null; })()}
                    </div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-gray-600">Цена: {Number((effectiveCart[idx]?.price ?? item.price) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</div>
                    <div className="mt-2 w-full flex items-center justify-between gap-2">
                      {data.allowCartAdjust ? (
                        <>
                          <input type="number" min={1} step={1} className="w-16 rounded border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-400" value={String(item.qty)} onChange={(e) => { const raw = e.target.value; const q = raw.trim() === '' ? 0 : Math.max(0, Number(raw)); setCart((prev) => prev.map((it, i) => i === idx ? { ...it, qty: q } : it)); }} />
                          <div className="flex-1" />
                          <button type="button" aria-label="Удалить" className="w-9 h-9 rounded border flex items-center justify-center ml-auto bg-white text-black dark:bg-gray-800 dark:text-white dark:border-gray-700" onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}>✕</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
                {agentLine ? (
                  <div className="rounded border p-2 bg-gray-50 dark:bg-gray-900">
                    <div className="text-sm font-medium">{agentLine.title}</div>
                    <div className="text-xs text-gray-600">Цена: {Number(agentLine.price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</div>
                  </div>
                ) : null}
              </div>
            )}
            {data.allowCartAdjust ? (
            <div className="flex items-center gap-2 relative mt-3">
              <div className="relative flex-1">
                <input
                  className="w-full rounded border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-400"
                  placeholder="Найти на витрине…"
                  value={addQuery}
                  onFocus={() => setAddOpen(true)}
                  onChange={(e) => { setAddQuery(e.target.value); setAddHint(null); setAddOpen(true); }}
                  onBlur={() => setTimeout(() => setAddOpen(false), 120)}
                />
                {addOpen ? (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 border rounded bg-white dark:bg-gray-900 max-h-48 overflow-auto shadow">
                    {(() => {
                      const catalog = Array.isArray(data.cartItems) ? (data.cartItems as any[]) : [];
                      const remaining = catalog.filter((p: any) => !cart.some((c) => c.title === p.title));
                      if (remaining.length === 0) return (<div className="px-3 py-2 text-sm text-gray-500">больше ничего нет(</div>);
                      const q = addQuery.trim().toLowerCase();
                      const filtered = q ? remaining.filter((p: any) => String(p?.title || '').toLowerCase().includes(q)) : remaining.slice(0, 8);
                      if (filtered.length === 0) return (<div className="px-3 py-2 text-sm text-gray-500">ничего не найдено</div>);
                      return filtered.map((p: any, i: number) => (
                        <button
                          key={`${p.id || p.title}-${i}`}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                          onMouseDown={() => {
                            const id = p?.id ?? null;
                            setCart((prev) => {
                              const idx = prev.findIndex((x) => (x.id || null) === (id || null) && x.title === p.title);
                              if (idx >= 0) return prev.map((x, j) => (j === idx ? { ...x, qty: Number(x.qty || 0) + 1 } : x));
                              return [...prev, { id, title: String(p.title || ''), price: Number(p.price || 0), qty: 1 }];
                            });
                            setAddQuery(''); setAddHint(null); setAddOpen(false);
                          }}
                        >{String(p.title || '')}</button>
                      ));
                    })()}
                  </div>
                ) : null}
              </div>
              <button type="button" className="rounded border px-3 h-9 text-sm" onClick={() => { const q = addQuery.trim().toLowerCase(); const catalog = Array.isArray(data.cartItems) ? data.cartItems : []; const remaining = catalog.filter((p: any) => !cart.some((c) => c.title === p.title)); if (remaining.length === 0) { setAddHint('больше ничего нет('); setAddOpen(true); return; } if (!q) { setAddOpen(true); return; } const found = (catalog as any[]).find((p: any) => String(p?.title || '').toLowerCase().includes(q)); if (found) { const id = found?.id ?? null; setCart((prev) => { const i = prev.findIndex((x) => (x.id || null) === (id || null) && x.title === found.title); if (i >= 0) return prev.map((x, j) => (j === i ? { ...x, qty: Number(x.qty || 0) + 1 } : x)); return [...prev, { id, title: String(found.title || ''), price: Number(found.price || 0), qty: 1 }]; }); setAddQuery(''); setAddHint(null); } else { setAddHint('больше ничего нет('); setAddOpen(true); } }}>Добавить</button>
            </div>
            ) : null}
            <div className="mt-2">
              <label className="block text-sm text-gray-600 mb-1">Итоговая сумма, ₽</label>
              <input className="w-40 rounded-lg border px-2 h-9 text-sm bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-800" value={(() => { const S = cartAdjustedSum; const A = agentLine ? agentLine.price : 0; const total = S + A; return total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); })()} readOnly disabled />
            </div>
            {/* Фуллскрин просмотрщик */}
            {viewer.open ? (
              <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={() => setViewer({ open: false, photos: [], index: 0 })}>
                <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewer.photos[viewer.index] || '/window.svg'}
                    alt="photo"
                    className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-300 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
                    style={{ transform: `translateX(${touchDeltaX}px)` }}
                    onTouchStart={(e) => { setTouchStartX(e.touches[0].clientX); setTouchDeltaX(0); }}
                    onTouchMove={(e) => { if (touchStartX != null) setTouchDeltaX(e.touches[0].clientX - touchStartX); }}
                    onTouchEnd={() => {
                      const threshold = 50;
                      if (touchDeltaX > threshold) showPrev();
                      else if (touchDeltaX < -threshold) showNext();
                      setTouchStartX(null);
                      setTouchDeltaX(0);
                    }}
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
        ) : (
        <>
        <div className="mb-3">
          <div className="text-sm text-gray-600">За что платим</div>
          <div className="text-sm">{data.description}</div>
        </div>
        <div className="mb-3">
          <label className="block text-sm text-gray-600 mb-1">Сумма, ₽</label>
          {data.sumMode === 'fixed' ? (
                <input className="w-40 rounded-lg border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white" value={(() => { const v = data.amountRub as number | null | undefined; if (typeof v === 'number' && Number.isFinite(v)) { return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } const s = String(v ?? ''); return s.replace('.', ','); })()} readOnly />
          ) : (
                <input className="w-40 rounded-lg border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-400" value={amount.replace('.', ',')} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0,00" />
          )}
          {data.sumMode === 'custom' ? (
            <div className="text-xs text-gray-500 mt-1">Минимальная сумма {data.isAgent ? 'за вычетом комиссии' : ''} — 10 ₽</div>
          ) : null}
        </div>
          </>
        )}
        <div className="mb-3">
          <label className="block text-sm text-gray-600 mb-1">Ваш email</label>
          <input className="w-full sm:w-80 rounded-lg border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-400" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          <div className="text-xs text-gray-500 mt-1">{(() => { try { const hasInstant = Array.isArray(data?.cartItems) && (data.cartItems as any[]).some((i: any) => typeof (i as any)?.instantResult === 'string' && (i as any).instantResult.trim().length > 0); if (hasInstant) return (<span>Отправим чек и <b>вашу покупку</b> на эту почту</span>); } catch {} return 'Отправим чек на эту почту'; })()}</div>
        </div>
        <div className="mb-2">
          <label className="block text-sm text-gray-600 mb-1">Способ оплаты</label>
          {data.method === 'any' ? (
            <select className="border rounded-lg px-2 h-9 text-sm w-40" value={method} onChange={(e) => setMethod(e.target.value as any)}>
              <option value="qr">СБП</option>
              <option value="card">Карта</option>
            </select>
          ) : (
            <input className="w-40 rounded-lg border px-2 h-9 text-sm bg-white text-black dark:bg-gray-800 dark:text-white" value={data.method === 'card' ? 'Карта' : 'СБП'} readOnly />
          )}
        </div>
        {(() => {
          const hash = (data as any)?.termsDocHash ? String((data as any).termsDocHash) : '';
          if (!hash) return null;
          return (
            <div className="mb-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" onChange={(e)=> setTermsAccepted(e.currentTarget.checked)} />
                <span>Я принимаю <a className="underline" href={`/api/docs/${encodeURIComponent(hash)}`} target="_blank" rel="noreferrer">условия</a></span>
              </label>
            </div>
          );
        })()}
        <div className="flex gap-2">
        <button disabled={!canStart} onClick={goPay} className={actionBtnClasses}>
          Перейти к оплате
        </button>
          {payError ? (
            <button onClick={goPay} className="inline-flex items-center justify-center rounded-lg border px-4 h-9 text-sm">
              Повторить
            </button>
          ) : null}
        </div>

        {/* Inline expandable panel (Sales-like) */}
        {detailsOpen ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {!taskId ? (
              started ? (
                <div className="text-gray-600">{`Формируем платежную ссылку${dots}`}</div>
              ) : (
                <div className="text-gray-600">Нажмите «Перейти к оплате», чтобы сформировать ссылку…</div>
              )
            ) : (
              <div className="space-y-2">
                {!payUrl ? (
                  <div className="text-gray-600">{`Формируем платежную ссылку${dots}`}</div>
                ) : (
                  !isFinal ? (
                    <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                      <div className="text-gray-500">Платежная ссылка</div>
                      <a className={`${awaitingPay ? 'text-gray-500' : 'text-black font-semibold'} hover:underline`} href={payUrl} target="_blank" rel="noreferrer" onClick={() => setAwaitingPay(true)}>Оплатить</a>
                    </div>
                  ) : null
                )}
                {awaitingPay && !isFinal ? (
                  <div className="text-gray-600">{`Ждём подтверждения оплаты${dots}`}</div>
                ) : null}
                {isFinal ? (
                  <div className="mt-1 p-2">
                    <div className="text-green-700 font-medium mb-2">Успешно оплачено</div>
                    <div className="grid grid-cols-[9rem_1fr] gap-y-2">
                      {isSalePage ? (
                        <>
                          <div className="text-gray-500">За что платим</div>
                          <div>
                            {(() => {
                              const items = Array.isArray(summary?.items) ? summary!.items! : null;
                              if (items && items.length > 0) {
                                return (
                                  <div className="space-y-1">
                                    {items.map((it, i) => (
                                      <div key={i} className="relative before:content-['•'] before:absolute before:-left-5">
                                        {it.title} — {Number(it.qty || 0)} шт.
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return (summary?.description || data?.title || '—');
                            })()}
                          </div>
                        </>
                      ) : null}
                      {/* Покупка: всегда показываем строку, пока нет ссылки — «Подгружаем…» */}
                      <>
                        <div className="text-gray-500">Чек на покупку</div>
                        {receipts.full || receipts.prepay ? (
                          <a className="text-black font-semibold hover:underline" href={(receipts.full || receipts.prepay)!} target="_blank" rel="noreferrer">Открыть</a>
                        ) : (
                          <div className="text-gray-600">Подгружаем{dots}</div>
                        )}
                      </>
                      {/* Комиссия: показываем строку для агентских продаж сразу, даже если ещё нет ссылки */}
                      {data?.isAgent ? (
                        <>
                          <div className="text-gray-500">Чек на комиссию</div>
                          {receipts.commission ? (
                            <a className="text-black font-semibold hover:underline" href={receipts.commission!} target="_blank" rel="noreferrer">Открыть</a>
                          ) : (
                            <div className="text-gray-600">Подгружаем{dots}</div>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        </>
        )}

        {!payLocked && msg ? <div className="mt-3 text-sm text-gray-600">{msg}</div> : null}
      </div>
      <div className="mt-3">
        <img src="/logo.svg" alt="YPLA" className="inline-block align-baseline dark:invert" style={{ height: '0.75em', width: 'auto', marginLeft: '-6px' }} />
      </div>
    </div>
  );
}


