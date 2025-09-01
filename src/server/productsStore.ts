import { readText, writeText } from './storage';

export type ProductRecord = {
  id: string;
  userId: string;
  orgInn: string; // normalized digits
  kind: 'goods' | 'service';
  title: string;
  category?: string | null;
  price: number; // in RUB
  unit: 'усл' | 'шт' | 'упак' | 'гр' | 'кг' | 'м';
  vat: 'none' | '0' | '5' | '7' | '10' | '20';
  sku?: string | null;
  description?: string | null;
  photos?: string[]; // relative paths under .data
  createdAt: string;
  updatedAt: string;
};

type Store = { items: ProductRecord[] };

const FILE = '.data/products.json';

async function readStore(): Promise<Store> {
  const raw = await readText(FILE);
  if (!raw) return { items: [] };
  try { return JSON.parse(raw) as Store; } catch { return { items: [] }; }
}

async function writeStore(store: Store): Promise<void> {
  await writeText(FILE, JSON.stringify(store, null, 2));
}

function genId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function listProductsForOrg(orgInn: string): Promise<ProductRecord[]> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const store = await readStore();
  return store.items.filter(i => i.orgInn === inn).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listCategoriesForOrg(orgInn: string): Promise<string[]> {
  const items = await listProductsForOrg(orgInn);
  const set = new Set<string>();
  for (const it of items) { if (it.category && it.category.trim().length > 0) set.add(it.category.trim()); }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}

export async function createProduct(userId: string, orgInn: string, data: Omit<ProductRecord, 'id' | 'userId' | 'orgInn' | 'createdAt' | 'updatedAt'>): Promise<ProductRecord> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const now = new Date().toISOString();
  const store = await readStore();
  const item: ProductRecord = {
    id: genId(),
    userId,
    orgInn: inn,
    kind: data.kind,
    title: data.title,
    category: data.category?.trim() || null,
    price: Math.max(0, Math.round(Number(data.price) * 100) / 100),
    unit: data.unit,
    vat: data.vat,
    sku: data.sku?.trim() || null,
    description: data.description?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  store.items.push(item);
  await writeStore(store);
  return item;
}

export async function deleteProduct(id: string, orgInn: string): Promise<boolean> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const store = await readStore();
  const idx = store.items.findIndex(i => i.id === id && i.orgInn === inn);
  if (idx === -1) return false;
  store.items.splice(idx, 1);
  await writeStore(store);
  return true;
}

export async function findProductById(id: string, orgInn: string): Promise<ProductRecord | null> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const store = await readStore();
  const item = store.items.find(i => i.id === id && i.orgInn === inn) || null;
  return item ?? null;
}

export async function updateProduct(
  userId: string,
  orgInn: string,
  id: string,
  data: Partial<Omit<ProductRecord, 'id' | 'userId' | 'orgInn' | 'createdAt' | 'updatedAt'>>
): Promise<ProductRecord | null> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const store = await readStore();
  const idx = store.items.findIndex(i => i.id === id && i.orgInn === inn);
  if (idx === -1) return null;
  const current = store.items[idx];
  const next: ProductRecord = { ...current };
  if (data.kind === 'goods' || data.kind === 'service') next.kind = data.kind;
  if (typeof data.title === 'string') next.title = data.title;
  if (typeof data.category !== 'undefined') next.category = data.category ?? null;
  if (typeof data.price === 'number' && Number.isFinite(data.price)) next.price = Math.max(0, Math.round(Number(data.price) * 100) / 100);
  if (data.unit && ['усл','шт','упак','гр','кг','м'].includes(data.unit as any)) next.unit = data.unit as any;
  if (data.vat && ['none','0','5','7','10','20'].includes(data.vat as any)) next.vat = data.vat as any;
  if (typeof data.sku !== 'undefined') next.sku = data.sku ?? null;
  if (typeof data.description !== 'undefined') next.description = data.description ?? null;
  if (Array.isArray(data.photos)) next.photos = data.photos.slice(0, 5);
  next.userId = current.userId || userId;
  next.updatedAt = new Date().toISOString();
  store.items[idx] = next;
  await writeStore(store);
  return next;
}


