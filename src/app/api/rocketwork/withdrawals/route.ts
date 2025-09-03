import { NextResponse } from 'next/server';
import { listWithdrawals, upsertWithdrawal, startWithdrawalPoller, listAllWithdrawalsForOrg } from '@/server/withdrawalStore';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { getSelectedOrgInn } from '@/server/orgContext';

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
    // 1) Read local filtered by selected org, with showAll override
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    let items = inn && showAll ? await listAllWithdrawalsForOrg(inn) : await listWithdrawals(userId, inn || undefined);
    // 2) If empty, try fetch last 50 RW tasks and backfill withdrawals
    if (items.length === 0) {
      try {
        const { token } = await resolveRwTokenWithFingerprint(req, userId, inn, null);
        if (token) {
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const url = new URL('tasks?limit=50', base.endsWith('/') ? base : base + '/').toString();
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          const txt = await r.text();
          let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
          const arr = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
          for (const t of arr) {
            const kind = String(t?.type || '').toLowerCase();
            if (kind !== 'withdrawal') continue;
            const id = (t?.id ?? t?.task_id);
            if (id == null) continue;
            const amountRub = typeof t?.amount_gross === 'number' ? t.amount_gross : (typeof t?.amount === 'number' ? t.amount : undefined);
            const status = t?.status || t?.acquiring_order?.status || null;
            const createdAt = t?.created_at || t?.updated_at || new Date().toISOString();
            await upsertWithdrawal(userId, { taskId: id, amountRub: typeof amountRub === 'number' ? amountRub : undefined as any, status: status ?? null, createdAt, orgInn: inn || null });
          }
          items = inn && showAll ? await listAllWithdrawalsForOrg(inn) : await listWithdrawals(userId, inn || undefined);
          // Arm pollers for any active withdrawals to keep status fresh even without UI
          try {
            for (const it of items) {
              if (String(it?.status || '').toLowerCase() !== 'paid') startWithdrawalPoller(userId, it.taskId);
            }
          } catch {}
        }
      } catch {}
    }
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


