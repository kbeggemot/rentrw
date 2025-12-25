import { readText, writeText } from './storage';

type Lease = {
  id: string;
  expiresAt: number; // epoch ms
  updatedAt: string; // ISO
};

type GlobalBag = typeof globalThis & {
  __rentrw_instance_id?: string;
  __rentrw_leases?: Map<string, { isLeader: boolean; expiresAt: number; lastCheckAt: number }>;
};

const g = globalThis as GlobalBag;

function instanceId(): string {
  if (g.__rentrw_instance_id) return g.__rentrw_instance_id;
  const host = (() => {
    try { return String(process.env.HOSTNAME || '').trim(); } catch { return ''; }
  })();
  const pid = (() => {
    try { return String(process.pid); } catch { return '0'; }
  })();
  const rnd = Math.random().toString(36).slice(2, 8);
  const id = `${host || 'host'}:${pid}:${rnd}`;
  g.__rentrw_instance_id = id;
  return id;
}

function getLeaseCache() {
  if (!g.__rentrw_leases) g.__rentrw_leases = new Map();
  return g.__rentrw_leases;
}

function leasePath(name: string): string {
  const safe = String(name || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `.data/locks/lease_${safe}.json`;
}

/**
 * Best-effort distributed leader lease using the storage backend (FS or S3).
 * - Only one instance should act as leader for a given lease name at a time.
 * - In case of races, a short period of dual leadership is possible (acceptable for best-effort workers).
 */
export async function ensureLeaderLease(name: string, ttlMs: number): Promise<boolean> {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 60_000;
  const now = Date.now();
  const id = instanceId();
  const cache = getLeaseCache();
  const cached = cache.get(name);

  // If we believe we're leader and lease is still far from expiry, avoid extra storage reads.
  if (cached?.isLeader && cached.expiresAt > now + Math.floor(ttl * 0.4) && (now - cached.lastCheckAt) < 5_000) {
    return true;
  }

  const path = leasePath(name);
  let cur: Lease | null = null;
  try {
    const raw = await readText(path);
    if (raw) {
      try { cur = JSON.parse(raw) as Lease; } catch { cur = null; }
    }
  } catch { cur = null; }

  const curId = cur?.id || null;
  const curExp = Number(cur?.expiresAt || 0);
  const expired = !curId || !curExp || now > curExp;

  // If another instance holds a valid lease, we're not leader.
  if (!expired && curId !== id) {
    cache.set(name, { isLeader: false, expiresAt: curExp, lastCheckAt: now });
    return false;
  }

  // If we already own it and it's not close to expiry, just mark leader.
  if (!expired && curId === id && curExp > now + Math.floor(ttl * 0.2)) {
    cache.set(name, { isLeader: true, expiresAt: curExp, lastCheckAt: now });
    return true;
  }

  // Try (re)acquire or renew.
  const next: Lease = { id, expiresAt: now + ttl, updatedAt: new Date().toISOString() };
  try { await writeText(path, JSON.stringify(next)); } catch {}

  // Verify by reading back (best-effort).
  try {
    const check = await readText(path);
    if (check) {
      const parsed = JSON.parse(check) as Lease;
      const ok = parsed?.id === id && Number(parsed?.expiresAt || 0) > now;
      cache.set(name, { isLeader: ok, expiresAt: Number(parsed?.expiresAt || 0), lastCheckAt: now });
      return ok;
    }
  } catch {}

  cache.set(name, { isLeader: true, expiresAt: next.expiresAt, lastCheckAt: now });
  return true;
}

export function getInstanceId(): string {
  return instanceId();
}


