import { ensureLeaderLease, getInstanceId } from './leaderLease';
import { readText, writeText } from './storage';

let started = false;
let timer: NodeJS.Timeout | null = null;

type State = { firstNotLeaderAt?: number | null; consecutiveFailures: number };
const state: State = { firstNotLeaderAt: null, consecutiveFailures: 0 };

function isEnabled(): boolean {
  return (process.env.WATCHDOG_ENABLED || '0') === '1';
}

function enforceSingleton(): boolean {
  return (process.env.ENFORCE_SINGLETON || '0') === '1';
}

function ms(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function startWatchdog(): void {
  if (started) return;
  started = true;
  if (!isEnabled()) return;

  const intervalMs = ms('WATCHDOG_INTERVAL_MS', 30_000);
  const leaseTtlMs = ms('WATCHDOG_LEASE_TTL_MS', 45_000);
  const notLeaderExitAfterMs = ms('WATCHDOG_NOT_LEADER_EXIT_AFTER_MS', 90_000);
  const maxFailures = ms('WATCHDOG_MAX_FAILURES', 3);

  const tick = async () => {
    // Only meaningful in S3/multi-instance mode
    const s3 = (process.env.S3_ENABLED || '0') === '1';
    if (!s3) return;

    // 1) Leader lease (shared across API routes)
    let isLeader = false;
    try {
      isLeader = await ensureLeaderLease('apiLeader', leaseTtlMs);
    } catch {
      isLeader = false;
    }

    if (!isLeader) {
      if (!state.firstNotLeaderAt) state.firstNotLeaderAt = Date.now();
      if (enforceSingleton() && (Date.now() - Number(state.firstNotLeaderAt || 0)) > notLeaderExitAfterMs) {
        // Exit gracefully; platform should restart and LB should remove dead replica.
        try { process.exit(0); } catch {}
      }
    } else {
      state.firstNotLeaderAt = null;
    }

    // 2) Storage liveness ping (best-effort)
    try {
      const key = '.data/watchdog_ping.json';
      const payload = JSON.stringify({ ts: new Date().toISOString(), instanceId: getInstanceId() });
      // Best-effort write; should be small and bounded by S3_PUT_TIMEOUT_MS
      await writeText(key, payload);
      // Best-effort read; should be bounded by S3_GET_TIMEOUT_MS
      await readText(key);
      state.consecutiveFailures = 0;
    } catch {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= maxFailures) {
        // Something is very wrong with storage; restarting is safer than serving half-dead.
        try { process.exit(1); } catch {}
      }
    }
  };

  // Kick once
  void tick().catch(() => void 0);
  timer = setInterval(() => { void tick().catch(() => void 0); }, intervalMs);
}

export function stopWatchdog(): void {
  try { if (timer) clearInterval(timer); } catch {}
  timer = null;
}


