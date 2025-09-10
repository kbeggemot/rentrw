import { NextResponse } from 'next/server';
// Fallback: dynamic import of helper to avoid hard compile dependency
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';
import { list, readText, writeText } from '@/server/storage';
const STATUS_FILE = '.data/maintenance/rebuild_indexes_status.json';

async function writeStatus(partial: any) {
  try {
    const prevRaw = await readText(STATUS_FILE).catch(() => null);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    const next = { ...prev, ...partial };
    await writeText(STATUS_FILE, JSON.stringify(next, null, 2));
  } catch {}
}

export const runtime = 'nodejs';

async function requireSuperadmin(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  const username = m ? decodeURIComponent(m[1]) : null;
  if (!username) return null;
  try {
    const user = await getAdminByUsername(username);
    if (!user || user.role !== 'superadmin') return null;
    return username;
  } catch { return null; }
}

async function handle(req: Request) {
  const username = await requireSuperadmin(req);
  if (!username) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const url = new URL(req.url);
  const asyncMode = url.searchParams.get('mode') === 'async' || url.searchParams.get('async') === '1';
  let processed = 0, errors = 0;
  try {
    const mod = await import('@/server/taskStore');
    const fn = (mod as any).rebuildSalesIndexesFromLegacy as (()=>Promise<{processed:number;errors:number}>) | undefined;
    if (typeof fn === 'function' && !asyncMode) {
      const res = await fn();
      processed = res?.processed ?? 0; errors = res?.errors ?? 0;
      await writeStatus({ running: false, processed, errors, finishedAt: new Date().toISOString() });
    } else {
      // Local fallback: rebuild by scanning sharded sales files
      const run = async () => {
        await writeStatus({ running: true, processed: 0, errors: 0, startedAt: new Date().toISOString() });
        try {
          const all = await list('.data/sales');
          const saleFiles = (all || []).filter((p) => /\.data\/sales\/[^/]+\/sales\/.+\.json$/.test(p));
          const byInn: Record<string, Array<{ taskId: string|number; orderId: string|number; userId: string; createdAt: string; updatedAt: string; status?: string|null; orgInn: string; hasPrepay?: boolean; hasFull?: boolean; hasCommission?: boolean; hasNpd?: boolean }>> = {};
          const chunk = 128;
          for (let i = 0; i < saleFiles.length; i += chunk) {
            const slice = saleFiles.slice(i, i + chunk);
            const results = await Promise.allSettled(slice.map(async (p) => {
              try {
                const raw = await readText(p);
                if (!raw) return { ok: false };
                const s = JSON.parse(raw) as any;
                const parts = p.split('/');
                const inn = (parts.length >= 4 ? parts[2] : (s.orgInn || 'unknown')).replace(/\D/g,'') || 'unknown';
                const row = {
                  taskId: s.taskId,
                  orderId: s.orderId,
                  userId: s.userId,
                  createdAt: s.createdAt,
                  updatedAt: s.updatedAt || s.createdAt,
                  status: s.status ?? null,
                  orgInn: inn,
                  hasPrepay: Boolean(s.ofdUrl),
                  hasFull: Boolean(s.ofdFullUrl),
                  hasCommission: Boolean(s.additionalCommissionOfdUrl),
                  hasNpd: Boolean(s.npdReceiptUri),
                };
                (byInn[inn] ||= []).push(row);
                try { await writeText(`.data/sales_index/by_task/${String(s.taskId)}.json`, JSON.stringify({ inn, userId: s.userId }, null, 2)); } catch {}
                return { ok: true };
              } catch { return { ok: false }; }
            }));
            for (const r of results) { if (r.status === 'fulfilled' && (r.value as any)?.ok) processed += 1; else errors += 1; }
            await writeStatus({ running: true, processed, errors });
          }
          // write org indexes in batches
          for (const [inn, rows] of Object.entries(byInn)) {
            rows.sort((a,b)=> (a.createdAt < b.createdAt ? 1 : -1));
            try { await writeText(`.data/sales/${inn}/index.json`, JSON.stringify(rows, null, 2)); } catch { errors += 1; }
          }
        } catch { /* ignore */ }
        await writeStatus({ running: false, processed, errors, finishedAt: new Date().toISOString() });
      };
      if (asyncMode) {
        setTimeout(() => { void run(); }, 0);
        return NextResponse.json({ ok: true, started: true }, { status: 202 });
      }
      await run();
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'LOAD_ERROR' }, { status: 500 });
  }
  try { await appendAdminEntityLog('sale', ['rebuild-indexes'], { source: 'manual', message: 'rebuild', data: { processed, errors, by: username } }); } catch {}
  return NextResponse.json({ ok: true, processed, errors });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }


