import { NextResponse } from 'next/server';
import { getInstanceId } from '@/server/leaderLease';
import { getWatchdogStatus, startWatchdog } from '@/server/watchdog';
import { getBuildId } from '@/server/buildInfo';
import { performance } from 'perf_hooks';
import { promises as fs } from 'fs';

export const runtime = 'nodejs';

function safeNumber(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

async function fdCount(): Promise<number | null> {
  // Linux-only (most prod containers)
  try {
    const list = await fs.readdir('/proc/self/fd');
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    try { startWatchdog(); } catch {}
    const buildId = await getBuildId().catch(() => null);
    const mem = process.memoryUsage();
    const elu = performance.eventLoopUtilization();
    const handles = (() => {
      try { return (process as any)._getActiveHandles?.() as any[]; } catch { return null; }
    })();
    const handleTypes = (() => {
      if (!Array.isArray(handles)) return null;
      const out: Record<string, number> = {};
      for (const h of handles) {
        const name = (h && (h.constructor?.name || typeof h)) ? String(h.constructor?.name || typeof h) : 'unknown';
        out[name] = (out[name] || 0) + 1;
      }
      return out;
    })();

    const res = NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      buildId,
      instanceId: getInstanceId(),
      hostname: process.env.HOSTNAME || null,
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      node: process.version,
      s3Enabled: (process.env.S3_ENABLED || '0') === '1',
      watchdog: (() => { try { return getWatchdogStatus(); } catch { return null; } })(),
      mem: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: (mem as any).arrayBuffers,
      },
      eventLoop: {
        utilization: {
          active: safeNumber((elu as any).active),
          idle: safeNumber((elu as any).idle),
          utilization: safeNumber((elu as any).utilization),
        },
      },
      handles: {
        count: Array.isArray(handles) ? handles.length : null,
        types: handleTypes,
      },
      fds: {
        count: await fdCount(),
      },
    }, { status: 200 });

    // Debug helpers:
    // - Always disable caching
    // - Optionally force connection close to encourage new TCP connections (helps diagnose LB/backends)
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    try { res.headers.set('X-Instance-Id', getInstanceId()); } catch {}
    try { if (buildId) res.headers.set('X-Build-Id', String(buildId)); } catch {}
    try {
      const url = new URL(req.url);
      const close = url.searchParams.get('close');
      if (close === '1') res.headers.set('Connection', 'close');
    } catch {}

    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


