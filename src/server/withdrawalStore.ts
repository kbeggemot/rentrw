import { readText, writeText } from './storage';

export type WithdrawalRecord = {
  userId: string;
  taskId: string | number;
  amountRub: number; // рубли (для UI)
  status?: string | null; // pending/paying/paid/...
  createdAt: string; // ISO
  updatedAt: string; // ISO
  paidAt?: string | null; // ISO
  orgInn?: string | null; // организация, для которой создан вывод
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

export async function recordWithdrawalCreate(userId: string, taskId: string | number, amountRub: number, orgInn?: string | null): Promise<void> {
  const store = await readStore();
  const now = new Date().toISOString();
  const existingIdx = store.items.findIndex((x) => x.userId === userId && x.taskId == taskId);
  const rec: WithdrawalRecord = { userId, taskId, amountRub, status: 'pending', createdAt: now, updatedAt: now, orgInn: orgInn ?? null };
  if (existingIdx !== -1) store.items[existingIdx] = { ...store.items[existingIdx], ...rec };
  else store.items.push(rec);
  await writeStore(store);
  await appendWithdrawalLog(userId, taskId, `created pending (${amountRub})`, 'system');
}

export async function updateWithdrawal(userId: string, taskId: string | number, patch: Partial<WithdrawalRecord>): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((x) => x.userId === userId && x.taskId == taskId);
  if (idx === -1) return; // ignore silently
  const cur = store.items[idx];
  const next: WithdrawalRecord = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  store.items[idx] = next;
  await writeStore(store);
  const src = (patch as any).__source || 'unknown';
  const note = JSON.stringify({ status: patch.status, paidAt: patch.paidAt });
  await appendWithdrawalLog(userId, taskId, `update ${note}`, src);
}

export async function listWithdrawals(userId: string, orgInn?: string | null): Promise<WithdrawalRecord[]> {
  const store = await readStore();
  let arr = store.items.filter((x) => x.userId === userId);
  if (orgInn) {
    const key = String(orgInn).replace(/\D/g, '');
    arr = arr.filter((x) => (x.orgInn ? String(x.orgInn) === key : false));
  }
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Upsert helper for backfills (e.g., when reading from RW tasks list)
export async function upsertWithdrawal(userId: string, payload: Partial<WithdrawalRecord> & { taskId: string | number }): Promise<void> {
  const store = await readStore();
  const idx = store.items.findIndex((x) => x.userId === userId && x.taskId == payload.taskId);
  const now = new Date().toISOString();
  if (idx === -1) {
    const rec: WithdrawalRecord = {
      userId,
      taskId: payload.taskId,
      amountRub: typeof payload.amountRub === 'number' ? payload.amountRub : 0,
      status: payload.status ?? null,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      paidAt: payload.paidAt,
      orgInn: payload.orgInn ?? null,
    };
    store.items.push(rec);
    await appendWithdrawalLog(userId, payload.taskId, `upsert(create) ${JSON.stringify({ status: rec.status })}`, 'backfill');
  } else {
    const cur = store.items[idx];
    store.items[idx] = {
      ...cur,
      amountRub: typeof payload.amountRub === 'number' ? payload.amountRub : (cur.amountRub ?? 0),
      status: typeof payload.status !== 'undefined' ? payload.status : cur.status,
      createdAt: payload.createdAt || cur.createdAt,
      paidAt: typeof payload.paidAt !== 'undefined' ? payload.paidAt : cur.paidAt,
      updatedAt: now,
      orgInn: typeof payload.orgInn !== 'undefined' ? payload.orgInn : cur.orgInn,
    };
    await appendWithdrawalLog(userId, payload.taskId, `upsert(update) ${JSON.stringify({ status: store.items[idx].status })}`, 'backfill');
  }
  await writeStore(store);
}

// ---------- Logs ----------
export async function appendWithdrawalLog(userId: string, taskId: string | number, message: string, source: 'webhook' | 'manual' | 'backfill' | 'system' | 'unknown' = 'unknown'): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), userId, taskId, source, message }) + '\n';
  const key = `.data/withdrawal_${userId}_${String(taskId)}.log`;
  const prev = await readText(key);
  await writeText(key, (prev || '') + line);
}

export async function readWithdrawalLog(userId: string, taskId: string | number): Promise<string> {
  const raw = await readText(`.data/withdrawal_${userId}_${String(taskId)}.log`);
  return raw || '';
}


