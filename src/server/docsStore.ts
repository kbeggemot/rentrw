import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { list, readText, writeText, writeBinary, statFile, readBinary } from './storage';

export type StoredDoc = {
  hash: string;
  name: string | null;
  size: number;
  userId: string;
  uploadedAt: string;
};

type DocsStore = {
  items: StoredDoc[];
};

const FILE = '.data/docs.json';

async function readStore(): Promise<DocsStore> {
  const raw = await readText(FILE);
  if (!raw) return { items: [] };
  try { return JSON.parse(raw) as DocsStore; } catch { return { items: [] }; }
}

async function writeStore(store: DocsStore): Promise<void> {
  await writeText(FILE, JSON.stringify(store, null, 2));
}

export async function listDocs(userId: string): Promise<StoredDoc[]> {
  const s = await readStore();
  return (s.items || []).filter((d) => d.userId === userId);
}

export async function listDocsInUse(userId: string): Promise<StoredDoc[]> {
  const s = await readStore();
  const paymentStoreRaw = await readText('.data/payment_links.json').catch(() => null);
  let links: Array<{ userId?: string; termsDocHash?: string | null }> = [];
  try { links = JSON.parse(paymentStoreRaw || '{}')?.items || []; } catch { links = []; }
  const used = new Set(
    links
      .filter((l) => String(l.userId || '') === String(userId))
      .map((l) => (l.termsDocHash ? String(l.termsDocHash) : ''))
      .filter((h) => h)
  );
  return (s.items || []).filter((d) => d.userId === userId && used.has(d.hash));
}

export async function savePdfForUser(userId: string, fileName: string | null, data: Buffer): Promise<StoredDoc> {
  // compute sha256
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const relPath = `.data/docs/${hash}.pdf`;
  // write if not exists
  try {
    const st = await statFile(relPath);
    if (!st) await writeBinary(relPath, data, 'application/pdf');
  } catch { await writeBinary(relPath, data, 'application/pdf'); }
  const s = await readStore();
  const exists = (s.items || []).find((d) => d.hash === hash && d.userId === userId);
  const meta: StoredDoc = exists || { hash, name: fileName || null, size: data.byteLength, userId, uploadedAt: new Date().toISOString() };
  if (!exists) { s.items.push(meta); await writeStore(s); }
  return meta;
}

export async function resolveDoc(hash: string): Promise<{ buf: Buffer; name: string; size: number } | null> {
  const p = `.data/docs/${hash}.pdf`;
  const rb = await readBinary(p);
  if (!rb) return null;
  // Try to read original name from docs.json
  let display = `${hash}.pdf`;
  try {
    const s = await readStore();
    const found = (s.items || []).find((d) => d.hash === hash);
    if (found && found.name && found.name.trim().length > 0) display = found.name;
  } catch {}
  return { buf: rb.data, name: display, size: rb.data.length };
}

export async function findDocByHash(hash: string): Promise<StoredDoc | null> {
  try {
    const s = await readStore();
    const found = (s.items || []).find((d) => d.hash === hash) || null;
    return found || null;
  } catch {
    return null;
  }
}


