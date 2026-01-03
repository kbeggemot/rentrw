import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { listAllSales, updateSaleFromStatus } from '@/server/taskStore';
import { listActiveTokensForOrg } from '@/server/orgStore';
import { getDecryptedApiToken } from '@/server/secureStore';
import { fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

function authedAdmin(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

function digitsOnly(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function isFinalAcquiringStatus(st: string): boolean {
  const s = String(st || '').toLowerCase();
  return s === 'transfered' || s === 'transferred' || s === 'expired' || s === 'refunded' || s === 'failed';
}

async function refreshSales(params: { taskId?: string | null; limit: number; days: number; force: boolean }) {
  const { taskId, limit, days, force } = params;
  const all = await listAllSales();
  const now = Date.now();
  const cutoff = now - Math.max(0, days) * 24 * 60 * 60 * 1000;
  const pickTs = (s: any) => {
    const iso = (s?.createdAtRw || s?.createdAt || s?.updatedAt) as string | undefined;
    const n = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(n) ? n : 0;
  };

  let targets = all;
  if (taskId) {
    targets = targets.filter((s) => String(s.taskId) === String(taskId));
  } else {
    targets = targets.filter((s: any) => pickTs(s) >= cutoff);
    if (!force) {
      targets = targets.filter((s: any) => !isFinalAcquiringStatus(String(s?.status || '')));
    }
  }
  targets.sort((a: any, b: any) => pickTs(b) - pickTs(a));
  targets = targets.slice(0, Math.max(1, Math.min(200, limit)));

  const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
  let attempted = 0;
  let updated = 0;
  const errors: Array<{ taskId: string; userId: string; error: string }> = [];

  for (const s of targets) {
    attempted += 1;
    const uid = String((s as any).userId || '');
    const tid = String((s as any).taskId || '');
    if (!uid || !tid) continue;

    const inn = digitsOnly((s as any).orgInn || '');
    let tokens: string[] = [];
    try {
      if (inn) tokens = await listActiveTokensForOrg(inn, uid);
    } catch {}
    if (!tokens || tokens.length === 0) {
      try {
        const legacy = await getDecryptedApiToken(uid);
        if (legacy) tokens = [legacy];
      } catch {}
    }
    if (!tokens || tokens.length === 0) {
      errors.push({ taskId: tid, userId: uid, error: 'NO_TOKEN' });
      continue;
    }

    let ok = false;
    let taskObj: any = null;
    for (const tok of tokens) {
      try {
        const url = new URL(`tasks/${encodeURIComponent(String(tid))}`, base.endsWith('/') ? base : base + '/').toString();
        const out = await fetchTextWithTimeout(
          url,
          { method: 'GET', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' },
          15_000
        );
        if (!out.res.ok) continue;
        let d: any = null;
        try { d = out.text ? JSON.parse(out.text) : null; } catch { d = null; }
        taskObj = (d && typeof d === 'object' && 'task' in d) ? (d.task as any) : d;
        ok = true;
        break;
      } catch {
        continue;
      }
    }
    if (!ok || !taskObj) {
      errors.push({ taskId: tid, userId: uid, error: 'RW_FETCH_FAILED' });
      continue;
    }

    const ao = taskObj?.acquiring_order || null;
    const acquiringStatus = ao?.status ?? null;
    const rootStatus = taskObj?.status ?? null;
    const addComm = taskObj?.additional_commission_ofd_url ?? null;
    const npd = taskObj?.receipt_uri ?? null;
    const ofdUrl = taskObj?.ofd_url ?? ao?.ofd_url ?? null;

    try {
      await updateSaleFromStatus(uid, tid, {
        status: acquiringStatus,
        ofdUrl: ofdUrl || undefined,
        additionalCommissionOfdUrl: addComm || undefined,
        npdReceiptUri: npd || undefined,
        rootStatus,
      } as any);
      updated += 1;
    } catch (e) {
      errors.push({ taskId: tid, userId: uid, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { attempted, updated, errors: errors.slice(0, 20) };
}

export async function GET(req: Request) {
  try {
    const admin = authedAdmin(req);
    if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    // Any logged admin can run a refresh (read-only operation for RW + internal status sync).
    // If you want to restrict to superadmin only, tighten this check.
    try {
      const rec = await getAdminByUsername(admin);
      if (!rec) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    } catch {}

    const url = new URL(req.url);
    const run = url.searchParams.get('run') === '1' || url.searchParams.get('via') === 'get';
    if (!run) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

    const taskId = url.searchParams.get('taskId');
    const limit = (() => { const n = Number(url.searchParams.get('limit') || '30'); return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 30; })();
    const days = (() => { const n = Number(url.searchParams.get('days') || '7'); return Number.isFinite(n) ? Math.max(0, Math.min(60, Math.floor(n))) : 7; })();
    const force = url.searchParams.get('force') === '1';

    const out = await refreshSales({ taskId: taskId ? String(taskId) : null, limit, days, force });
    return NextResponse.json({ ok: true, ...out }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // allow POST as well (some environments prefer POST)
  try {
    const url = new URL(req.url);
    url.searchParams.set('run', '1');
    const req2 = new Request(url.toString(), { method: 'GET', headers: req.headers });
    return await GET(req2);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


