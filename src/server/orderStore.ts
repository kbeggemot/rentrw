import { readText, writeText } from './storage';

type OrderStoreData = { lastOrderId: number };

const ORDER_FILE = '.data/order.json';

async function readOrder(): Promise<OrderStoreData> {
  try {
    const raw = await readText(ORDER_FILE);
    const parsed = raw ? (JSON.parse(raw) as Partial<OrderStoreData>) : {};
    const last = typeof parsed.lastOrderId === 'number' && Number.isFinite(parsed.lastOrderId) ? parsed.lastOrderId : 0;
    return { lastOrderId: last };
  } catch {
    return { lastOrderId: 0 };
  }
}

async function writeOrder(data: OrderStoreData): Promise<void> {
  await writeText(ORDER_FILE, JSON.stringify(data, null, 2));
}

export async function getNextOrderId(): Promise<number> {
  const current = await readOrder();
  const next = (current.lastOrderId ?? 0) + 1;
  await writeOrder({ lastOrderId: next });
  return next;
}


