import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type OrgStore = { orgs?: Record<string, any> };

async function readStore(): Promise<OrgStore> {
  const raw = await readText('.data/orgs.json');
  if (!raw) return { orgs: {} };
  try { return JSON.parse(raw) as OrgStore; } catch { return { orgs: {} }; }
}

async function writeStore(s: OrgStore): Promise<void> {
  await writeText('.data/orgs.json', JSON.stringify(s, null, 2));
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.redirect(new URL('/admin', req.url));
  const body = await req.formData();
  const inn = String(body.get('inn') || '').replace(/\D/g,'');
  const name = String(body.get('name') || '').trim() || null;
  const s = await readStore();
  if (!s.orgs) s.orgs = {} as any;
  const cur = (s.orgs as any)[inn];
  if (!cur) return NextResponse.redirect(new URL('/admin', req.url));
  const next: any = { ...cur, name, updatedAt: new Date().toISOString() };
  (s.orgs as any)[inn] = next;
  await writeStore(s);
  return NextResponse.redirect(new URL(`/admin/orgs/${encodeURIComponent(inn)}`, req.url));
}


