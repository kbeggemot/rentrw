import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { getAdminByUsername } from '@/server/adminStore';

type Store = { items?: any[] };

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function readStore(): Promise<Store> {
  const raw = await readText('.data/payment_links.json');
  if (!raw) return { items: [] };
  try { return JSON.parse(raw) as Store; } catch { return { items: [] }; }
}

async function writeStore(store: Store): Promise<void> {
  await writeText('.data/payment_links.json', JSON.stringify(store, null, 2));
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const s = await readStore();
  const list = Array.isArray(s.items) ? s.items : [];
  const sorted = [...list].sort((a: any, b: any) => {
    const at = Date.parse(a?.createdAt || 0);
    const bt = Date.parse(b?.createdAt || 0);
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
  const code = String(body?.code || '').trim();
  const patch = (body?.patch && typeof body.patch === 'object') ? body.patch : null;
  if (!code || !patch) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const s = await readStore();
  const arr = Array.isArray(s.items) ? s.items : [];
  const idx = arr.findIndex((x) => String(x.code) === code);
  if (idx === -1) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const allowed = new Set(['orgInn','title','description','sumMode','amountRub','vatRate','isAgent','commissionType','commissionValue','partnerPhone','method']);
  const cur = arr[idx];
  const next: any = { ...cur };
  for (const [k,v] of Object.entries(patch)) if (allowed.has(k)) (next as any)[k] = v as any;
  arr[idx] = next;
  await writeStore({ items: arr });
  return NextResponse.json({ ok: true, item: next });
}


