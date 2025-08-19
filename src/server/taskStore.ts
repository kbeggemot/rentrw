import { readText, writeText } from './storage';
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
  source?: 'ui' | 'external';
  rwOrderId?: number | null;
  status?: string | null;
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  ofdPrepayId?: string | null;
  ofdFullId?: string | null;
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
  const raw = await readText(TASKS_FILE);
  if (!raw) return { tasks: [], sales: [] };
  const parsed = JSON.parse(raw) as Partial<TaskStoreData>;
  return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], sales: Array.isArray((parsed as any).sales) ? (parsed as any).sales : [] };
}

async function writeTasks(data: TaskStoreData): Promise<void> {
  await writeText(TASKS_FILE, JSON.stringify(data, null, 2));
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
    source: 'ui',
    rwOrderId: null,
    status: null,
    ofdUrl: null,
    ofdFullUrl: null,
    ofdPrepayId: null,
    ofdFullId: null,
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

export async function updateSaleOfdUrlsByOrderId(userId: string, orderId: number, patch: Partial<Pick<SaleRecord, 'ofdUrl' | 'ofdFullUrl' | 'ofdPrepayId' | 'ofdFullId'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.orderId === orderId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (typeof patch.ofdUrl !== 'undefined') next.ofdUrl = patch.ofdUrl ?? null;
    if (typeof patch.ofdFullUrl !== 'undefined') next.ofdFullUrl = patch.ofdFullUrl ?? null;
    if (typeof patch.ofdPrepayId !== 'undefined') next.ofdPrepayId = patch.ofdPrepayId ?? null;
    if (typeof patch.ofdFullId !== 'undefined') next.ofdFullId = patch.ofdFullId ?? null;
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

export async function findSaleByTaskId(userId: string, taskId: number | string): Promise<SaleRecord | null> {
  const store = await readTasks();
  const arr = (store.sales ?? []).filter((s) => s.userId === userId && s.taskId == taskId);
  return arr.length > 0 ? arr[0] : null;
}


// Ensure a sale record exists for a RW task that may have been created outside our UI.
// orderId is resolved from task.acquiring_order.order when available; otherwise, the next sequence number.
export async function ensureSaleFromTask(params: {
  userId: string;
  taskId: number | string;
  task: Partial<{
    acquiring_order?: { order?: string | number; status?: string | null; ofd_url?: string | null } | null;
    amount_gross?: number | string | null;
    additional_commission_value?: unknown;
    created_at?: string | null;
  }>;
}): Promise<void> {
  const { userId, taskId, task } = params;
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const exists = store.sales.some((s) => s.userId === userId && s.taskId == taskId);
  if (exists) return;
  // Determine orderId
  let resolvedOrderId: number | null = null;
  const raw = (task?.acquiring_order as any)?.order;
  const num = typeof raw === 'string' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
  if (Number.isFinite(num)) resolvedOrderId = Number(num);
  if (resolvedOrderId == null) {
    const max = (store.sales || []).reduce((m, s) => Math.max(m, Number(s.orderId || 0)), 0);
    resolvedOrderId = max + 1;
  }
  const amountRub = (() => {
    const ag = task?.amount_gross as any;
    const n = typeof ag === 'string' ? Number(ag) : (typeof ag === 'number' ? ag : 0);
    return Number.isFinite(n) ? Number(n) : 0;
  })();
  const isAgent = Boolean(task?.additional_commission_value);
  const now = new Date().toISOString();
  const status = (task?.acquiring_order as any)?.status ?? null;
  const ofd = (task?.acquiring_order as any)?.ofd_url ?? null;
  store.sales.push({
    taskId,
    orderId: resolvedOrderId!,
    userId,
    amountGrossRub: amountRub || 0,
    isAgent,
    retainedCommissionRub: 0,
    source: 'external',
    rwOrderId: Number.isFinite(num) ? Number(num) : null,
    status: (typeof status === 'string' ? status : null) as any,
    ofdUrl: (typeof ofd === 'string' ? ofd : null) as any,
    ofdFullUrl: null,
    ofdPrepayId: null,
    ofdFullId: null,
    additionalCommissionOfdUrl: null,
    npdReceiptUri: null,
    serviceEndDate: null,
    vatRate: null,
    createdAt: task?.created_at || now,
    updatedAt: now,
  });
  // Also record in tasks list for convenience
  store.tasks.push({ id: taskId, orderId: resolvedOrderId!, createdAt: now });
  await writeTasks(store);
}

export async function updateSaleRwOrderId(userId: string, taskId: number | string, rwOrderId: number | null): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.userId === userId && s.taskId == taskId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    next.rwOrderId = rwOrderId;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
  }
}


