import { promises as fs } from 'fs';
import path from 'path';
import { getDecryptedApiToken } from './secureStore';
import { discardResponseBody, fetchWithTimeout } from './http';
import { ensureLeaderLease } from './leaderLease';

const DATA_DIR = path.join(process.cwd(), '.data');
const JOBS_FILE = path.join(DATA_DIR, 'subscription_jobs.json');

type Job = {
  id: string; // `${userId}`
  userId: string;
  callbackBase: string; // e.g. https://ypla.ru
  createdAt: string; // ISO
  attempts: number;
  nextRunAt: string; // ISO
  lastError?: string;
};

type JobsStore = { jobs: Job[] };

async function readJobs(): Promise<JobsStore> {
  try {
    const raw = await fs.readFile(JOBS_FILE, 'utf8');
    const data = JSON.parse(raw) as Partial<JobsStore>;
    return { jobs: Array.isArray(data.jobs) ? data.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

async function writeJobs(store: JobsStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(JOBS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function backoffDelayMs(attempt: number): number {
  // Exponential backoff with cap: 1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 24h, 48h
  const steps = [60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 60 * 60e3, 3 * 60 * 60e3, 6 * 60 * 60e3, 12 * 60 * 60e3, 24 * 60 * 60e3, 48 * 60 * 60e3];
  return steps[Math.min(attempt, steps.length - 1)];
}

export async function enqueueSubscriptionJob(userId: string, callbackBase: string): Promise<void> {
  const store = await readJobs();
  const id = userId;
  const now = new Date();
  const idx = store.jobs.findIndex((j) => j.id === id);
  const job: Job = idx !== -1 ? { ...store.jobs[idx] } : {
    id,
    userId,
    callbackBase,
    createdAt: now.toISOString(),
    attempts: 0,
    nextRunAt: new Date(now.getTime() + 60e3).toISOString(), // first retry in 1m
  };
  job.callbackBase = callbackBase; // update callback if changed
  store.jobs[idx !== -1 ? idx : store.jobs.length] = job;
  await writeJobs(store);
}

async function upsert(stream: 'tasks' | 'executors', token: string, base: string, callbackUrl: string): Promise<boolean> {
  // Check existing first, try both endpoints (compat differences)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>;
  async function list(pathname: string) {
    const url = new URL(pathname, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetchWithTimeout(url, { method: 'GET', headers, cache: 'no-store' }, 15_000);
    const txt = await res.text();
    let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    return { ok: res.ok, data } as const;
  }
  try {
    for (const path of ['postback_subscriptions', 'postbacks']) {
      try {
        const out = await list(path);
        if (out.ok) {
          const arr = Array.isArray((out.data as any)?.subscriptions) ? (out.data as any).subscriptions : (Array.isArray((out.data as any)?.postbacks) ? (out.data as any).postbacks : []);
          const exists = Array.isArray(arr) && arr.some((p: any) => {
            const subs = Array.isArray(p?.subscribed_on) ? p.subscribed_on.map((x: any) => String(x)) : [];
            const uri = String(p?.callback_url ?? p?.uri ?? '');
            return subs.includes(stream) && uri === callbackUrl;
          });
          if (exists) return true;
        }
      } catch {}
    }
    // Create; try both endpoints
    for (const path of ['postback_subscriptions', 'postbacks']) {
      try {
        const url = new URL(path, base.endsWith('/') ? base : base + '/').toString();
        // v2 expects: http_method, uri, subscribed_on
        const payload = { http_method: 'post', uri: callbackUrl, subscribed_on: [stream] } as any;
        const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store' }, 15_000);
        // IMPORTANT: drain body to avoid undici socket leaks
        await discardResponseBody(res);
        if (res.ok) return true;
      } catch {}
    }
  } catch {}
  return false;
}

export async function ensureSubscriptions(userId: string, callbackBase: string): Promise<boolean> {
  const token = await getDecryptedApiToken(userId);
  if (!token) return false;
  const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
  const callbackUrl = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
  const ok1 = await upsert('tasks', token, base, callbackUrl);
  const ok2 = await upsert('executors', token, base, callbackUrl);
  return ok1 && ok2;
}

let started = false;
let timer: NodeJS.Timer | null = null;
let running = false;

export function startSubscriptionWorker(): void {
  if (started) return;
  started = true;
  const runSafe = async () => {
    if (running) return;
    running = true;
    try { await runDueSubscriptionJobs(); } catch {} finally { running = false; }
  };
  timer = setInterval(() => {
    runSafe().catch(() => void 0);
  }, 30 * 1000);
}

export async function runDueSubscriptionJobs(): Promise<void> {
  // Multi-instance safety: only one replica should run this background worker.
  try {
    const ok = await ensureLeaderLease('subscriptionWorker', 90_000);
    if (!ok) return;
  } catch {}
  const store = await readJobs();
  const now = new Date();
  const nextJobs: Job[] = [];
  for (const job of store.jobs) {
    const due = new Date(job.nextRunAt).getTime() <= now.getTime();
    const ageMs = now.getTime() - new Date(job.createdAt).getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (!due) { nextJobs.push(job); continue; }
    if (ageMs > weekMs) {
      // drop job after a week
      continue;
    }
    const ok = await ensureSubscriptions(job.userId, job.callbackBase).catch(() => false);
    if (!ok) {
      const attempts = (job.attempts || 0) + 1;
      const delay = backoffDelayMs(attempts);
      nextJobs.push({ ...job, attempts, nextRunAt: new Date(now.getTime() + delay).toISOString() });
    }
  }
  await writeJobs({ jobs: nextJobs });
}


