import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type Store = { tasks?: any[]; sales?: any[] };

async function readStore(): Promise<Store> {
  const raw = await readText('.data/tasks.json');
  if (!raw) return { tasks: [], sales: [] };
  try { return JSON.parse(raw) as Store; } catch { return { tasks: [], sales: [] }; }
}

async function writeStore(s: Store): Promise<void> {
  await writeText('.data/tasks.json', JSON.stringify(s, null, 2));
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.redirect(new URL('/admin', req.url));
  const body = await req.formData();
  const uid = String(body.get('uid') || '');
  const taskId = body.get('taskId');
  if (!uid || typeof taskId === 'undefined') return NextResponse.redirect(new URL('/admin', req.url));
  const s = await readStore();
  const arr = Array.isArray(s.sales) ? s.sales : [];
  const idx = arr.findIndex((x) => String(x.userId) === uid && (x.taskId == (taskId as any)));
  if (idx === -1) return NextResponse.redirect(new URL('/admin', req.url));
  const next: any = { ...arr[idx] };
  const val = (k: string) => (body.has(k) ? String(body.get(k) || '').trim() : undefined);
  const nz = (v: string | undefined) => (typeof v === 'undefined' ? undefined as any : (v.length ? v : null));
  const num = (v: string | undefined) => {
    if (typeof v === 'undefined') return undefined as any;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v: string | undefined) => (typeof v === 'undefined' ? undefined as any : v === 'true');

  const orgInn = val('orgInn'); if (orgInn !== undefined) next.orgInn = orgInn ? orgInn.replace(/\D/g,'') || null : null;
  const clientEmail = nz(val('clientEmail')); if (clientEmail !== undefined) next.clientEmail = clientEmail;
  const description = nz(val('description')); if (description !== undefined) next.description = description;
  const amountGrossRub = num(val('amountGrossRub')); if (amountGrossRub !== undefined) next.amountGrossRub = amountGrossRub;
  const isAgent = bool(val('isAgent')); if (isAgent !== undefined) next.isAgent = isAgent;
  const retainedCommissionRub = num(val('retainedCommissionRub')); if (retainedCommissionRub !== undefined) next.retainedCommissionRub = retainedCommissionRub;
  const status = nz(val('status')); if (status !== undefined) next.status = status;
  const rootStatus = nz(val('rootStatus')); if (rootStatus !== undefined) next.rootStatus = rootStatus;
  const ofdUrl = nz(val('ofdUrl')); if (ofdUrl !== undefined) next.ofdUrl = ofdUrl;
  const ofdFullUrl = nz(val('ofdFullUrl')); if (ofdFullUrl !== undefined) next.ofdFullUrl = ofdFullUrl;
  const ofdPrepayId = nz(val('ofdPrepayId')); if (ofdPrepayId !== undefined) next.ofdPrepayId = ofdPrepayId;
  const ofdFullId = nz(val('ofdFullId')); if (ofdFullId !== undefined) next.ofdFullId = ofdFullId;
  const additionalCommissionOfdUrl = nz(val('additionalCommissionOfdUrl')); if (additionalCommissionOfdUrl !== undefined) next.additionalCommissionOfdUrl = additionalCommissionOfdUrl;
  const npdReceiptUri = nz(val('npdReceiptUri')); if (npdReceiptUri !== undefined) next.npdReceiptUri = npdReceiptUri;
  const serviceEndDate = nz(val('serviceEndDate')); if (serviceEndDate !== undefined) next.serviceEndDate = serviceEndDate;
  const vatRate = val('vatRate'); if (vatRate !== undefined) next.vatRate = (['none','0','10','20'].includes(vatRate) ? vatRate : null);
  const hidden = bool(val('hidden')); if (hidden !== undefined) next.hidden = hidden;
  const invoiceIdPrepay = nz(val('invoiceIdPrepay')); if (invoiceIdPrepay !== undefined) next.invoiceIdPrepay = invoiceIdPrepay;
  const invoiceIdOffset = nz(val('invoiceIdOffset')); if (invoiceIdOffset !== undefined) next.invoiceIdOffset = invoiceIdOffset;
  const invoiceIdFull = nz(val('invoiceIdFull')); if (invoiceIdFull !== undefined) next.invoiceIdFull = invoiceIdFull;
  const rwTokenFp = nz(val('rwTokenFp')); if (rwTokenFp !== undefined) next.rwTokenFp = rwTokenFp;
  // If orgInn still empty/unknown and rwTokenFp present, infer org in background
  try {
    const curInn = (next.orgInn && String(next.orgInn).trim().length > 0) ? String(next.orgInn) : null;
    if ((!curInn || curInn === 'неизвестно') && next.rwTokenFp) {
      const { findOrgByFingerprint } = await import('@/server/orgStore');
      const org = await findOrgByFingerprint(next.rwTokenFp);
      if (org?.inn) next.orgInn = org.inn;
    }
  } catch {}
  const rwOrderId = nz(val('rwOrderId')); if (rwOrderId !== undefined) next.rwOrderId = rwOrderId;
  next.updatedAt = new Date().toISOString();
  arr[idx] = next;
  await writeStore({ ...(s as any), sales: arr });
  const back = new URL(`/admin/sales/${encodeURIComponent(uid)}/${encodeURIComponent(String(taskId))}`, req.url);
  // Simple and robust redirect from POST to GET
  return NextResponse.redirect(back, 303);
}


