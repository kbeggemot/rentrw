import { NextResponse } from 'next/server';
import { getInstanceId } from '@/server/leaderLease';
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

export async function GET() {
  try {
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

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      instanceId: getInstanceId(),
      hostname: process.env.HOSTNAME || null,
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      node: process.version,
      s3Enabled: (process.env.S3_ENABLED || '0') === '1',
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


