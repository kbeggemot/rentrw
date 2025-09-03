import { readText, writeText } from './storage';
import { getHub } from './eventBus';
import path from 'path';
import { appendAdminEntityLog } from './adminAudit';
import { sendInstantDeliveryIfReady } from './instantDelivery';

// IMPORTANT: keep relative paths here so that S3 storage keys are correct
const DATA_DIR = '.data';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

export type StoredTask = {
  id: number | string;
  orderId: number;
  createdAt: string;
};

export type SaleRecord = {
  taskId: number | string;
  orderId: number | string;
  userId: string;
  orgInn?: string | null; // digits-only INN; 'неизвестно' if unknown
  clientEmail?: string | null;
  description?: string | null;
  amountGrossRub: number;
  isAgent: boolean;
  retainedCommissionRub: number;
  source?: 'ui' | 'external';
  rwOrderId?: number | null;
  status?: string | null; // acquiring_order.status (оплата)
  rootStatus?: string | null; // корневой статус задачи (task.status)
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  ofdPrepayId?: string | null;
  ofdFullId?: string | null;
  additionalCommissionOfdUrl?: string | null;
  npdReceiptUri?: string | null; // receipt_uri from root task (НПД)
  serviceEndDate?: string | null; // YYYY-MM-DD
  vatRate?: string | null; // e.g. none|0|5|7|10|20
  createdAtRw?: string | null; // created_at from RW task (ISO)
  hidden?: boolean; // soft-hide from UI
  rwTokenFp?: string | null; // sha256 of RW token used to create
  createdAt: string;
  updatedAt: string;
  // New: stored invoice ids (A=prepay, B=offset, C=full)
  invoiceIdPrepay?: string | null;
  invoiceIdOffset?: string | null;
  invoiceIdFull?: string | null;
  // Snapshot of items at creation (prices already adjusted if agent commission applies)
  // id is optional to allow mapping to product metadata (unit/kind/vat)
  itemsSnapshot?: Array<{ id?: string | null; title: string; price: number; qty: number }> | null;
  agentDescription?: string | null; // description text used for agent line
  // Instant delivery email status
  instantEmailStatus?: 'pending' | 'sent' | 'failed' | null;
  instantEmailError?: string | null;
};

function normalizeOrderId(value: string | number): number {
  if (typeof value === 'number') return value;
  const m = String(value).match(/(\d+)/g);
  return m && m.length > 0 ? Number(m[m.length - 1]) : NaN;
}

