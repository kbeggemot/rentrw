import { readText, writeText, list } from './storage';
import { getHub } from './eventBus';
import path from 'path';
import { appendAdminEntityLog } from './adminAudit';
import { sendInstantDeliveryIfReady } from './instantDelivery';

// IMPORTANT: keep relative paths here so that S3 storage keys are correct
const DATA_DIR = '.data';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
// New sharded sales storage (by organization INN)
const SALES_DIR = path.join(DATA_DIR, 'sales'); // .data/sales/{inn}/sales/{taskId}.json
const SALES_INDEX_DIR = path.join(DATA_DIR, 'sales_index'); // .data/sales_index/by_task/{taskId}.json

export type StoredTask = {
  id: number | string;
  orderId: number;
  createdAt: string;
};

export type SaleRecord = {
  taskId: number | string;
  orderId: number | string;
  userId: string;
  linkCode?: string | null;
  // Telegram user id of the payer (stringified)
  payerTgId?: string | null;
  payerTgFirstName?: string | null;
  payerTgLastName?: string | null;
  payerTgUsername?: string | null;
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
  paidAt?: string | null; // точное время перехода в paid/transfered в нашей системе
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
  // id is optional to allow mapping to product metadata; vat is stored to freeze tax at sale time
  // instantResult is captured to reflect instant delivery status in UI at the time of sale
  itemsSnapshot?: Array<{ id?: string | null; title: string; price: number; qty: number; vat?: 'none' | '0' | '5' | '7' | '10' | '20'; instantResult?: string | null }> | null;
  agentDescription?: string | null; // description text used for agent line
  partnerFio?: string | null;
  partnerPhone?: string | null;
  // Instant delivery email status
  instantEmailStatus?: 'pending' | 'sent' | 'failed' | null;
  instantEmailError?: string | null;
  // Terms document accepted by payer at payment start
  termsDocHash?: string | null;
  termsDocName?: string | null;
  termsAcceptedAt?: string | null; // ISO
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

// ----- Sharded sales storage helpers (by orgInn) -----

function sanitizeInn(inn: string | null | undefined): string {
  const d = (inn || '').toString().replace(/\D/g, '');
  return d || 'unknown';
}

function saleFilePath(inn: string, taskId: number | string): string {
  return path.join(SALES_DIR, inn, 'sales', `${String(taskId)}.json`).replace(/\\/g, '/');
}

function orgIndexPath(inn: string): string {
  return path.join(SALES_DIR, inn, 'index.json').replace(/\\/g, '/');
}

function byTaskIndexPath(taskId: number | string): string {
  return path.join(SALES_INDEX_DIR, 'by_task', `${String(taskId)}.json`).replace(/\\/g, '/');
}

type OrgIndexRow = { taskId: number | string; orderId: number | string; userId: string; createdAt: string; updatedAt: string; status?: string | null; orgInn: string; hasPrepay?: boolean; hasFull?: boolean; hasCommission?: boolean; hasNpd?: boolean; pageCode?: string | null };

async function readOrgIndex(inn: string): Promise<OrgIndexRow[]> {
  const raw = await readText(orgIndexPath(inn));
  if (!raw) return [];
  try { const arr = JSON.parse(raw) as OrgIndexRow[]; return Array.isArray(arr) ? arr : []; } catch { return []; }
}

async function writeOrgIndex(inn: string, rows: OrgIndexRow[]): Promise<void> {
  await writeText(orgIndexPath(inn), JSON.stringify(rows, null, 2));
}

async function readSaleByInnTask(inn: string, taskId: number | string): Promise<SaleRecord | null> {
  const raw = await readText(saleFilePath(inn, taskId));
  if (!raw) return null;
  try { return JSON.parse(raw) as SaleRecord; } catch { return null; }
}

async function writeSaleAndIndexes(sale: SaleRecord): Promise<void> {
  const inn = sanitizeInn(sale.orgInn || null);
  // 1) write sale file
  await writeText(saleFilePath(inn, sale.taskId), JSON.stringify(sale, null, 2));
  // 2) update org index (upsert)
  const idx = await readOrgIndex(inn);
  const existingPos = idx.findIndex((r) => String(r.taskId) === String(sale.taskId));
  const existing = existingPos !== -1 ? (idx[existingPos] as any) : null;
  const meta: OrgIndexRow = {
    taskId: sale.taskId,
    orderId: sale.orderId,
    userId: sale.userId,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    status: sale.status ?? null,
    orgInn: inn,
    hasPrepay: Boolean(sale.ofdUrl),
    hasFull: Boolean(sale.ofdFullUrl),
    hasCommission: Boolean(sale.additionalCommissionOfdUrl),
    hasNpd: Boolean(sale.npdReceiptUri),
    pageCode: (sale as any)?.pageCode ?? (existing ? existing.pageCode ?? null : null),
  };
  if (existingPos === -1) idx.push(meta); else idx[existingPos] = meta;
  // keep newest first (optional)
  idx.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  await writeOrgIndex(inn, idx);
  // 3) upsert by-task index
  await writeText(byTaskIndexPath(sale.taskId), JSON.stringify({ inn, userId: sale.userId }, null, 2));
}

async function readByTask(taskId: number | string): Promise<{ inn: string; userId: string } | null> {
  const raw = await readText(byTaskIndexPath(taskId));
  if (!raw) return null;
  try { const d = JSON.parse(raw); return (d && typeof d.inn === 'string' && typeof d.userId === 'string') ? d : null; } catch { return null; }
}

// Resolve owner userId and organization INN for a given taskId using indexes/legacy store
export async function resolveOwnerAndInnByTask(taskId: number | string): Promise<{ userId: string | null; orgInn: string | null }> {
  try {
    const mapped = await readByTask(taskId).catch(() => null);
    if (mapped) return { userId: mapped.userId, orgInn: mapped.inn };
  } catch {}
  try {
    const store = await readTasks();
    const found = (store.sales ?? []).find((s) => s.taskId == taskId);
    if (found) {
      const innVal = (found.orgInn && String(found.orgInn).trim().length > 0 && String(found.orgInn) !== 'неизвестно')
        ? String(found.orgInn).replace(/\D/g, '')
        : null;
      return { userId: found.userId, orgInn: innVal };
    }
  } catch {}
  return { userId: null, orgInn: null };
}

// Backward‑compat: try reading legacy sale from tasks.json if not in sharded store
async function readLegacySale(userId: string, taskId: number | string): Promise<SaleRecord | null> {
  try {
    const store = await readTasks();
    const arr = (store.sales ?? []).filter((s) => s.userId === userId && s.taskId == taskId);
    return arr.length > 0 ? arr[0] : null;
  } catch { return null; }
}

// Migration: copy all legacy sales from tasks.json to sharded structure (idempotent)
let migrationStarted = false;
export async function migrateLegacyTasksToOrgStore(): Promise<void> {
  if (migrationStarted) return; migrationStarted = true;
  try {
    const store = await readTasks();
    const sales = Array.isArray(store.sales) ? store.sales : [];
    if (sales.length === 0) return;
    for (const s of sales) {
      const inn = sanitizeInn((s as any).orgInn || null);
      // If sharded file already exists (checked via by-task index), skip
      const mapped = await readByTask(s.taskId).catch(() => null);
      if (mapped && mapped.inn) continue;
      // write sale and indexes
      try { await writeSaleAndIndexes(s); } catch {}
    }
  } catch {}
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
  linkCode?: string | null;
  orgInn?: string | null;
  rwTokenFp?: string | null;
  payerTgId?: string | null;
  payerTgFirstName?: string | null;
  payerTgLastName?: string | null;
  payerTgUsername?: string | null;
  clientEmail?: string | null;
  description?: string;
  amountGrossRub: number;
  isAgent: boolean;
  commissionType?: 'percent' | 'fixed';
  commissionValue?: number;
  serviceEndDate?: string;
  vatRate?: string;
  cartItems?: Array<{ id?: string | null; title: string; price: number; qty: number; vat?: string }> | null;
  agentDescription?: string | null;
  partnerFio?: string | null;
  partnerPhone?: string | null;
  termsDocHash?: string | null;
  termsDocName?: string | null;
}): Promise<void> {
  const { userId, taskId, orderId, linkCode, orgInn, rwTokenFp, payerTgId, payerTgFirstName, payerTgLastName, payerTgUsername, clientEmail, description, amountGrossRub, isAgent, commissionType, commissionValue, serviceEndDate, vatRate, cartItems, agentDescription, partnerFio, partnerPhone, termsDocHash, termsDocName } = params;
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
  const newSale: SaleRecord = {
    taskId,
    orderId: storedOrderId,
    userId,
    linkCode: (typeof linkCode === 'string' && linkCode.trim().length > 0) ? linkCode.trim() : null,
    payerTgId: (typeof payerTgId === 'string' && payerTgId.trim().length > 0) ? payerTgId.trim() : null,
    payerTgFirstName: (typeof payerTgFirstName === 'string' && payerTgFirstName.trim().length > 0) ? payerTgFirstName : null,
    payerTgLastName: (typeof payerTgLastName === 'string' && payerTgLastName.trim().length > 0) ? payerTgLastName : null,
    payerTgUsername: (typeof payerTgUsername === 'string' && payerTgUsername.trim().length > 0) ? payerTgUsername : null,
    orgInn: (resolvedInn && String(resolvedInn).trim().length > 0) ? String(resolvedInn).replace(/\D/g, '') : 'неизвестно',
    clientEmail: (clientEmail ?? null),
    description: description ?? null,
    amountGrossRub,
    isAgent,
    retainedCommissionRub: Math.max(0, Math.round((retained + Number.EPSILON) * 100) / 100),
    source: 'ui',
    rwOrderId: null,
    status: null,
    paidAt: null,
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
    itemsSnapshot: Array.isArray(cartItems) ? cartItems.map((i) => {
      const rawVat = (i as any)?.vat;
      const v = typeof rawVat === 'string' ? rawVat : undefined;
      const vatSanitized = (v && ['none','0','5','7','10','20'].includes(v)) ? (v as any) : undefined;
      const iraw = (i as any)?.instantResult;
      const instant = typeof iraw === 'string' && iraw.trim().length > 0 ? iraw : null;
      return { id: (i as any)?.id ?? null, title: String(i.title || ''), price: Number(i.price || 0), qty: Number(i.qty || 1), ...(vatSanitized ? { vat: vatSanitized as any } : {}), ...(instant ? { instantResult: String(instant) } : {}) };
    }) : null,
    agentDescription: agentDescription ?? null,
    partnerFio: partnerFio ?? null,
    partnerPhone: partnerPhone ?? null,
    instantEmailStatus: null,
    instantEmailError: null,
    termsDocHash: (termsDocHash ?? null) as any,
    termsDocName: (termsDocName ?? null) as any,
    termsAcceptedAt: (termsDocHash ? now : null) as any,
  } as SaleRecord;
  // Legacy list append (backward compatibility for existing readers)
  store.sales.push(newSale);
  await writeTasks(store);
  // New sharded write by org
  try { await writeSaleAndIndexes(newSale); } catch {}
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
    if (typeof update.status !== 'undefined' && update.status !== null) {
      const prevStatus = String(next.status || '').toLowerCase();
      const newStatus = String(update.status || '').toLowerCase();
      // Guard: if someone accidentally passed root task status into `status`,
      // do NOT overwrite acquiring/payment status. Persist it into rootStatus instead.
      const acquiringStatuses = new Set(['pending', 'paying', 'paid', 'transfered', 'transferred', 'expired', 'refunded', 'failed']);
      const rootOnlyStatuses = new Set(['completed', 'draft', 'canceled', 'cancelled', 'error']);
      if (!acquiringStatuses.has(newStatus) && rootOnlyStatuses.has(newStatus)) {
        // treat as root status update only
        (next as any).rootStatus = update.status as any;
      } else {
        next.status = update.status;
        const wasPaid = prevStatus === 'paid' || prevStatus === 'transfered' || prevStatus === 'transferred';
        const nowPaid = newStatus === 'paid' || newStatus === 'transfered' || newStatus === 'transferred';
        if (!wasPaid && nowPaid && !next.paidAt) {
          next.paidAt = new Date().toISOString();
        }
      }
    }
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
    // no-op guard: skip write if nothing changed (include rootStatus as well)
    const beforeVals = { status: current.status, rootStatus: (current as any).rootStatus ?? null, ofdUrl: current.ofdUrl, ofdFullUrl: current.ofdFullUrl, additionalCommissionOfdUrl: current.additionalCommissionOfdUrl, npdReceiptUri: current.npdReceiptUri } as const;
    const afterVals = { status: next.status, rootStatus: (next as any).rootStatus ?? null, ofdUrl: next.ofdUrl, ofdFullUrl: next.ofdFullUrl, additionalCommissionOfdUrl: next.additionalCommissionOfdUrl, npdReceiptUri: next.npdReceiptUri } as const;
    if (JSON.stringify(beforeVals) === JSON.stringify(afterVals)) return;
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { await writeSaleAndIndexes(next); } catch {}
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
    try { await writeSaleAndIndexes(next); } catch {}
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
    try { await writeSaleAndIndexes(next); } catch {}
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
    try { await writeSaleAndIndexes(next); } catch {}
    try { getHub().publish(userId, 'sales:update'); } catch {}
  }
}

