import { readText, writeText } from './storage';
import path from 'path';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from './ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_FULL_PAYMENT, VatRate } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn, getUserPayoutRequisites } from './userStore';
import { getDecryptedApiToken } from './secureStore';
import { listSales } from './taskStore';

// Offset jobs are created only when invoiceIdOffset was assigned at creation

type OffsetJob = {
  id: string; // `${userId}:${orderId}`
  userId: string;
  orderId: number;
  dueAt: string; // ISO UTC when to fire
  party: 'partner' | 'org';
  partnerInn?: string; // required if party=partner
  partnerName?: string; // optional: SupplierName for partner
  description: string;
  amountRub: number;
  vatRate: VatRate;
  buyerEmail?: string | null;
};

type Store = { jobs: OffsetJob[] };

// Use relative path so that storage.ts can route it to S3 when enabled
const DATA_DIR = '.data';
const FILE = path.join(DATA_DIR, 'ofd_jobs.json');

async function readStore(): Promise<Store> {
  const raw = await readText(FILE);
  if (!raw) return { jobs: [] };
  const data = JSON.parse(raw) as Partial<Store>;
  return { jobs: Array.isArray(data.jobs) ? data.jobs : [] };
}

async function writeStore(store: Store): Promise<void> {
  await writeText(FILE, JSON.stringify(store, null, 2));
}

export async function enqueueOffsetJob(job: Omit<OffsetJob, 'id'>): Promise<void> {
  const store = await readStore();
  const id = `${job.userId}:${job.orderId}`;
  const exists = store.jobs.some((j) => j.id === id);
  if (!exists) store.jobs.push({ ...job, id });
  await writeStore(store);
}

let started = false;
let timer: NodeJS.Timer | null = null;

export function startOfdScheduleWorker(): void {
  if (started) return;
  started = true;
  // In serverless-like envs, a long interval may be killed. Kick an immediate run once.
  runDueOffsetJobs().catch(() => void 0);
  timer = setInterval(() => {
    runDueOffsetJobs().catch(() => void 0);
  }, 60 * 1000);
}

export async function runDueOffsetJobs(): Promise<void> {
  const store = await readStore();
  const now = Date.now();
  const remain: OffsetJob[] = [];
  for (const job of store.jobs) {
    const due = Date.parse(job.dueAt);
    if (!Number.isFinite(due) || due > now) { remain.push(job); continue; }
    try {
      // Append debug log for observability
      try {
        const line = JSON.stringify({ ts: new Date().toISOString(), action: 'run-job', job }, null, 2) + '\n';
        const { promises: fs } = await import('fs');
        const path = await import('path');
        await fs.mkdir(path.join(process.cwd(), '.data'), { recursive: true });
        await fs.appendFile(path.join(process.cwd(), '.data', 'ofd_job_runs.log'), line, 'utf8');
      } catch {}
      const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
      const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
      const host = process.env.BASE_HOST || process.env.VERCEL_URL || process.env.RENDER_EXTERNAL_URL || 'localhost:3000';
      const secret = process.env.OFD_CALLBACK_SECRET || '';
      const callbackUrl = `https://${host}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(job.userId)}`;
      let payload: any;
      if (job.party === 'partner') {
        if (!job.partnerInn) throw new Error('NO_PARTNER_INN');
        // Ensure we have partner full name; if missing — fetch from RW task
        let partnerName = (job.partnerName || '').trim();
        if (partnerName.length === 0) {
          try {
            const token = await getDecryptedApiToken(job.userId);
            if (token) {
              const sales = await listSales(job.userId);
              const sale = sales.find((s) => s.orderId === job.orderId);
              const taskId = sale?.taskId;
              if (taskId != null) {
                const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                const tUrl = new URL(`tasks/${encodeURIComponent(String(taskId))}`, base.endsWith('/') ? base : base + '/').toString();
                const r = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
                const txt = await r.text();
                let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                const task = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
                const last = String(task?.executor?.last_name || '').trim();
                const first = String(task?.executor?.first_name || '').trim();
                const second = String(task?.executor?.second_name || '').trim();
                const fio = [last, first, second].filter(Boolean).join(' ').trim();
                if (fio.length > 0) partnerName = fio;
              }
            }
          } catch {}
        }
        const sales = await listSales(job.userId);
        const sale = sales.find((s) => s.orderId === job.orderId);
        const invoiceIdOffset = sale?.invoiceIdOffset || null;
        if (!invoiceIdOffset) throw new Error('NO_INVOICE_ID_OFFSET');
        payload = buildFermaReceiptPayload({
          party: 'partner',
          partyInn: job.partnerInn,
          description: job.description,
          amountRub: job.amountRub,
          vatRate: job.vatRate,
          methodCode: PAYMENT_METHOD_FULL_PAYMENT,
          orderId: job.orderId,
          docType: 'Income',
          buyerEmail: job.buyerEmail || null,
          invoiceId: invoiceIdOffset,
          callbackUrl,
          withAdvanceOffset: true,
          paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: job.partnerInn, SupplierName: partnerName || 'Исполнитель' },
        });
      } else {
        const orgInn = await getUserOrgInn(job.userId);
        const orgData = await getUserPayoutRequisites(job.userId);
        if (!orgInn) throw new Error('NO_ORG_INN');
        const sales = await listSales(job.userId);
        const sale = sales.find((s) => s.orderId === job.orderId);
        const invoiceIdOffset = sale?.invoiceIdOffset || null;
        if (!invoiceIdOffset) throw new Error('NO_INVOICE_ID_OFFSET');
        payload = buildFermaReceiptPayload({
          party: 'org',
          partyInn: orgInn,
          description: job.description,
          amountRub: job.amountRub,
          vatRate: job.vatRate,
          methodCode: PAYMENT_METHOD_FULL_PAYMENT,
          orderId: job.orderId,
          docType: 'Income',
          buyerEmail: job.buyerEmail || null,
          invoiceId: invoiceIdOffset,
          callbackUrl,
          withAdvanceOffset: true,
          paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' },
        });
      }
      const created = await fermaCreateReceipt(payload, { baseUrl, authToken: token });
      try {
        const { updateSaleOfdUrlsByOrderId } = await import('./taskStore');
        await updateSaleOfdUrlsByOrderId(job.userId, job.orderId, { ofdFullId: created.id || null });
      } catch {}
    } catch {
      // keep the job for next attempt
      remain.push(job);
    }
  }
  await writeStore({ jobs: remain });
}


