import { NextResponse } from 'next/server';
import { createPaymentLink, listPaymentLinks } from '@/server/paymentLinkStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const items = await listPaymentLinks(userId);
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim();
    const sumMode = (body?.sumMode === 'fixed' ? 'fixed' : 'custom') as 'custom' | 'fixed';
    const amountRub = sumMode === 'fixed' ? Number(body?.amountRub || 0) : null;
    const vatRate = (['none','0','10','20'].includes(String(body?.vatRate)) ? String(body?.vatRate) : 'none') as 'none'|'0'|'10'|'20';
    const isAgent = !!body?.isAgent;
    const commissionType = isAgent && (body?.commissionType === 'fixed' || body?.commissionType === 'percent') ? body?.commissionType : null;
    const commissionValue = isAgent && typeof body?.commissionValue === 'number' ? Number(body?.commissionValue) : null;
    const partnerPhone = isAgent ? (String(body?.partnerPhone || '').trim() || null) : null;
    const method = (body?.method === 'qr' || body?.method === 'card') ? body?.method : 'any';
    if (!title || !description) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    if (sumMode === 'fixed' && (!Number.isFinite(amountRub) || Number(amountRub) <= 0)) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 });
    const item = await createPaymentLink(userId, { title, description, sumMode, amountRub: amountRub ?? undefined, vatRate, isAgent, commissionType: commissionType as any, commissionValue: commissionValue ?? undefined, partnerPhone, method });
    const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const protoHdr = req.headers.get('x-forwarded-proto') || (hostHdr.startsWith('localhost') ? 'http' : 'https');
    const url = `${protoHdr}://${hostHdr}/link/${encodeURIComponent(item.code)}`;
    return NextResponse.json({ ok: true, link: url, item }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