function withLocalOrderPrefix(orderId: number): string | number {
  // In local/dev store orderId as string with numeric-safe prefix without dash
  return process.env.NODE_ENV !== 'production' ? `0000${orderId}` : orderId;
}

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
  orgInn?: string | null;
  rwTokenFp?: string | null;
  clientEmail?: string | null;
  description?: string;
  amountGrossRub: number;
  isAgent: boolean;
  commissionType?: 'percent' | 'fixed';
  commissionValue?: number;
  serviceEndDate?: string;
  vatRate?: string;
  cartItems?: Array<{ id?: string | null; title: string; price: number; qty: number }> | null;
  agentDescription?: string | null;
}): Promise<void> {
  const { userId, taskId, orderId, orgInn, rwTokenFp, clientEmail, description, amountGrossRub, isAgent, commissionType, commissionValue, serviceEndDate, vatRate, cartItems, agentDescription } = params;
  // Try infer orgInn from fingerprint if missing or unknown
  let resolvedInn: string | null | undefined = orgInn;
  try {
    const current = (orgInn && orgInn.trim().length > 0) ? orgInn.replace(/\D/g, '') : null;
    if ((!current || current === 'неизвестно') && rwTokenFp) {
      const { findOrgByFingerprint } = await import('./orgStore');
      const org = await findOrgByFingerprint(rwTokenFp);
      if (org?.inn) resolvedInn = org.inn;
    }
  } catch {}
  let retained = 0;
  if (isAgent && commissionValue !== undefined) {
    if (commissionType === 'percent') retained = (amountGrossRub * commissionValue) / 100;
    else retained = commissionValue;
  }
  const now = new Date().toISOString();
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  // Assign InvoiceIds conditionally by Moscow date rules
  let invoiceIdPrepay: string | null = null;
  let invoiceIdOffset: string | null = null;
  let invoiceIdFull: string | null = null;
  try {
    const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
    const endDate = serviceEndDate && serviceEndDate.trim().length > 0 ? serviceEndDate.trim() : null;
    if (endDate && endDate === mskToday) {
      const { getInvoiceIdForFull } = await import('./orderStore');
      invoiceIdFull = await getInvoiceIdForFull(orderId);
    } else if (endDate && endDate !== mskToday) {
      const { getInvoiceIdForPrepay, getInvoiceIdForOffset } = await import('./orderStore');
      invoiceIdPrepay = await getInvoiceIdForPrepay(orderId);
      invoiceIdOffset = await getInvoiceIdForOffset(orderId);
    } else {
      // If no end date provided, treat as same-day full settlement
      const { getInvoiceIdForFull } = await import('./orderStore');
      invoiceIdFull = await getInvoiceIdForFull(orderId);
    }
  } catch {}
  const storedOrderId: string | number = withLocalOrderPrefix(orderId);
  store.sales.push({
    taskId,
    orderId: storedOrderId,
    userId,
    orgInn: (resolvedInn && String(resolvedInn).trim().length > 0) ? String(resolvedInn).replace(/\D/g, '') : 'неизвестно',
    clientEmail: (clientEmail ?? null),
    description: description ?? null,
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
    createdAtRw: null,
    hidden: false,
    rwTokenFp: rwTokenFp ?? null,
    createdAt: now,
    updatedAt: now,
    invoiceIdPrepay,
    invoiceIdOffset,
    invoiceIdFull,
    itemsSnapshot: Array.isArray(cartItems) ? cartItems.map((i) => ({ id: (i as any)?.id ?? null, title: String(i.title || ''), price: Number(i.price || 0), qty: Number(i.qty || 1) })) : null,
    agentDescription: agentDescription ?? null,
    instantEmailStatus: null,
    instantEmailError: null,
  });
  await writeTasks(store);
  try { getHub().publish(userId, 'sales:update'); } catch {}
  try {
    await appendAdminEntityLog('sale', [String(userId), String(taskId)], {
      source: 'system',
      message: 'create(ui)',
      data: {
        orderId,
        orgInn: (resolvedInn && String(resolvedInn).trim().length > 0) ? String(resolvedInn).replace(/\D/g, '') : 'неизвестно',
        amountGrossRub,
        isAgent,
        serviceEndDate: serviceEndDate ?? null,
        vatRate: vatRate ?? null,
      },
    });
  } catch {}
}

