import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

export type StoredTask = {
  id: number | string;
  orderId: number;
  createdAt: string;
};

export type SaleRecord = {
  taskId: number | string;
  orderId: number;
  userId: string;
  amountGrossRub: number;
  isAgent: boolean;
  retainedCommissionRub: number;
  status?: string | null;
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  additionalCommissionOfdUrl?: string | null;
  npdReceiptUri?: string | null; // receipt_uri from root task (НПД)
  serviceEndDate?: string | null; // YYYY-MM-DD
  vatRate?: string | null; // e.g. none|0|10|20
  createdAt: string;
  updatedAt: string;
};

type TaskStoreData = {
  tasks: StoredTask[];
  sales?: SaleRecord[];
};

async function readTasks(): Promise<TaskStoreData> {
  try {
    const raw = await fs.readFile(TASKS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TaskStoreData>;
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], sales: Array.isArray((parsed as any).sales) ? (parsed as any).sales : [] };
  } catch {
    return { tasks: [], sales: [] };
  }
}

async function writeTasks(data: TaskStoreData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function saveTaskId(id: number | string, orderId: number): Promise<void> {
  const store = await readTasks();
  store.tasks.push({ id, orderId, createdAt: new Date().toISOString() });
  await writeTasks(store);
}

export async function recordSaleOnCreate(params: {
  userId: string;
  taskId: number | string;
  orderId: number;
  amountGrossRub: number;
  isAgent: boolean;
  commissionType?: 'percent' | 'fixed';
  commissionValue?: number;
  serviceEndDate?: string;
  vatRate?: string;
}): Promise<void> {
  const { userId, taskId, orderId, amountGrossRub, isAgent, commissionType, commissionValue, serviceEndDate, vatRate } = params;
  let retained = 0;
  if (isAgent && commissionValue !== undefined) {
    if (commissionType === 'percent') retained = (amountGrossRub * commissionValue) / 100;
    else retained = commissionValue;
  }
  const now = new Date().toISOString();
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  store.sales.push({
    taskId,
    orderId,
    userId,
    amountGrossRub,
    isAgent,
    retainedCommissionRub: Math.max(0, Math.round((retained + Number.EPSILON) * 100) / 100),
    status: null,
    ofdUrl: null,
    ofdFullUrl: null,
    additionalCommissionOfdUrl: null,
    npdReceiptUri: null,
    serviceEndDate: serviceEndDate ?? null,
    vatRate: vatRate ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await writeTasks(store);
}

export async function updateSaleFromStatus(userId: string, taskId: number | string, update: Partial<Pick<SaleRecord, 'status' | 'ofdUrl' | 'additionalCommissionOfdUrl' | 'npdReceiptUri'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.taskId == taskId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (typeof update.status !== 'undefined' && update.status !== null) next.status = update.status;
    if (typeof update.ofdUrl !== 'undefined' && update.ofdUrl) {
      // if service end date is today (Europe/Moscow), treat RW ofd_url as full settlement
      const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
      if (current.serviceEndDate && current.serviceEndDate === mskToday) next.ofdFullUrl = update.ofdUrl;
      else next.ofdUrl = update.ofdUrl;
    }
    if (typeof update.additionalCommissionOfdUrl !== 'undefined' && update.additionalCommissionOfdUrl) next.additionalCommissionOfdUrl = update.additionalCommissionOfdUrl;
    if (typeof update.npdReceiptUri !== 'undefined' && update.npdReceiptUri) next.npdReceiptUri = update.npdReceiptUri;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
  }
}

export async function updateSaleOfdUrls(userId: string, taskId: number | string, patch: Partial<Pick<SaleRecord, 'ofdUrl' | 'ofdFullUrl'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.taskId == taskId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (typeof patch.ofdUrl !== 'undefined') next.ofdUrl = patch.ofdUrl ?? null;
    if (typeof patch.ofdFullUrl !== 'undefined') next.ofdFullUrl = patch.ofdFullUrl ?? null;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
  }
}

export async function updateSaleOfdUrlsByOrderId(userId: string, orderId: number, patch: Partial<Pick<SaleRecord, 'ofdUrl' | 'ofdFullUrl'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.orderId === orderId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (typeof patch.ofdUrl !== 'undefined') next.ofdUrl = patch.ofdUrl ?? null;
    if (typeof patch.ofdFullUrl !== 'undefined') next.ofdFullUrl = patch.ofdFullUrl ?? null;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
  }
}

export async function listSales(userId: string): Promise<SaleRecord[]> {
  const store = await readTasks();
  const arr = (store.sales ?? []).filter((s) => s.userId === userId);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllSales(): Promise<SaleRecord[]> {
  const store = await readTasks();
  const arr = (store.sales ?? []);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}


