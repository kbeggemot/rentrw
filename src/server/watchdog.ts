import { ensureLeaderLease, getInstanceId } from './leaderLease';
import { readText, writeText } from './storage';
import { discardResponseBody, fetchWithTimeout } from './http';
import { promises as fs } from 'fs';

let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

type State = { firstNotLeaderAt?: number | null; consecutiveFailures: number };
const state: State = { firstNotLeaderAt: null, consecutiveFailures: 0 };

type PublicStatus = {
  enabled: boolean;
  started: boolean;
  instanceId: string;
  startedAt: string | null;
  lastTickAt: string | null;
  lastOkAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastChecks: {
    s3Ok: boolean | null;
    rwOk: boolean | null;
    fdOk: boolean | null;
    handlesOk: boolean | null;
    fdCount: number | null;
    handlesCount: number | null;
  };
};

type GlobalBag = typeof globalThis & { __rentrw_watchdog?: PublicStatus };
const g = globalThis as GlobalBag;

function setStatus(patch: Partial<PublicStatus>) {
  const base: PublicStatus = g.__rentrw_watchdog || {
    enabled: isEnabled(),
    started: false,
    instanceId: getInstanceId(),
    startedAt: null,
    lastTickAt: null,
    lastOkAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastChecks: { s3Ok: null, rwOk: null, fdOk: null, handlesOk: null, fdCount: null, handlesCount: null },
  };
  g.__rentrw_watchdog = { ...base, ...patch };
}

export function getWatchdogStatus(): PublicStatus {
  return g.__rentrw_watchdog || {
    enabled: isEnabled(),
    started,
    instanceId: getInstanceId(),
    startedAt: null,
    lastTickAt: null,
    lastOkAt: null,
    consecutiveFailures: state.consecutiveFailures,
    lastError: null,
    lastChecks: { s3Ok: null, rwOk: null, fdOk: null, handlesOk: null, fdCount: null, handlesCount: null },
  };
}

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
  setStatus({ enabled: isEnabled(), started: true, instanceId: getInstanceId(), startedAt: new Date().toISOString() });
  if (!isEnabled()) return;

  const intervalMs = ms('WATCHDOG_INTERVAL_MS', 30_000);
  const leaseTtlMs = ms('WATCHDOG_LEASE_TTL_MS', 45_000);
  const notLeaderExitAfterMs = ms('WATCHDOG_NOT_LEADER_EXIT_AFTER_MS', 90_000);
  const maxFailures = ms('WATCHDOG_MAX_FAILURES', 3);
  const egressTimeoutMs = 8_000;
  const maxFds = ms('WATCHDOG_MAX_FDS', 0);
  const maxHandles = ms('WATCHDOG_MAX_HANDLES', 0);

  const tick = async () => {
    if (running) return;
    running = true;
    let s3Ok: boolean | null = null;
    let rwOk: boolean | null = null;
    let fdOk: boolean | null = null;
    let handlesOk: boolean | null = null;
    let fdCount: number | null = null;
    let handlesCount: number | null = null;
    let lastErr: string | null = null;
    setStatus({ lastTickAt: new Date().toISOString(), consecutiveFailures: state.consecutiveFailures });
    // Only meaningful in S3/multi-instance mode
    const s3 = (process.env.S3_ENABLED || '0') === '1';
    // Still useful even without S3: detect dead egress to RocketWork and restart.

    // 1) Leader lease (shared across API routes)
    let isLeader = false;
    try {
      if (s3) isLeader = await ensureLeaderLease('apiLeader', leaseTtlMs);
    } catch {
      isLeader = false;
    }

    if (s3 && !isLeader) {
      if (!state.firstNotLeaderAt) state.firstNotLeaderAt = Date.now();
      if (enforceSingleton() && (Date.now() - Number(state.firstNotLeaderAt || 0)) > notLeaderExitAfterMs) {
        // Exit gracefully; platform should restart and LB should remove dead replica.
        try { process.exit(0); } catch {}
      }
    } else {
      state.firstNotLeaderAt = null;
    }

    let ok = true;

    // 2) Storage liveness ping (best-effort) — only when S3 is enabled
    try {
      if (s3) {
        const key = '.data/watchdog_ping.json';
        const payload = JSON.stringify({ ts: new Date().toISOString(), instanceId: getInstanceId() });
        // Best-effort write; should be small and bounded by S3_PUT_TIMEOUT_MS
        await writeText(key, payload);
        // Best-effort read; should be bounded by S3_GET_TIMEOUT_MS
        await readText(key);
        s3Ok = true;
      } else {
        s3Ok = null;
      }
    } catch {
      ok = false;
      s3Ok = false;
    }

    // 3) Egress liveness ping (RocketWork base) — detects half-dead instances where external calls hang
    try {
      const base = (process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/').trim();
      const baseNorm = base.endsWith('/') ? base : base + '/';
      // `account` should respond fast (401 is OK); we only care that the network path works.
      const url = new URL('account', baseNorm).toString();
      const res = await fetchWithTimeout(url, { cache: 'no-store', headers: { Accept: 'application/json' } }, egressTimeoutMs);
      await discardResponseBody(res, egressTimeoutMs);
      rwOk = true;
    } catch {
      ok = false;
      rwOk = false;
    }

    // 4) Local resource leak detection (best-effort): file descriptors & active handles
    try {
      // Linux-only; returns null on non-Linux/dev
      const list = await fs.readdir('/proc/self/fd').catch(() => null as any);
      fdCount = Array.isArray(list) ? list.length : null;
    } catch {
      fdCount = null;
    }
    try {
      const handles = (() => { try { return (process as any)._getActiveHandles?.() as any[]; } catch { return null; } })();
      handlesCount = Array.isArray(handles) ? handles.length : null;
    } catch {
      handlesCount = null;
    }
    if (maxFds > 0 && fdCount != null) {
      fdOk = fdCount <= maxFds;
      if (!fdOk) ok = false;
    } else {
      fdOk = null;
    }
    if (maxHandles > 0 && handlesCount != null) {
      handlesOk = handlesCount <= maxHandles;
      if (!handlesOk) ok = false;
    } else {
      handlesOk = null;
    }

    if (ok) state.consecutiveFailures = 0;
    else state.consecutiveFailures += 1;
    try { setStatus({ consecutiveFailures: state.consecutiveFailures }); } catch {}
    if (state.consecutiveFailures >= maxFailures) {
      // Something is very wrong (storage and/or egress); restarting is safer than serving half-dead.
      try { process.exit(1); } catch {}
    }
    if (ok) {
      setStatus({ lastOkAt: new Date().toISOString(), lastError: null, lastChecks: { s3Ok, rwOk, fdOk, handlesOk, fdCount, handlesCount } });
    } else {
      lastErr = `WATCHDOG_FAIL s3Ok=${String(s3Ok)} rwOk=${String(rwOk)} fdOk=${String(fdOk)} handlesOk=${String(handlesOk)} fdCount=${String(fdCount)} handlesCount=${String(handlesCount)}`;
      setStatus({ lastError: lastErr, lastChecks: { s3Ok, rwOk, fdOk, handlesOk, fdCount, handlesCount } });
    }
  };

  // Kick once
  void tick().catch(() => void 0).finally(() => { running = false; });
  timer = setInterval(() => {
    void tick().catch(() => void 0).finally(() => { running = false; });
  }, intervalMs);
}

export function stopWatchdog(): void {
  try { if (timer) clearInterval(timer); } catch {}
  timer = null;
}