export async function updateSaleFromStatus(userId: string, taskId: number | string, update: Partial<Pick<SaleRecord, 'status' | 'ofdUrl' | 'ofdFullUrl' | 'additionalCommissionOfdUrl' | 'npdReceiptUri'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.taskId == taskId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    // If orgInn is unknown and we have rwTokenFp, try to resolve it in background
    try {
      const curInn = (next.orgInn && String(next.orgInn).trim().length > 0) ? String(next.orgInn) : null;
      if ((!curInn || curInn === 'неизвестно') && next.rwTokenFp) {
        const { findOrgByFingerprint } = await import('./orgStore');
        const org = await findOrgByFingerprint(next.rwTokenFp);
        if (org?.inn) next.orgInn = org.inn;
      }
    } catch {}
    if (typeof update.status !== 'undefined' && update.status !== null) next.status = update.status;
    // Try to infer root status from textual payloads when available in update (duck-typing)
    try {
      const anyUpd = update as any;
      const root = typeof anyUpd.rootStatus === 'string' ? anyUpd.rootStatus : (typeof anyUpd.taskStatus === 'string' ? anyUpd.taskStatus : undefined);
      if (typeof root !== 'undefined' && root !== null) (next as any).rootStatus = root;
    } catch {}
    // Auto-hide expired tasks (prod only)
    if (next.status && String(next.status).toLowerCase() === 'expired') {
      next.hidden = process.env.NODE_ENV === 'production';
    }
    if (typeof update.ofdUrl !== 'undefined' && update.ofdUrl) next.ofdUrl = update.ofdUrl;
    if (typeof update.ofdFullUrl !== 'undefined' && update.ofdFullUrl) next.ofdFullUrl = update.ofdFullUrl;
    if (typeof update.additionalCommissionOfdUrl !== 'undefined' && update.additionalCommissionOfdUrl) next.additionalCommissionOfdUrl = update.additionalCommissionOfdUrl;
    if (typeof update.npdReceiptUri !== 'undefined' && update.npdReceiptUri) next.npdReceiptUri = update.npdReceiptUri;
    // no-op guard: skip write if nothing changed
    const beforeVals = { status: current.status, ofdUrl: current.ofdUrl, ofdFullUrl: current.ofdFullUrl, additionalCommissionOfdUrl: current.additionalCommissionOfdUrl, npdReceiptUri: current.npdReceiptUri };
    const afterVals = { status: next.status, ofdUrl: next.ofdUrl, ofdFullUrl: next.ofdFullUrl, additionalCommissionOfdUrl: next.additionalCommissionOfdUrl, npdReceiptUri: next.npdReceiptUri };
    if (JSON.stringify(beforeVals) === JSON.stringify(afterVals)) return;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { getHub().publish(userId, 'sales:update'); } catch {}
    try {
      await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'status/update', data: update });
    } catch {}
    // Fire-and-forget: try sending instant delivery email when receipts become available
    try { sendInstantDeliveryIfReady(userId, store.sales[idx]).catch(() => {}); } catch {}
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
    try { getHub().publish(userId, 'sales:update'); } catch {}
    try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'ofd/update', data: patch }); } catch {}
    // Fire-and-forget instant email attempt
    try { sendInstantDeliveryIfReady(userId, store.sales[idx]).catch(() => {}); } catch {}
  }
}

export async function updateSaleOfdUrlsByOrderId(userId: string, orderId: number, patch: Partial<Pick<SaleRecord, 'ofdUrl' | 'ofdFullUrl' | 'ofdPrepayId' | 'ofdFullId'>>): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => normalizeOrderId(s.orderId) === orderId && s.userId === userId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    const before: any = process.env.OFD_AUDIT === '1' ? { ofdUrl: next.ofdUrl ?? null, ofdFullUrl: next.ofdFullUrl ?? null, ofdPrepayId: (next as any).ofdPrepayId ?? null, ofdFullId: (next as any).ofdFullId ?? null } : null;
    let changed = false;
    if (typeof patch.ofdUrl !== 'undefined' && (next.ofdUrl ?? null) !== (patch.ofdUrl ?? null)) { next.ofdUrl = patch.ofdUrl ?? null; changed = true; }
    if (typeof patch.ofdFullUrl !== 'undefined' && (next.ofdFullUrl ?? null) !== (patch.ofdFullUrl ?? null)) { next.ofdFullUrl = patch.ofdFullUrl ?? null; changed = true; }
    if (typeof patch.ofdPrepayId !== 'undefined' && ((next as any).ofdPrepayId ?? null) !== (patch.ofdPrepayId ?? null)) { (next as any).ofdPrepayId = patch.ofdPrepayId ?? null; changed = true; }
    if (typeof patch.ofdFullId !== 'undefined' && ((next as any).ofdFullId ?? null) !== (patch.ofdFullId ?? null)) { (next as any).ofdFullId = patch.ofdFullId ?? null; changed = true; }
    if (!changed) {
      // Если источник OFD-обращение известен — логируем сам факт нулевого обновления
      try {
        if ((global as any).__OFD_SOURCE__) {
          const src = (global as any).__OFD_SOURCE__ || 'unknown';
          const { appendOfdAudit } = await import('./audit');
          await appendOfdAudit({ ts: new Date().toISOString(), source: String(src), userId, orderId, taskId: current.taskId, action: 'update_ofd_urls', patch: { ...patch, noop: true }, before, after: before });
        }
      } catch {}
      return; // no-op update, avoid extra writes/logs to store
    }
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { getHub().publish(userId, 'sales:update'); } catch {}
    try {
      if (process.env.OFD_AUDIT === '1') {
        const { appendOfdAudit } = await import('./audit');
        await appendOfdAudit({ ts: new Date().toISOString(), source: (global as any).__OFD_SOURCE__ || 'unknown', userId, orderId, taskId: current.taskId, action: 'update_ofd_urls', patch, before, after: { ofdUrl: next.ofdUrl ?? null, ofdFullUrl: next.ofdFullUrl ?? null, ofdPrepayId: (next as any).ofdPrepayId ?? null, ofdFullId: (next as any).ofdFullId ?? null } });
      }
    } catch {}
    try { await appendAdminEntityLog('sale', [String(userId), String(current.taskId)], { source: 'system', message: 'ofd/updateByOrder', data: { patch } }); } catch {}
    // Fire-and-forget instant email attempt
    try { sendInstantDeliveryIfReady(userId, store.sales[idx]).catch(() => {}); } catch {}
  }
}

