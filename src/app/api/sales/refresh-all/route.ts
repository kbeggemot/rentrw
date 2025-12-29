import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { listAllSales, updateSaleFromStatus } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = m ? decodeURIComponent(m[1]) : req.headers.get('x-user-id') || null;
    const token = userId ? await getDecryptedApiToken(userId) : null;
    if (!userId || !token) return NextResponse.json({ error: 'NO_USER_OR_TOKEN' }, { status: 401 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const all = await listAllSales();
    const mine = all.filter((s) => {
      if (s.userId !== userId) return false;
      const root = String(((s as any).rootStatus || '') as string).toLowerCase();
      return root !== 'error' && root !== 'canceled' && root !== 'cancelled';
    });

    for (const s of mine) {
      try {
        const url = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
        const out = await fetchTextWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
        const res = out.res;
        const text = out.text;
        let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        const t: RocketworkTask = (data && typeof data === 'object' && 'task' in (data as Record<string, unknown>)) ? ((data as any).task as RocketworkTask) : (data as RocketworkTask);

        const ofd = (t?.ofd_url as string | undefined) ?? (t?.acquiring_order?.ofd_url as string | undefined) ?? null;
        const add = (t?.additional_commission_ofd_url as string | undefined) ?? null;
        const npd = (t?.receipt_uri as string | undefined) ?? null;
        await updateSaleFromStatus(userId, s.taskId, { status: t?.acquiring_order?.status, ofdUrl: ofd, additionalCommissionOfdUrl: add, npdReceiptUri: npd });

        const aoStatus = String(t?.acquiring_order?.status || '').toLowerCase();
        const rootStatus = String(t?.status || '').toLowerCase();
        const hasAgent = Boolean(t?.additional_commission_value);
        // Gate by presence of full receipt in our store
        const { findSaleByTaskId } = await import('@/server/taskStore');
        const saleRec = await findSaleByTaskId(userId, s.taskId);
        const hasFull = Boolean(saleRec?.ofdFullUrl);
        const hasCommission = Boolean((saleRec as any)?.additionalCommissionOfdUrl);
        if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed' && hasFull && hasCommission && !npd) {
          const payUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
          try {
            await fetchTextWithTimeout(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
          } catch {}
        }
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


