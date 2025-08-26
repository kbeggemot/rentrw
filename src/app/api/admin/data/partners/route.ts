import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';

type PartnerRecord = any;
type Store = { users?: Record<string, PartnerRecord[]> };

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function readStore(): Promise<Store> {
  const raw = await readText('.data/partners.json');
  if (!raw) return { users: {} };
  try { return JSON.parse(raw) as Store; } catch { return { users: {} }; }
}

async function writeStore(store: Store): Promise<void> {
  await writeText('.data/partners.json', JSON.stringify(store, null, 2));
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const s = await readStore();
  const items: Array<PartnerRecord & { userId: string } > = [];
  for (const [uid, arr] of Object.entries(s.users || {})) {
    (arr || []).forEach((p) => items.push({ ...(p as any), userId: uid }));
  }
  items.sort((a: any, b: any) => {
    const at = Date.parse(a?.createdAt || a?.updatedAt || 0);
    const bt = Date.parse(b?.createdAt || b?.updatedAt || 0);
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at; // latest first
  });
  return NextResponse.json({ items });
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
  const phone = String(body?.phone || '').trim();
  const patch = (body?.patch && typeof body.patch === 'object') ? body.patch : null;
  if (!userId || !phone || !patch) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const s = await readStore();
  const arr = Array.isArray(s.users?.[userId]) ? (s.users as any)[userId] as PartnerRecord[] : [];
  const normalize = (x: string) => x.replace(/\D/g, '');
  const idx = arr.findIndex((x) => normalize(String(x.phone||'')) === normalize(phone));
  if (idx === -1) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const allowed = new Set(['fio','status','inn','orgInn','hidden']);
  const cur = arr[idx];
  const next: any = { ...cur };
  for (const [k,v] of Object.entries(patch)) if (allowed.has(k)) (next as any)[k] = v as any;
  next.updatedAt = new Date().toISOString();
  arr[idx] = next;
  if (!s.users) s.users = {} as any;
  (s.users as any)[userId] = arr;
  await writeStore(s);
  try { await appendAdminEntityLog('partner', [String(userId), normalize(phone)], { source: 'manual', message: 'admin patch', data: { patch } }); } catch {}
  return NextResponse.json({ ok: true, item: next });
}


