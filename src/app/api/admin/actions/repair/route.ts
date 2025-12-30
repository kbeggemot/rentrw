import { NextResponse } from 'next/server';
import { readText, writeText, list } from '@/server/storage';
import { getAdminByUsername } from '@/server/adminStore';
import { listAllSales } from '@/server/taskStore';
import { repairUserSales, startOfdRepairWorker } from '@/server/ofdRepairWorker';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function rebuildFromPostbackCache(): Promise<{ added: number; sales: number }> {
  const raw = await readText('.data/tasks.json');
  const store = raw ? (JSON.parse(raw) as any) : { tasks: [], sales: [] };
  const seen = new Set<string>(Array.isArray(store?.sales) ? store.sales.map((s: any) => `${s.userId}:${s.taskId}`) : []);
  const files = (await list('.data')).filter((p) => /postback_cache_.*\.json$/.test(p));
  let added = 0;
  for (const f of files) {
    try {
      const txt = await readText(f);
      const d = txt ? JSON.parse(txt) : {};
      const uid = String(d?.userId || (/(?:postback_cache_)([^.]+)/.exec(f || '') || [])[1] || '');
      const tasks = Array.isArray(d?.tasks) ? d.tasks : [];
      for (const t of tasks) {
        const task = (t && (t.task || t)) as any;
        const taskId = String(task?.id ?? '');
        if (!taskId || !uid) continue;
        const key = `${uid}:${taskId}`;
        if (seen.has(key)) continue;
        const orderRaw = (task?.acquiring_order?.order ?? task?.order) as any;
        const orderNum = typeof orderRaw === 'string' ? Number(orderRaw.replace(/\D/g, '')) : (typeof orderRaw === 'number' ? orderRaw : NaN);
        const ofd = (task?.ofd_url ?? task?.acquiring_order?.ofd_url) || null;
        const createdAtRw = (task?.created_at as string | undefined) ?? null;
        const isAgent = Boolean(task?.additional_commission_value);
        const amountGross = typeof task?.amount_gross === 'number' ? task.amount_gross : (typeof task?.amount_gross === 'string' ? Number(task.amount_gross) : 0);
        const status = (task?.acquiring_order?.status as string | undefined) ?? null;
        const now = new Date().toISOString();
        store.sales = Array.isArray(store.sales) ? store.sales : [];
        store.sales.push({
          taskId,
          orderId: Number.isFinite(orderNum) ? orderNum : (store.sales.length + 1),
          userId: uid,
          orgInn: 'неизвестно',
          clientEmail: (task?.acquiring_order?.client_email ?? null) as any,
          amountGrossRub: Number.isFinite(amountGross) ? amountGross : 0,
          isAgent,
          retainedCommissionRub: 0,
          source: 'external',
          rwOrderId: Number.isFinite(orderNum) ? orderNum : null,
          status,
          ofdUrl: ofd,
          ofdFullUrl: null,
          ofdPrepayId: null,
          ofdFullId: null,
          additionalCommissionOfdUrl: (task?.additional_commission_ofd_url ?? null) as any,
          npdReceiptUri: (task?.receipt_uri ?? null) as any,
          serviceEndDate: null,
          vatRate: null,
          createdAtRw,
          hidden: String(status || '').toLowerCase() === 'expired',
          createdAt: createdAtRw || now,
          updatedAt: now,
        });
        store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
        store.tasks.push({ id: taskId, orderId: Number.isFinite(orderNum) ? orderNum : (store.sales.length), createdAt: now });
        seen.add(key);
        added += 1;
      }
    } catch {}
  }
  await writeText('.data/tasks.json', JSON.stringify(store, null, 2));
  return { added, sales: (store?.sales || []).length };
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const url = new URL(req.url);
    const rebuild = url.searchParams.get('rebuild') === '1';
    if (rebuild) {
      const out = await rebuildFromPostbackCache();
      return NextResponse.json({ ok: true, mode: 'rebuild', ...out });
    }

    // Default: run OFD repair across users and ensure worker
    try {
      const all = await listAllSales();
      const uids = Array.from(new Set(all.map((s) => s.userId)));
      await Promise.all(uids.map((u) => repairUserSales(u).catch(() => void 0)));
    } catch {}
    try { startOfdRepairWorker(); } catch {}
    return NextResponse.json({ ok: true, mode: 'ofd_repair' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  // Accept JSON payload via header x-fallback-payload (base64 JSON) and route through POST logic.
  try {
    const body = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!body) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


