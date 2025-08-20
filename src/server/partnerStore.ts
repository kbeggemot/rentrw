import { readText, writeText } from './storage';

export type PartnerRecord = {
  phone: string;
  fio: string | null;
  status: string | null; // e.g., validated, pending, etc.
  inn?: string | null;
  updatedAt: string; // ISO
  hidden?: boolean; // soft delete flag
};

const PARTNERS_FILE = '.data/partners.json';

type PartnerStoreData = {
  users: Record<string, PartnerRecord[]>; // userId -> partners
};

async function readStore(): Promise<PartnerStoreData> {
  const raw = await readText(PARTNERS_FILE);
  if (!raw) return { users: {} };
  const parsed = JSON.parse(raw) as Partial<PartnerStoreData>;
  const users = parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object' ? (parsed.users as Record<string, PartnerRecord[]>) : {};
  return { users };
}

async function writeStore(data: PartnerStoreData): Promise<void> {
  await writeText(PARTNERS_FILE, JSON.stringify(data, null, 2));
}

export async function listPartners(userId: string): Promise<PartnerRecord[]> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  return arr.filter((p) => !p.hidden);
}

export async function upsertPartner(userId: string, partner: PartnerRecord): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const idx = arr.findIndex((p) => p.phone === partner.phone);
  if (idx !== -1) arr[idx] = partner; else arr.push(partner);
  store.users[userId] = arr;
  await writeStore(store);
}

export async function softDeletePartner(userId: string, phone: string): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const idx = arr.findIndex((p) => p.phone === phone);
  if (idx !== -1) {
    arr[idx] = { ...arr[idx], hidden: true, updatedAt: new Date().toISOString() };
    store.users[userId] = arr;
    await writeStore(store);
  }
}

export async function unhidePartner(userId: string, phone: string): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const idx = arr.findIndex((p) => p.phone === phone);
  if (idx !== -1) {
    arr[idx] = { ...arr[idx], hidden: false, updatedAt: new Date().toISOString() };
    store.users[userId] = arr;
    await writeStore(store);
  }
}


