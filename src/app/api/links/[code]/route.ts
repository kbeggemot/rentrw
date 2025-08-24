import { NextResponse } from 'next/server';
import { deletePaymentLink, findLinkByCode, markLinkAccessed } from '@/server/paymentLinkStore';
import { getUserPayoutRequisites } from '@/server/userStore';

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
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const item = await findLinkByCode(code);
    if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    try { await markLinkAccessed(code); } catch {}
    const { userId, title, description, sumMode, amountRub, vatRate, isAgent, commissionType, commissionValue, partnerPhone, method } = item;
    let orgName: string | null = null;
    try { const reqs = await getUserPayoutRequisites(userId); orgName = reqs.orgName || null; } catch {}
    return NextResponse.json({ code, userId, title, description, sumMode, amountRub, vatRate, isAgent, commissionType, commissionValue, partnerPhone, method, orgName, orgInn: item.orgInn || null }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() || '');
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const ok = await deletePaymentLink(userId, code);
    return NextResponse.json({ ok });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


