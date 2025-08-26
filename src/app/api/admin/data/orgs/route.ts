import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';

type OrgStore = { orgs?: Record<string, any> };

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function readStore(): Promise<OrgStore> {
  const raw = await readText('.data/orgs.json');
  if (!raw) return { orgs: {} };
  try { return JSON.parse(raw) as OrgStore; } catch { return { orgs: {} }; }
}

async function writeStore(store: OrgStore): Promise<void> {
  await writeText('.data/orgs.json', JSON.stringify(store, null, 2));
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const s = await readStore();
  const items = Object.values(s.orgs || {}).sort((a: any, b: any) => {
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
  const inn = String(body?.inn || '').replace(/\D/g,'');
  const patch = (body?.patch && typeof body.patch === 'object') ? body.patch : null;
  if (!inn || !patch) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const s = await readStore();
  if (!s.orgs) s.orgs = {} as any;
  const cur = (s.orgs as any)[inn];
  if (!cur) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const allowed = new Set(['name']);
  const next: any = { ...cur };
  for (const [k,v] of Object.entries(patch)) if (allowed.has(k)) (next as any)[k] = v as any;
  next.updatedAt = new Date().toISOString();
  (s.orgs as any)[inn] = next;
  await writeStore(s);
  try { await appendAdminEntityLog('org', [String(inn)], { source: 'manual', message: 'admin patch', data: { patch } }); } catch {}
  return NextResponse.json({ ok: true, item: next });
}


