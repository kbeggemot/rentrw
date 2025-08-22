import { readText, writeText } from './storage';
import path from 'path';

type SalePageEntry = { userId: string; orderId: number; code: string; createdAt: string };
type Store = Record<string, SalePageEntry>; // key: code

const FILE = path.join('.data', 'sale_pages.json');

async function readStore(): Promise<Store> {
  const raw = await readText(FILE);
  if (!raw) return {};
  try { return JSON.parse(raw) as Store; } catch { return {}; }
}

async function writeStore(s: Store): Promise<void> {
  await writeText(FILE, JSON.stringify(s, null, 2));
}

function randomCode(): string {
  // 4 random symbols, any register + digits
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export async function getOrCreateSalePageCode(userId: string, orderId: number): Promise<string> {
  const store = await readStore();
  const existing = Object.values(store).find((e) => e.userId === userId && e.orderId === orderId);
  if (existing) return existing.code;
  // generate unique code
  let len = 4;
  let attempts = 0;
  let code = randomCode();
  while (store[code]) {
    attempts += 1;
    if (attempts > 2000) { len += 1; attempts = 0; }
    // re-generate with possibly increased length
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nxt = '';
    for (let i = 0; i < len; i++) nxt += alphabet[Math.floor(Math.random() * alphabet.length)];
    code = nxt;
  }
  store[code] = { userId, orderId, code, createdAt: new Date().toISOString() };
  await writeStore(store);
  return code;
}

export async function resolveSalePageCode(code: string): Promise<SalePageEntry | null> {
  const store = await readStore();
  return store[code] ?? null;
}


