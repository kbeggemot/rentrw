import { listAllSales, updateSaleFromStatus } from './taskStore';
import { getDecryptedApiToken } from './secureStore';
import { fetchTextWithTimeout } from './http';
import { ensureLeaderLease } from './leaderLease';

let started = false;
let timer: NodeJS.Timer | null = null;
let running = false;

export function startSalesRefreshWorker(): void {
  if (started) return;
  started = true;
  // Kick immediately once on boot (will noop except at 12:05 MSK)
  const runSafe = async () => {
    if (running) return;
    running = true;
    try { await runIf1205(); } catch {} finally { running = false; }
  };
  runSafe().catch(() => void 0);
  timer = setInterval(() => { runSafe().catch(() => void 0); }, 60 * 1000);
}

async function runIf1205(): Promise<void> {
  // Multi-instance safety: only one replica should run refresh at the scheduled minute.
  try {
    const ok = await ensureLeaderLease('salesRefreshWorker', 90_000);
    if (!ok) return;
  } catch {}
  const nowMsk = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
  // nowMsk like: DD.MM.YYYY, HH:MM:SS — extract HH:MM
  const m = /\b(\d{2}):(\d{2}):\d{2}\b/.exec(nowMsk);
  const hh = m ? m[1] : '';
  const mm = m ? m[2] : '';
  if (!(hh === '12' && mm === '05')) return;
  await refreshAllSales();
}

export async function refreshAllSales(): Promise<void> {
  const sales = await listAllSales();
  // Group by userId for token reuse
  const byUser = new Map<string, typeof sales>();
  for (const s of sales) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, [] as any);
    (byUser.get(s.userId) as any).push(s);
  }
  const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
  for (const [userId, rows] of byUser) {
    const token = await getDecryptedApiToken(userId);
    if (!token) continue;
    for (const s of rows) {
      try {
        const url = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
        const out = await fetchTextWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
        const res = out.res;
        const text = out.text;
        let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        const t = (data && typeof data === 'object' && 'task' in data) ? (data.task as any) : data;
        const ofd = t?.ofd_url ?? t?.acquiring_order?.ofd_url ?? null;
        const add = t?.additional_commission_ofd_url ?? null;
        const npd = t?.receipt_uri ?? null;
        await updateSaleFromStatus(userId, s.taskId, { status: t?.acquiring_order?.status, ofdUrl: ofd || undefined, additionalCommissionOfdUrl: add || undefined, npdReceiptUri: npd || undefined, rootStatus: (t?.status as any) } as any);
      } catch {}
    }
  }
}


