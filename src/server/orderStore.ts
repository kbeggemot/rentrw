import { readText, writeText } from './storage';

type OrderStoreData = { lastOrderId: number; prefix?: string };

const ORDER_FILE = '.data/order.json';

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
  const current = await readOrder();
  const next = (current.lastOrderId ?? 0) + 1;
  await writeOrder({ lastOrderId: next, prefix: current.prefix });
  return next;
}

export async function getInvoiceIdString(orderId: number): Promise<string> {
  const cur = await readOrder();
  const prefix = cur.prefix || DEFAULT_PREFIX;
  return `${prefix}-${orderId}`;
}

export type InvoiceKind = 'A' | 'B' | 'C';

export async function getInvoiceIdStringForType(orderId: number, kind: InvoiceKind): Promise<string> {
  const cur = await readOrder();
  const prefix = cur.prefix || DEFAULT_PREFIX; // e.g. fhrff351d
  return `${prefix}-${kind}-${orderId}`;
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


