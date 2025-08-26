import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type Store = { users?: Record<string, any[]> };

async function readStore(): Promise<Store> {
  const raw = await readText('.data/partners.json');
  if (!raw) return { users: {} };
  try { return JSON.parse(raw) as Store; } catch { return { users: {} }; }
}

async function writeStore(s: Store): Promise<void> {
  await writeText('.data/partners.json', JSON.stringify(s, null, 2));
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.redirect(new URL('/admin', req.url));
  const body = await req.formData();
  const uid = String(body.get('uid') || '');
  const phone = String(body.get('phone') || '');
  const s = await readStore();
  const arr = Array.isArray(s.users?.[uid]) ? (s.users as any)[uid] as any[] : [];
  const norm = (x: string) => x.replace(/\D/g, '');
  const idx = arr.findIndex((x) => norm(String(x.phone||'')) === norm(phone));
  if (idx === -1) return NextResponse.redirect(new URL('/admin', req.url));
  const next: any = { ...arr[idx] };
  const val = (k: string) => (body.has(k) ? String(body.get(k) || '').trim() : undefined);
  const nz = (v: string | undefined) => (typeof v === 'undefined' ? undefined as any : (v.length ? v : null));
  const bool = (v: string | undefined) => (typeof v === 'undefined' ? undefined as any : v === 'true');

  const fio = nz(val('fio')); if (fio !== undefined) next.fio = fio;
  const status = nz(val('status')); if (status !== undefined) next.status = status;
  const inn = val('inn'); if (inn !== undefined) next.inn = inn ? inn.replace(/\D/g,'') || null : null;
  const orgInn = val('orgInn'); if (orgInn !== undefined) next.orgInn = orgInn ? orgInn.replace(/\D/g,'') || null : null;
  const hidden = bool(val('hidden')); if (hidden !== undefined) next.hidden = hidden;
  next.updatedAt = new Date().toISOString();
  arr[idx] = next;
  if (!s.users) s.users = {} as any;
  (s.users as any)[uid] = arr;
  await writeStore(s);
  const path = `/admin/partners/${encodeURIComponent(uid)}/${encodeURIComponent(phone)}`;
  const setFlash = (res: Response) => { try { (res as any).headers?.set('Set-Cookie', `flash=PARTNER_SAVED; Path=/; Max-Age=5; SameSite=Lax`); } catch {} return res; };
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  const host = req.headers.get('host');
  if (xfProto && (xfHost || host)) {
    const proto = xfProto.split(',')[0].trim();
    const h = (xfHost || host)!.split(',')[0].trim();
    const abs = new URL(path, `${proto}://${h}`);
    return setFlash(NextResponse.redirect(abs, 303));
  }
  return setFlash(NextResponse.redirect(path, 303));
}


