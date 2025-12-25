import { readText, writeText } from './storage';
import path from 'path';
import { createHmac, timingSafeEqual } from 'crypto';

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

function b64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(input: string): Buffer {
  const s = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

function getSecret(): string {
  return String(process.env.PAY_RESUME_SECRET || process.env.TOKEN_SECRET || '').trim();
}

export async function createResumeToken(userId: string, orderId: number): Promise<string> {
  const secret = getSecret();
  // Prefer stateless signed tokens in production (multi-instance & S3-friendly)
  if (secret) {
    const payload = { uid: String(userId), oid: Number(orderId), iat: Date.now() };
    const body = b64urlEncode(JSON.stringify(payload));
    const sig = b64urlEncode(createHmac('sha256', secret).update(body).digest());
    return `v1.${body}.${sig}`;
  }
  // Fallback to legacy persisted tokens (requires shared storage)
  const token = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const store = await readStore();
  store[token] = { userId, orderId, createdAt: new Date().toISOString() };
  await writeStore(store);
  return token;
}

export async function resolveResumeToken(token: string, ttlMs = 0): Promise<ResumeEntry | null> {
  const t = String(token || '').trim();
  if (!t) return null;

  // Stateless signed token
  if (t.startsWith('v1.')) {
    const secret = getSecret();
    if (!secret) return null;
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    const body = parts[1] || '';
    const sig = parts[2] || '';
    const expected = createHmac('sha256', secret).update(body).digest();
    let got: Buffer;
    try { got = b64urlDecode(sig); } catch { return null; }
    if (got.length !== expected.length) return null;
    try { if (!timingSafeEqual(got, expected)) return null; } catch { return null; }
    let payload: any = null;
    try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); } catch { payload = null; }
    const uid = payload?.uid ? String(payload.uid) : null;
    const oid = Number(payload?.oid);
    const iat = Number(payload?.iat);
    if (!uid || !Number.isFinite(oid)) return null;
    if (ttlMs > 0 && Number.isFinite(iat) && (Date.now() - iat) > ttlMs) return null;
    return { userId: uid, orderId: oid, createdAt: Number.isFinite(iat) ? new Date(iat).toISOString() : new Date().toISOString() };
  }

  // Legacy persisted token
  const store = await readStore();
  const entry = store[t];
  if (!entry) return null;
  const ts = Date.parse(entry.createdAt);
  if (ttlMs > 0 && (!Number.isFinite(ts) || (Date.now() - ts) > ttlMs)) return null;
  return entry;
}


