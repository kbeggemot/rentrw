import { promises as fs } from 'fs';
import path from 'path';

export type OfdReceipt = {
  userId: string;
  receiptId: string;
  fn?: string | null;
  fd?: string | number | null;
  fp?: string | number | null;
  url?: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  payload?: unknown;
};

type Store = { items: OfdReceipt[] };

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE = path.join(DATA_DIR, 'ofd_receipts.json');

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const data = JSON.parse(raw) as Partial<Store>;
    return { items: Array.isArray(data.items) ? data.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), 'utf8');
}

export async function upsertOfdReceipt(rec: OfdReceipt): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((x) => x.userId === rec.userId && x.receiptId === rec.receiptId);
  if (idx !== -1) store.items[idx] = { ...store.items[idx], ...rec, updatedAt: new Date().toISOString() };
  else store.items.push(rec);
  await writeStore(store);
}

export async function listOfdReceipts(userId: string): Promise<OfdReceipt[]> {
  const store = await readStore();
  return (store.items || []).filter((x) => x.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}


