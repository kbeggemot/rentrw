import { NextResponse } from 'next/server';
import { resolveResumeToken } from '@/server/payResumeStore';
import { listSales } from '@/server/taskStore';
import { getUserPayoutRequisites } from '@/server/userStore';
import { getDecryptedApiToken } from '@/server/secureStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sid = url.searchParams.get('sid') || '';
    const orderParam = url.searchParams.get('order');
    let userId: string | null = null;
    let orderId: number | null = null;
    if (sid) {
      const entry = await resolveResumeToken(sid);
      if (!entry) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      userId = entry.userId;
      orderId = entry.orderId;
    } else if (orderParam) {
      orderId = Number(orderParam);
      if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });
      // try to resolve userId from header or cookie
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
      userId = (m ? decodeURIComponent(m[1]) : undefined) || req.headers.get('x-user-id');
      if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    } else {
      return NextResponse.json({ error: 'NO_QUERY' }, { status: 400 });
    }
    if (!userId || orderId == null) return NextResponse.json({ error: 'NO_DATA' }, { status: 400 });
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
        isAgent: !!sale.isAgent,
        ofdUrl: sale.ofdUrl ?? null,
        ofdFullUrl: sale.ofdFullUrl ?? null,
        commissionUrl: sale.additionalCommissionOfdUrl ?? null,
        npdReceiptUri: sale.npdReceiptUri ?? null,
      };
    }
    // Try to enrich with payment method and created_at from RW
    try {
      const taskId = (payload.taskId as any) ?? null;
      if (taskId != null) {
        const token = await getDecryptedApiToken(userId);
        if (token) {
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const url = new URL(`tasks/${encodeURIComponent(String(taskId))}`, base.endsWith('/') ? base : base + '/').toString();
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          const txt = await res.text();
          let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
          const taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
          const typ = (taskObj?.acquiring_order?.type || '').toString().toUpperCase();
          if (typ === 'QR' || typ === 'CARD') payload.method = (typ === 'QR' ? 'qr' : 'card');
          if (!payload.sale) payload.sale = {} as any;
          if (!(payload.sale as any).createdAt && taskObj?.created_at) (payload.sale as any).createdAt = taskObj.created_at;
        }
      }
    } catch {}
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


