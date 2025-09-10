import { NextResponse } from 'next/server';
// Fallback: dynamic import of helper to avoid hard compile dependency
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';
import { list, readText, writeText } from '@/server/storage';

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
  let processed = 0, errors = 0;
  try {
    const mod = await import('@/server/taskStore');
    const fn = (mod as any).rebuildSalesIndexesFromLegacy as (()=>Promise<{processed:number;errors:number}>) | undefined;
    if (typeof fn === 'function') {
      const res = await fn();
      processed = res?.processed ?? 0; errors = res?.errors ?? 0;
    } else {
      // Local fallback: rebuild by scanning sharded sales files
      try {
        const all = await list('.data/sales');
        const saleFiles = (all || []).filter((p) => /\.data\/sales\/[^/]+\/sales\/.+\.json$/.test(p));
        const byInn: Record<string, Array<{ taskId: string|number; orderId: string|number; userId: string; createdAt: string; updatedAt: string; status?: string|null; orgInn: string; hasPrepay?: boolean; hasFull?: boolean; hasCommission?: boolean; hasNpd?: boolean }>> = {};
        for (const p of saleFiles) {
          try {
            const raw = await readText(p);
            if (!raw) continue;
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
            // update by_task mapping
            try { await writeText(`.data/sales_index/by_task/${String(s.taskId)}.json`, JSON.stringify({ inn, userId: s.userId }, null, 2)); } catch {}
            processed += 1;
          } catch { errors += 1; }
        }
        // write org indexes
        for (const [inn, rows] of Object.entries(byInn)) {
          rows.sort((a,b)=> (a.createdAt < b.createdAt ? 1 : -1));
          try { await writeText(`.data/sales/${inn}/index.json`, JSON.stringify(rows, null, 2)); } catch { errors += 1; }
        }
      } catch { return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 501 }); }
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'LOAD_ERROR' }, { status: 500 });
  }
  try { await appendAdminEntityLog('sale', ['rebuild-indexes'], { source: 'manual', message: 'rebuild', data: { processed, errors, by: username } }); } catch {}
  return NextResponse.json({ ok: true, processed, errors });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }


