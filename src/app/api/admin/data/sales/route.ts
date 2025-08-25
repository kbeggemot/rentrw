import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { getAdminByUsername } from '@/server/adminStore';

type SaleRecord = any;
type Store = { tasks?: Array<{ id: number|string; orderId: number; createdAt: string }>; sales?: SaleRecord[] };

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function readStore(): Promise<Store> {
  const raw = await readText('.data/tasks.json');
  if (!raw) return { tasks: [], sales: [] };
  try { return JSON.parse(raw) as Store; } catch { return { tasks: [], sales: [] }; }
}

async function writeStore(store: Store): Promise<void> {
  await writeText('.data/tasks.json', JSON.stringify(store, null, 2));
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const s = await readStore();
  const url = new URL(req.url);
  const uid = url.searchParams.get('uid');
  const task = url.searchParams.get('task');
  const list = Array.isArray(s.sales) ? s.sales : [];
  if (uid && task) {
    let one = list.find((x) => String(x.userId) === uid && (x.taskId == (task as any)));
    // Fallback: find by taskId only (uid might be missing/mismatched in legacy records)
    if (!one) one = list.find((x) => (x.taskId == (task as any)));
    return NextResponse.json({ item: one || null });
  }
  const sorted = [...list].sort((a: any, b: any) => {
    const at = Date.parse((a?.createdAtRw || a?.createdAt || a?.updatedAt || 0) as any);
    const bt = Date.parse((b?.createdAtRw || b?.createdAt || b?.updatedAt || 0) as any);
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at; // latest first
  });
  return NextResponse.json({ items: sorted });
}

export async function PATCH(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  // Only superadmin can edit
  try {
    const cookie = req.headers.get('cookie') || '';
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  } catch {}
  const body = await req.json().catch(() => ({} as any));
  const userId = String(body?.userId || '').trim();
  const taskId = body?.taskId;
  const patch = (body?.patch && typeof body.patch === 'object') ? body.patch : null;
  if (!userId || typeof taskId === 'undefined' || !patch) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const s = await readStore();
  const arr = Array.isArray(s.sales) ? s.sales : [];
  const idx = arr.findIndex((x) => String(x.userId) === userId && (x.taskId == taskId));
  if (idx === -1) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const cur = arr[idx];
  const allowed = new Set(['orgInn','clientEmail','description','amountGrossRub','isAgent','retainedCommissionRub','status','rootStatus','ofdUrl','ofdFullUrl','ofdPrepayId','ofdFullId','additionalCommissionOfdUrl','npdReceiptUri','serviceEndDate','vatRate','hidden','invoiceIdPrepay','invoiceIdOffset','invoiceIdFull','rwTokenFp','rwOrderId']);
  const next: any = { ...cur };
  for (const [k,v] of Object.entries(patch)) {
    if (allowed.has(k)) (next as any)[k] = v as any;
  }
  next.updatedAt = new Date().toISOString();
  arr[idx] = next;
  await writeStore({ ...(s as any), sales: arr });
  return NextResponse.json({ ok: true, item: next });
}


