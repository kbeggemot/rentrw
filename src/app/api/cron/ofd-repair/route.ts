import { NextResponse } from 'next/server';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';
import { deleteSale, deleteSaleByOrder } from '@/server/taskStore';
import { listAllSales } from '@/server/taskStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = process.env.CRON_SECRET || '';
    if (!expected || token !== expected) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    // Optional: scoped run
    const userId = url.searchParams.get('userId') || undefined;
    const orderIdStr = url.searchParams.get('orderId') || undefined;
    const orderId = orderIdStr ? Number(orderIdStr) : undefined;
    const debug = url.searchParams.get('debug') === '1';
    const deleteTaskId = url.searchParams.get('deleteTaskId') || undefined;
    const deleteOrderStr = url.searchParams.get('deleteOrderId') || undefined;
    const deleteOrder = deleteOrderStr ? Number(deleteOrderStr) : undefined;

    if (userId) {
      if (deleteTaskId) {
        const ok = await deleteSale(userId, deleteTaskId);
        return NextResponse.json({ ok, deleted: ok ? { userId, taskId: deleteTaskId } : null });
      }
      if (typeof deleteOrder === 'number' && Number.isFinite(deleteOrder)) {
        const res = await deleteSaleByOrder(userId, deleteOrder, url.searchParams.get('onlyTaskId') || undefined as any);
        return NextResponse.json({ ok: true, removed: res.removed, scope: { userId, orderId: deleteOrder } });
      }
      await repairUserSales(userId, Number.isFinite(orderId as any) ? (orderId as any) : undefined);
    } else {
      const all = await listAllSales();
      const uids = Array.from(new Set(all.map((s: any) => s.userId)));
      for (const uid of uids) {
        try { await repairUserSales(uid, Number.isFinite(orderId as any) ? (orderId as any) : undefined); } catch {}
      }
    }
    try { startOfdRepairWorker(); } catch {}
    if (debug && userId && typeof orderId === 'number' && Number.isFinite(orderId)) {
      try {
        const allForUser = await listAllSales();
        const sale = allForUser.find((s: any) => s.userId === userId && Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN) === orderId) || null;
        if (sale) {
          const out = {
            orderId,
            taskId: sale.taskId,
            status: sale.status,
            rootStatus: sale.rootStatus || null,
            serviceEndDate: sale.serviceEndDate || null,
            isAgent: !!sale.isAgent,
            invoiceIdPrepay: sale.invoiceIdPrepay || null,
            invoiceIdFull: sale.invoiceIdFull || null,
            invoiceIdOffset: sale.invoiceIdOffset || null,
            ofdPrepayId: sale.ofdPrepayId || null,
            ofdUrl: sale.ofdUrl || null,
            ofdFullId: sale.ofdFullId || null,
            ofdFullUrl: sale.ofdFullUrl || null,
            additionalCommissionOfdUrl: sale.additionalCommissionOfdUrl || null,
          };
          return NextResponse.json({ ok: true, sale: out });
        }
      } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


