import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const ORDER_FILE = path.join(DATA_DIR, 'order.json');

type OrderStoreData = { lastOrderId: number };

async function readOrder(): Promise<OrderStoreData> {
  try {
    const raw = await fs.readFile(ORDER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<OrderStoreData>;
    const last = typeof parsed.lastOrderId === 'number' && Number.isFinite(parsed.lastOrderId)
      ? parsed.lastOrderId
      : 0;
    return { lastOrderId: last };
  } catch {
    return { lastOrderId: 0 };
  }
}

async function writeOrder(data: OrderStoreData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ORDER_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function getNextOrderId(): Promise<number> {
  const current = await readOrder();
  const next = (current.lastOrderId ?? 0) + 1;
  await writeOrder({ lastOrderId: next });
  return next;
}


