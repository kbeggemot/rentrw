import { readText, writeText } from './storage';

export type WithdrawalRecord = {
  userId: string;
  taskId: string | number;
  amountRub: number; // рубли (для UI)
  status?: string | null; // pending/paying/paid/...
  createdAt: string; // ISO
  updatedAt: string; // ISO
  paidAt?: string | null; // ISO
};

type Store = { items: WithdrawalRecord[] };

const FILE = '.data/withdrawals.json';

async function readStore(): Promise<Store> {
  const raw = await readText(FILE);
  if (!raw) return { items: [] };
  const data = JSON.parse(raw) as Partial<Store>;
  return { items: Array.isArray(data.items) ? data.items : [] };
}

async function writeStore(store: Store): Promise<void> {
  await writeText(FILE, JSON.stringify(store, null, 2));
}

export async function recordWithdrawalCreate(userId: string, taskId: string | number, amountRub: number): Promise<void> {
  const store = await readStore();
  const now = new Date().toISOString();
  const existingIdx = store.items.findIndex((x) => x.userId === userId && x.taskId == taskId);
  const rec: WithdrawalRecord = { userId, taskId, amountRub, status: 'pending', createdAt: now, updatedAt: now };
  if (existingIdx !== -1) store.items[existingIdx] = { ...store.items[existingIdx], ...rec };
  else store.items.push(rec);
  await writeStore(store);
}

export async function updateWithdrawal(userId: string, taskId: string | number, patch: Partial<WithdrawalRecord>): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((x) => x.userId === userId && x.taskId == taskId);
  if (idx === -1) return; // ignore silently
  const cur = store.items[idx];
  const next: WithdrawalRecord = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  store.items[idx] = next;
  await writeStore(store);
}

export async function listWithdrawals(userId: string): Promise<WithdrawalRecord[]> {
  const store = await readStore();
  const arr = store.items.filter((x) => x.userId === userId);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}