export async function setSaleCreatedAtRw(userId: string, taskId: number | string, createdAtRw: string | null): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.userId === userId && s.taskId == taskId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if ((next.createdAtRw ?? null) === (createdAtRw ?? null)) return;
    if (!next.createdAtRw && createdAtRw) next.createdAtRw = createdAtRw;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { getHub().publish(userId, 'sales:update'); } catch {}
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

export async function listAllSalesForOrg(orgInn: string): Promise<SaleRecord[]> {
  const store = await readTasks();
  const inn = (orgInn || '').replace(/\D/g, '');
  const arr = (store.sales ?? []).filter((s) => (s.orgInn || '') === inn);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findSaleByTaskId(userId: string, taskId: number | string): Promise<SaleRecord | null> {
  const store = await readTasks();
  const arr = (store.sales ?? []).filter((s) => s.userId === userId && s.taskId == taskId);
  return arr.length > 0 ? arr[0] : null;
}

export async function listSalesForOrg(userId: string, orgInn: string): Promise<SaleRecord[]> {
  const store = await readTasks();
  const inn = (orgInn || '').replace(/\D/g, '');
  const arr = (store.sales ?? []).filter((s) => s.userId === userId && (s.orgInn || '') === inn);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}


// Ensure a sale record exists for a RW task that may have been created outside our UI.
// orderId is resolved from task.acquiring_order.order when available; otherwise, the next sequence number.
export async function ensureSaleFromTask(params: {
  userId: string;
  taskId: number | string;
  orgInn?: string | null;
  task: Partial<{
    acquiring_order?: { order?: string | number; status?: string | null; ofd_url?: string | null } | null;
    amount_gross?: number | string | null;
    additional_commission_value?: unknown;
    created_at?: string | null;
  }>;
}): Promise<void> {
  const { userId, taskId, task, orgInn } = params;
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
  const clientEmail = (task?.acquiring_order as any)?.client_email ?? null;
  store.sales.push({
    taskId,
    orderId: resolvedOrderId!,
    userId,
    orgInn: (orgInn && orgInn.trim().length > 0) ? orgInn.replace(/\D/g, '') : 'неизвестно',
    clientEmail: (typeof clientEmail === 'string' ? clientEmail : null) as any,
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
    createdAtRw: (task?.created_at as string | undefined) ?? null,
    hidden: String(status || '').toLowerCase() === 'expired',
    createdAt: task?.created_at || now,
    updatedAt: now,
  });
  // Also record in tasks list for convenience
  store.tasks.push({ id: taskId, orderId: resolvedOrderId!, createdAt: now });
  await writeTasks(store);
  try { getHub().publish(userId, 'sales:update'); } catch {}
  try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'ensure(external)', data: { status, ofd: ofd || null, createdAtRw: task?.created_at || null } }); } catch {}
}

export async function updateSaleRwOrderId(userId: string, taskId: number | string, rwOrderId: number | null): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.userId === userId && s.taskId == taskId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if ((next.rwOrderId ?? null) === (rwOrderId ?? null)) return;
    next.rwOrderId = rwOrderId;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { getHub().publish(userId, 'sales:update'); } catch {}
  }
}

export async function setSaleHidden(userId: string, taskId: number | string, hidden: boolean): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.userId === userId && s.taskId == taskId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (Boolean(next.hidden) === Boolean(hidden)) return;
    next.hidden = Boolean(hidden);
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { getHub().publish(userId, 'sales:update'); } catch {}
  }
}


