import { readText, writeText } from './storage';

export type PendingRegistration = {
  phone: string;
  email: string;
  password: string; // temporarily stored until confirmation
  code: string;
  expiresAt: number;
};

const FILE = '.data/registration_pending.json';

async function readAll(): Promise<PendingRegistration[]> {
  const raw = await readText(FILE);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { items?: PendingRegistration[] };
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

async function writeAll(items: PendingRegistration[]): Promise<void> {
  await writeText(FILE, JSON.stringify({ items }, null, 2));
}

export async function upsertPending(item: PendingRegistration): Promise<void> {
  const items = await readAll();
  const filtered = items.filter((x) => x.phone === item.phone ? false : x.expiresAt > Date.now());
  filtered.push(item);
  await writeAll(filtered);
}

export async function consumePending(phone: string, code: string): Promise<PendingRegistration | null> {
  const items = await readAll();
  const now = Date.now();
  const idx = items.findIndex((x) => x.phone === phone);
  if (idx === -1) return null;
  const item = items[idx];
  const rest = items.filter((_, i) => i !== idx && items[i].expiresAt > now);
  await writeAll(rest);
  if (item.expiresAt < now) return null;
  if (String(item.code) !== String(code)) return null;
  return item;
}


