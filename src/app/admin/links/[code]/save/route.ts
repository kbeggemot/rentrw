import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type Store = { items?: any[] };

async function readStore(): Promise<Store> {
  const raw = await readText('.data/payment_links.json');
  if (!raw) return { items: [] };
  try { return JSON.parse(raw) as Store; } catch { return { items: [] }; }
}

async function writeStore(s: Store): Promise<void> {
  await writeText('.data/payment_links.json', JSON.stringify(s, null, 2));
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.redirect(new URL('/admin', req.url));
  const body = await req.formData();
  const code = String(body.get('code') || '');
  const s = await readStore();
  const arr = Array.isArray(s.items) ? s.items : [];
  const idx = arr.findIndex((x) => String(x.code) === code);
  if (idx === -1) return NextResponse.redirect(new URL('/admin', req.url));
  const next: any = { ...arr[idx] };
  // Parse and coerce types correctly so UI and public API see fresh values
  const val = (k: string) => (body.has(k) ? String(body.get(k) || '').trim() : undefined);
  const num = (v: string | undefined) => {
    if (typeof v === 'undefined') return undefined as any;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const nz = (v: string | undefined) => (typeof v === 'undefined' ? undefined as any : (v.length ? v : null));

  const orgInn = val('orgInn'); if (orgInn !== undefined) next.orgInn = orgInn ? orgInn.replace(/\D/g,'') || null : null;
  const title = nz(val('title')); if (title !== undefined) next.title = title;
  const description = nz(val('description')); if (description !== undefined) next.description = description;
  const sumMode = val('sumMode'); if (sumMode !== undefined) next.sumMode = (sumMode === 'fixed' ? 'fixed' : 'custom');
  const amountRubRaw = val('amountRub'); if (amountRubRaw !== undefined) next.amountRub = num(amountRubRaw);
  const vatRate = val('vatRate'); if (vatRate !== undefined) next.vatRate = (['none','0','10','20'].includes(vatRate) ? vatRate : null);
  const isAgent = val('isAgent'); if (isAgent !== undefined) next.isAgent = isAgent === 'true';
  const commissionType = val('commissionType'); if (commissionType !== undefined) next.commissionType = (['percent','fixed'].includes(commissionType) ? commissionType : null);
  const commissionValueRaw = val('commissionValue'); if (commissionValueRaw !== undefined) next.commissionValue = num(commissionValueRaw);
  const partnerPhone = nz(val('partnerPhone')); if (partnerPhone !== undefined) next.partnerPhone = partnerPhone;
  const method = val('method'); if (method !== undefined) next.method = (['any','qr','card'].includes(method) ? method : 'any');
  arr[idx] = next;
  await writeStore({ items: arr });
  // Build redirect with forwarded headers; also set flash cookie
  const path = `/admin/links/${encodeURIComponent(code)}`;
  const setFlash = (res: Response) => { try { (res as any).headers?.set('Set-Cookie', `flash=LINK_SAVED; Path=/; Max-Age=5; SameSite=Lax`); } catch {} return res; };
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


