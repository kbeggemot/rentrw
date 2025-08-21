import { NextResponse } from 'next/server';
import { resolveResumeToken } from '@/server/payResumeStore';
import { listSales } from '@/server/taskStore';
import { getUserPayoutRequisites } from '@/server/userStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sid = url.searchParams.get('sid') || '';
    if (!sid) return NextResponse.json({ error: 'NO_SID' }, { status: 400 });
    const entry = await resolveResumeToken(sid);
    if (!entry) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const { userId, orderId } = entry;
    const sales = await listSales(userId);
    const sale = sales.find((s) => s.orderId === orderId) || null;
    let orgName: string | null = null;
    try { const reqs = await getUserPayoutRequisites(userId); orgName = reqs?.orgName || null; } catch {}
    const payload: Record<string, unknown> = { userId, orderId, taskId: sale?.taskId ?? null, orgName };
    if (sale) {
      payload.sale = {
        description: sale.description ?? null,
        amountRub: sale.amountGrossRub,
        createdAt: sale.createdAtRw || sale.createdAt,
        status: sale.status ?? null,
        ofdUrl: sale.ofdUrl ?? null,
        ofdFullUrl: sale.ofdFullUrl ?? null,
        commissionUrl: sale.additionalCommissionOfdUrl ?? null,
        npdReceiptUri: sale.npdReceiptUri ?? null,
      };
    }
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


