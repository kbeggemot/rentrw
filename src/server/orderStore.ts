import { readText, writeText } from './storage';

type OrderStoreData = { lastOrderId: number; prefix?: string };

const ORDER_FILE = '.data/order.json';

function withLocalPrefix(value: string): string {
  // In local/dev environment add numeric-safe prefix without dash for easier parsing
  const isLocal = process.env.NODE_ENV !== 'production';
  return isLocal ? `0000${value}` : value;
}

const DEFAULT_PREFIX = process.env.OFD_INVOICE_PREFIX || process.env.INVOICE_PREFIX || 'fhrff351d';

async function readOrder(): Promise<OrderStoreData> {
  try {
    const raw = await readText(ORDER_FILE);
    const parsed = raw ? (JSON.parse(raw) as Partial<OrderStoreData>) : {};
    const last = typeof parsed.lastOrderId === 'number' && Number.isFinite(parsed.lastOrderId) ? parsed.lastOrderId : 0;
    const prefix = typeof parsed.prefix === 'string' && parsed.prefix.length > 0 ? parsed.prefix : DEFAULT_PREFIX;
    return { lastOrderId: last, prefix } as OrderStoreData;
  } catch {
    return { lastOrderId: 0, prefix: DEFAULT_PREFIX } as OrderStoreData;
  }
}

async function writeOrder(data: OrderStoreData): Promise<void> {
  await writeText(ORDER_FILE, JSON.stringify(data, null, 2));
}

export async function getNextOrderId(): Promise<number> {
  // File-lock with TTL to avoid concurrent increments across instances
  const lockPath = '.data/locks/order.lock';
  const lockId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ttlMs = Number(process.env.ORDER_LOCK_TTL_MS || '5000');
  const deadline = Date.now() + Number(process.env.ORDER_LOCK_WAIT_MS || '15000');
  async function tryAcquire(): Promise<boolean> {
    const raw = await readText(lockPath);
    const now = Date.now();
    let owner: string | null = null; let expires = 0;
    try { const o = raw ? JSON.parse(raw) : null; owner = o?.id || null; expires = Number(o?.expiresAt || 0); } catch { owner = null; expires = 0; }
    if (!owner || !expires || now > expires) {
      try { await writeText(lockPath, JSON.stringify({ id: lockId, expiresAt: now + ttlMs })); } catch {}
      const check = await readText(lockPath);
      try { const o2 = check ? JSON.parse(check) : null; return o2?.id === lockId; } catch { return false; }
    }
    return false;
  }
  while (!(await tryAcquire())) {
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 75)));
  }
  // Proceed even if lock not acquired after deadline to avoid hard fail, but odds are low
  try {
    const current = await readOrder();
    // Double-check: skip to the first free orderId not used in sales
    let candidate = (current.lastOrderId ?? 0) + 1;
    try {
      const used = new Set<number>();
      const toNum = (v: unknown) => {
        if (typeof v === 'number') return v;
        const m = String(v ?? '').match(/(\d+)/g);
        return m && m.length > 0 ? Number(m[m.length - 1]) : NaN;
      };
      const { listAllSales } = await import('./taskStore');
      const sales = await listAllSales();
      for (const s of sales) {
        const n = toNum((s as any).orderId);
        if (Number.isFinite(n)) used.add(n);
      }
      while (used.has(candidate)) candidate += 1;
    } catch {}
    await writeOrder({ lastOrderId: candidate, prefix: current.prefix });
    return candidate;
  } finally {
    // Release: mark lock expired if we own it
    try {
      const raw = await readText(lockPath);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj?.id === lockId) {
        await writeText(lockPath, JSON.stringify({ id: lockId, expiresAt: 0 }));
      }
    } catch {}
  }
}

export async function getInvoiceIdString(orderId: number): Promise<string> {
  const cur = await readOrder();
  const prefix = cur.prefix || DEFAULT_PREFIX;
  return withLocalPrefix(`${prefix}-${orderId}`);
}

export type InvoiceKind = 'A' | 'B' | 'C';

export async function getInvoiceIdStringForType(orderId: number, kind: InvoiceKind): Promise<string> {
  const cur = await readOrder();
  const prefix = cur.prefix || DEFAULT_PREFIX; // e.g. fhrff351d
  return withLocalPrefix(`${prefix}-${kind}-${orderId}`);
}

export async function getInvoiceIdForPrepay(orderId: number): Promise<string> {
  return getInvoiceIdStringForType(orderId, 'A');
}

export async function getInvoiceIdForOffset(orderId: number): Promise<string> {
  return getInvoiceIdStringForType(orderId, 'B');
}

export async function getInvoiceIdForFull(orderId: number): Promise<string> {
  return getInvoiceIdStringForType(orderId, 'C');
}


