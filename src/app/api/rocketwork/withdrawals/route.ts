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
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    let limit = Number(limitParam);
    if (!Number.isFinite(limit) || limit <= 0) limit = 15;
    if (limit > 200) limit = 200;
    const cursor = url.searchParams.get('cursor'); // format: createdAt|taskId
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
    // Pagination (descending by createdAt already in store)
    let startIndex = 0;
    if (cursor) {
      const [curAt, curTaskId] = cursor.split('|');
      const exactIdx = items.findIndex((x) => String(x.taskId) === String(curTaskId) && String(x.createdAt) === String(curAt));
      if (exactIdx !== -1) {
        startIndex = exactIdx + 1;
      } else if (curAt) {
        const curTs = Date.parse(curAt);
        startIndex = items.findIndex((x) => {
          const ts = Date.parse(x.createdAt);
          if (!Number.isNaN(ts) && !Number.isNaN(curTs)) {
            if (ts < curTs) return true; // list is desc
            if (ts === curTs) return String(x.taskId) < String(curTaskId);
            return false;
          }
          // Fallback string compare
          if (x.createdAt < curAt) return true;
          if (x.createdAt === curAt) return String(x.taskId) < String(curTaskId);
          return false;
        });
        if (startIndex === -1) startIndex = items.length; // nothing older
      }
    }
    const pageItems = items.slice(startIndex, startIndex + limit);
    let nextCursor: string | null = null;
    if (startIndex + limit < items.length && pageItems.length > 0) {
      const last = pageItems[pageItems.length - 1];
      nextCursor = `${last.createdAt}|${last.taskId}`;
    }
    return NextResponse.json({ items: pageItems, nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