export async function listSales(userId: string): Promise<SaleRecord[]> {
  // Read from sharded org indexes and merge с legacy
  const out: SaleRecord[] = [];
  try {
    const orgPaths = (await list('.data/sales').catch(() => [] as string[])).filter((p) => /\.data\/sales\/[^/]+\/index\.json$/.test(p));
    for (const idxPath of orgPaths) {
      try {
        const inn = idxPath.split('/')[2];
        const idxRaw = await readText(idxPath);
        const rows: OrgIndexRow[] = idxRaw ? JSON.parse(idxRaw) : [];
        for (const r of rows) {
          // lazy read individual sale and filter by userId
          const s = await readSaleByInnTask(inn, r.taskId);
          if (s && s.userId === userId) out.push(s);
        }
      } catch {}
    }
  } catch {}
  // Merge with legacy to avoid пропусков (на случай частичной миграции)
  const seen = new Set(out.map((s) => String(s.taskId)));
  const store = await readTasks();
  for (const s of (store.sales ?? [])) {
    if (s.userId === userId && !seen.has(String(s.taskId))) out.push(s);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllSales(): Promise<SaleRecord[]> {
  const store = await readTasks();
  const arr = (store.sales ?? []);
  return arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllSalesForOrg(orgInn: string): Promise<SaleRecord[]> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const idx = await readOrgIndex(inn);
  const res: SaleRecord[] = [];
  for (const r of idx) {
    const s = await readSaleByInnTask(inn, r.taskId);
    if (s) res.push(s);
  }
  // Merge с legacy (на случай неполной миграции)
  const seen = new Set(res.map((s) => String(s.taskId)));
  const store = await readTasks();
  for (const s of (store.sales ?? [])) {
    if ((s.orgInn || '') === inn && !seen.has(String(s.taskId))) res.push(s);
  }
  return res.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findSaleByTaskId(userId: string, taskId: number | string): Promise<SaleRecord | null> {
  // Try sharded by-task index
  const mapped = await readByTask(taskId).catch(() => null);
  if (mapped) {
    const s = await readSaleByInnTask(mapped.inn, taskId);
    if (s && s.userId === userId) return s;
  }
  // Fallback legacy
  const store = await readTasks();
  const arr = (store.sales ?? []).filter((s) => s.userId === userId && s.taskId == taskId);
  return arr.length > 0 ? arr[0] : null;
}

export async function listSalesForOrg(userId: string, orgInn: string): Promise<SaleRecord[]> {
  const inn = (orgInn || '').replace(/\D/g, '');
  const idx = await readOrgIndex(inn);
  const res: SaleRecord[] = [];
  for (const r of idx) {
    const s = await readSaleByInnTask(inn, r.taskId);
    if (s && s.userId === userId) res.push(s);
  }
  // Merge с legacy
  const seen = new Set(res.map((s) => String(s.taskId)));
  const store = await readTasks();
  for (const s of (store.sales ?? [])) {
    if (s.userId === userId && (s.orgInn || '') === inn && !seen.has(String(s.taskId))) res.push(s);
  }
  return res.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
  // If this task already has a canonical owner/org mapping, do not create a duplicate under another user/org
  try {
    const mapped = await readByTask(taskId).catch(() => null);
    if (mapped && mapped.userId && mapped.userId !== userId) {
      // Another user's sale already exists for this task — skip creating a shadow copy
      return;
    }
  } catch {}
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
    try { await writeSaleAndIndexes(next); } catch {}
    try { getHub().publish(userId, 'sales:update'); } catch {}
  }
}


export async function updateSaleMeta(userId: string, taskId: number | string, meta: { payerTgId?: string | null; linkCode?: string | null; payerTgFirstName?: string | null; payerTgLastName?: string | null; payerTgUsername?: string | null }): Promise<void> {
  const store = await readTasks();
  if (!store.sales) store.sales = [];
  const idx = store.sales.findIndex((s) => s.userId === userId && s.taskId == taskId);
  if (idx !== -1) {
    const current = store.sales[idx];
    const next = { ...current } as SaleRecord;
    if (typeof meta.payerTgId !== 'undefined' && (next.payerTgId ?? null) !== (meta.payerTgId ?? null)) {
      next.payerTgId = (meta.payerTgId && String(meta.payerTgId).trim().length > 0) ? String(meta.payerTgId) : null;
    }
    if (typeof meta.linkCode !== 'undefined' && (next.linkCode ?? null) !== (meta.linkCode ?? null)) {
      next.linkCode = (meta.linkCode && String(meta.linkCode).trim().length > 0) ? String(meta.linkCode).trim() : null;
    }
    // Optional: attach tele user meta if provided
    const anyMeta: any = meta as any;
    if (typeof anyMeta.payerTgFirstName !== 'undefined') next.payerTgFirstName = (anyMeta.payerTgFirstName || null);
    if (typeof anyMeta.payerTgLastName !== 'undefined') next.payerTgLastName = (anyMeta.payerTgLastName || null);
    if (typeof anyMeta.payerTgUsername !== 'undefined') next.payerTgUsername = (anyMeta.payerTgUsername || null);
    next.updatedAt = new Date().toISOString();
    store.sales[idx] = next;
    await writeTasks(store);
    try { await writeSaleAndIndexes(next); } catch {}
    try { getHub().publish(userId, 'sales:update'); } catch {}
  }
}


// Persist pageCode to org index row for a sale (used to avoid extra by-order requests)
export async function setSalePageCode(userId: string, taskId: number | string, pageCode: string | null): Promise<void> {
  try {
    const mapped = await readByTask(taskId).catch(() => null);
    let inn = mapped?.inn || null;
    if (!inn) {
      // fallback scan legacy store to find sale and inn
      const store = await readTasks();
      const s = (store.sales || []).find((x) => x.userId === userId && String(x.taskId) === String(taskId));
      if (s?.orgInn) inn = sanitizeInn(s.orgInn);
    }
    if (!inn) return;
    const rows = await readOrgIndex(inn);
    if (!Array.isArray(rows) || rows.length === 0) return;
    const idx = rows.findIndex((r: any) => String((r as any)?.taskId) === String(taskId));
    if (idx === -1) return;
    const row: any = { ...(rows[idx] as any) };
    row.pageCode = pageCode ?? null;
    rows[idx] = row as any;
    await writeOrgIndex(inn, rows as any);
    // also persist to sale file so that direct reads get it immediately
    try {
      const p = saleFilePath(inn, taskId);
      const raw = await readText(p);
      if (raw) {
        const s = JSON.parse(raw);
        if ((s as any).pageCode !== pageCode) {
          (s as any).pageCode = pageCode ?? null;
          await writeText(p, JSON.stringify(s, null, 2));
        }
      }
    } catch {}
  } catch {}
}

