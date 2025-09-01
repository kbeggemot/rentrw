import { readText, writeText } from './storage';

export type PaymentLink = {
  code: string;
  userId: string;
  orgInn?: string | null;
  title: string;
  description: string;
  sumMode: 'custom' | 'fixed';
  amountRub?: number | null;
  vatRate?: 'none' | '0' | '10' | '20' | null;
  isAgent?: boolean;
  commissionType?: 'percent' | 'fixed' | null;
  commissionValue?: number | null;
  partnerPhone?: string | null;
  method?: 'any' | 'qr' | 'card';
  cartItems?: Array<{ id?: string | null; title: string; price: number; qty: number }> | null;
  allowCartAdjust?: boolean;
  cartDisplay?: 'grid' | 'list' | null;
  createdAt: string;
  hits?: number;
  lastAccessAt?: string | null;
};

type Store = {
  items: PaymentLink[];
};

const FILE = '.data/payment_links.json';

async function readStore(): Promise<Store> {
  const raw = await readText(FILE);
  if (!raw) return { items: [] };
  try { return JSON.parse(raw) as Store; } catch { return { items: [] }; }
}

async function writeStore(store: Store): Promise<void> {
  await writeText(FILE, JSON.stringify(store, null, 2));
}

function genCode(len = 4): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function isCodeTaken(code: string): Promise<boolean> {
  const store = await readStore();
  return store.items.some((i) => i.code === code);
}

export async function createPaymentLink(userId: string, data: Omit<PaymentLink, 'code' | 'userId' | 'createdAt'> & { preferredCode?: string | null }): Promise<PaymentLink> {
  const store = await readStore();
  const exists = new Set(store.items.map((i) => i.code));
  let len = 4;
  let attempts = 0;
  let code = (data as any)?.preferredCode && String((data as any).preferredCode).trim().length > 0 ? String((data as any).preferredCode).trim() : genCode(len);
  while (exists.has(code)) {
    attempts += 1;
    if (attempts > 2000) { len += 1; attempts = 0; }
    code = genCode(len);
  }
  const now = new Date().toISOString();
  const item: PaymentLink = {
    code,
    userId,
    orgInn: (data as any)?.orgInn ? String((data as any).orgInn).replace(/\D/g, '') : 'неизвестно',
    title: data.title,
    description: data.description,
    sumMode: data.sumMode,
    amountRub: data.amountRub ?? null,
    vatRate: (data.vatRate ?? null) as any,
    isAgent: !!data.isAgent,
    commissionType: (data.commissionType ?? null) as any,
    commissionValue: typeof data.commissionValue === 'number' ? data.commissionValue : null,
    partnerPhone: data.partnerPhone ?? null,
    method: data.method || 'any',
    cartItems: Array.isArray((data as any).cartItems) ? ((data as any).cartItems as any[]).map((ci) => ({
      id: ci?.id ?? null,
      title: String(ci?.title || ''),
      price: Number(ci?.price || 0),
      qty: Number(ci?.qty || 1),
    })) : null,
    allowCartAdjust: Boolean((data as any)?.allowCartAdjust),
    cartDisplay: (data as any)?.cartDisplay === 'list' ? 'list' : ((data as any)?.cartDisplay === 'grid' ? 'grid' : null),
    createdAt: now,
    hits: 0,
    lastAccessAt: null,
  };
  store.items.push(item);
  await writeStore(store);
  return item;
}

export async function listPaymentLinks(userId: string): Promise<PaymentLink[]> {
  const store = await readStore();
  return store.items.filter((i) => i.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listPaymentLinksForOrg(userId: string, orgInn: string): Promise<PaymentLink[]> {
  const store = await readStore();
  const inn = (orgInn || '').replace(/\D/g, '');
  return store.items.filter((i) => i.userId === userId && (i.orgInn || '') === inn).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllPaymentLinksForOrg(orgInn: string): Promise<PaymentLink[]> {
  const store = await readStore();
  const inn = (orgInn || '').replace(/\D/g, '');
  return store.items.filter((i) => (i.orgInn || '') === inn).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findLinkByCode(code: string): Promise<PaymentLink | null> {
  const store = await readStore();
  const found = store.items.find((i) => i.code === code) || null;
  return found ?? null;
}

export async function deletePaymentLink(userId: string, code: string): Promise<boolean> {
  const store = await readStore();
  const idx = store.items.findIndex((i) => i.code === code && i.userId === userId);
  if (idx === -1) return false;
  store.items.splice(idx, 1);
  await writeStore(store);
  return true;
}

export async function markLinkAccessed(code: string): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((i) => i.code === code);
  if (idx === -1) return;
  const cur = store.items[idx];
  const next = { ...cur } as PaymentLink;
  next.hits = (typeof cur.hits === 'number' ? cur.hits : 0) + 1;
  next.lastAccessAt = new Date().toISOString();
  store.items[idx] = next;
  await writeStore(store);
}

export async function updatePaymentLink(userId: string, code: string, updates: Partial<PaymentLink>): Promise<PaymentLink | null> {
  const store = await readStore();
  const idx = store.items.findIndex((i) => i.code === code && i.userId === userId);
  if (idx === -1) return null;
  const current = store.items[idx];
  const isCart = Array.isArray(current.cartItems) && (current.cartItems as any[]).length > 0;

  const next: PaymentLink = { ...current };
  if (typeof updates.title === 'string') next.title = updates.title;
  if (!isCart) {
    if (typeof updates.description === 'string') next.description = updates.description;
    if (updates.sumMode === 'custom' || updates.sumMode === 'fixed') next.sumMode = updates.sumMode;
    if (typeof updates.amountRub === 'number' && Number.isFinite(updates.amountRub)) next.amountRub = updates.amountRub;
    if (updates.vatRate === 'none' || updates.vatRate === '0' || updates.vatRate === '10' || updates.vatRate === '20') next.vatRate = updates.vatRate;
    next.cartItems = null;
    next.allowCartAdjust = false;
  } else {
    if (Array.isArray(updates.cartItems)) {
      next.cartItems = updates.cartItems.map((ci: any) => ({
        id: ci?.id ?? null,
        title: String(ci?.title || ''),
        price: Number(ci?.price || 0),
        qty: Number(ci?.qty || 1),
      }));
    }
    if (typeof updates.allowCartAdjust === 'boolean') next.allowCartAdjust = updates.allowCartAdjust;
    if (typeof updates.amountRub === 'number' && Number.isFinite(updates.amountRub)) next.amountRub = updates.amountRub;
    if (updates.cartDisplay === 'list' || updates.cartDisplay === 'grid') next.cartDisplay = updates.cartDisplay;
  }
  if (typeof updates.method === 'string' && (updates.method === 'any' || updates.method === 'qr' || updates.method === 'card')) next.method = updates.method;
  if (typeof updates.isAgent === 'boolean') next.isAgent = updates.isAgent;
  if (next.isAgent) {
    if (updates.commissionType === 'percent' || updates.commissionType === 'fixed') next.commissionType = updates.commissionType;
    if (typeof updates.commissionValue === 'number' && Number.isFinite(updates.commissionValue)) next.commissionValue = updates.commissionValue;
    if (typeof updates.partnerPhone === 'string') next.partnerPhone = updates.partnerPhone;
  } else {
    next.commissionType = null;
    next.commissionValue = null;
    next.partnerPhone = null;
  }

  store.items[idx] = next;
  await writeStore(store);
  return next;
}


