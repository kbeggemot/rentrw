import { readText, writeText } from './storage';

export type ResetTokenRecord = {
  userId: string;
  email: string;
  token: string;
  expiresAt: number; // epoch ms
};

const RESET_FILE = '.data/reset_tokens.json';

async function readAll(): Promise<ResetTokenRecord[]> {
  const raw = await readText(RESET_FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { items?: ResetTokenRecord[] };
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch { return []; }
}

async function writeAll(items: ResetTokenRecord[]): Promise<void> {
  await writeText(RESET_FILE, JSON.stringify({ items }, null, 2));
}

export async function createResetToken(rec: ResetTokenRecord): Promise<void> {
  const items = await readAll();
  // Remove existing tokens for user
  const filtered = items.filter((x) => x.userId !== rec.userId);
  filtered.push(rec);
  await writeAll(filtered);
}

export async function consumeResetToken(token: string): Promise<ResetTokenRecord | null> {
  const items = await readAll();
  const idx = items.findIndex((x) => x.token === token);
  if (idx === -1) return null;
  const rec = items[idx];
  const now = Date.now();
  const remaining = items.filter((_, i) => i !== idx);
  await writeAll(remaining);
  if (rec.expiresAt < now) return null;
  return rec;
}


