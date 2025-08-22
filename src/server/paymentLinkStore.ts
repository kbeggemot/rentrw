import { readText, writeText } from './storage';

export type PaymentLink = {
  code: string;
  userId: string;
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

export async function createPaymentLink(userId: string, data: Omit<PaymentLink, 'code' | 'userId' | 'createdAt'>): Promise<PaymentLink> {
  const store = await readStore();
  const exists = new Set(store.items.map((i) => i.code));
  let len = 4;
  let attempts = 0;
  let code = genCode(len);
  while (exists.has(code)) {
    attempts += 1;
    if (attempts > 2000) { len += 1; attempts = 0; }
    code = genCode(len);
  }
  const now = new Date().toISOString();
  const item: PaymentLink = {
    code,
    userId,
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


