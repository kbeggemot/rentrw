import { promises as fs } from 'fs';
import path from 'path';

export type PartnerRecord = {
  phone: string;
  fio: string | null;
  status: string | null; // e.g., validated, pending, etc.
  updatedAt: string; // ISO
};

const DATA_DIR = path.join(process.cwd(), '.data');
const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');

type PartnerStoreData = {
  users: Record<string, PartnerRecord[]>; // userId -> partners
};

async function readStore(): Promise<PartnerStoreData> {
  try {
    const raw = await fs.readFile(PARTNERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PartnerStoreData>;
    const users = parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object' ? parsed.users as Record<string, PartnerRecord[]> : {};
    return { users };
  } catch {
    return { users: {} };
  }
}

async function writeStore(data: PartnerStoreData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PARTNERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function listPartners(userId: string): Promise<PartnerRecord[]> {
  const store = await readStore();
  return Array.isArray(store.users[userId]) ? store.users[userId] : [];
}

export async function upsertPartner(userId: string, partner: PartnerRecord): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const idx = arr.findIndex((p) => p.phone === partner.phone);
  if (idx !== -1) arr[idx] = partner; else arr.push(partner);
  store.users[userId] = arr;
  await writeStore(store);
}


