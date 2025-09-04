import { NextResponse } from 'next/server';
import { resolveSalePageCode } from '@/server/salePageStore';
import { listSales } from '@/server/taskStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const code = decodeURIComponent(segs[segs.length - 1] || '');
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const entry = await resolveSalePageCode(code);
    if (!entry) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const { userId, orderId } = entry;
    let sale: any = null;
    let orgInn: string | null = null;
    try {
      const all = await listSales(userId);
      const s = all.find((x) => x.orderId === orderId) || null;
      if (s) {
        orgInn = (s as any).orgInn || null;
        sale = {
          orderId: s.orderId,
          taskId: s.taskId,
          description: s.description || null,
          amountRub: s.amountGrossRub,
          createdAt: s.createdAtRw || s.createdAt,
          status: s.status || null,
          isAgent: !!s.isAgent,
          ofdUrl: s.ofdUrl || null,
          ofdFullUrl: s.ofdFullUrl || null,
          commissionUrl: s.additionalCommissionOfdUrl || null,
          npdReceiptUri: s.npdReceiptUri || null,
          orgInn: (s as any).orgInn || null,
          itemsSnapshot: Array.isArray((s as any).itemsSnapshot) ? (s as any).itemsSnapshot : null,
        };
      }
    } catch {}
    return NextResponse.json({ userId, orderId, sale, orgInn });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


