import { readText, writeText } from './storage';
import path from 'path';

const DATA_FILE = path.join('.data', 'pay_resume.json');

type ResumeEntry = {
  userId: string;
  orderId: number;
  createdAt: string; // ISO
};

type ResumeStore = Record<string, ResumeEntry>;

async function readStore(): Promise<ResumeStore> {
  const raw = await readText(DATA_FILE);
  if (!raw) return {};
  try { return JSON.parse(raw) as ResumeStore; } catch { return {}; }
}

async function writeStore(data: ResumeStore): Promise<void> {
  await writeText(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function createResumeToken(userId: string, orderId: number): Promise<string> {
  const token = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const store = await readStore();
  store[token] = { userId, orderId, createdAt: new Date().toISOString() };
  await writeStore(store);
  return token;
}

export async function resolveResumeToken(token: string, ttlMs = 24 * 60 * 60 * 1000): Promise<ResumeEntry | null> {
  const store = await readStore();
  const entry = store[token];
  if (!entry) return null;
  const ts = Date.parse(entry.createdAt);
  if (!Number.isFinite(ts) || (Date.now() - ts) > ttlMs) return null;
  return entry;
}


