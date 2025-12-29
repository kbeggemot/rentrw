import { NextResponse } from 'next/server';
import { startWatchdog } from '@/server/watchdog';
import { getBuildId } from '@/server/buildInfo';

export const runtime = 'nodejs';

export async function GET() {
  try {
    try { startWatchdog(); } catch {}
    const buildId = await getBuildId().catch(() => null);
    const g = globalThis as any as {
      __rwTasksTrace?: { active: Record<string, any>; done: any[] };
    };
    const hub = g.__rwTasksTrace || { active: {}, done: [] };
    const active = Object.values(hub.active || {}).map((t: any) => ({
      id: t.id,
      startedAt: t.startedAt,
      instanceId: t.instanceId,
      lastStep: t.lastStep,
      msTotal: t.msTotal,
      marks: Array.isArray(t.marks) ? t.marks.slice(-15) : [],
      notes: t.notes || {},
      error: t.error || null,
      done: Boolean(t.done),
    }));
    const done = (hub.done || []).slice(0, 20).map((t: any) => ({
      id: t.id,
      startedAt: t.startedAt,
      instanceId: t.instanceId,
      lastStep: t.lastStep,
      msTotal: t.msTotal,
      marks: Array.isArray(t.marks) ? t.marks.slice(-15) : [],
      notes: t.notes || {},
      error: t.error || null,
      done: Boolean(t.done),
    }));
    const res = NextResponse.json({
      now: new Date().toISOString(),
      buildId,
      pid: typeof process !== 'undefined' ? process.pid : null,
      uptimeSec: typeof process !== 'undefined' ? Math.floor(process.uptime()) : null,
      hostname: (() => { try { return process.env.HOSTNAME || null; } catch { return null; } })(),
      node: (() => { try { return process.version || null; } catch { return null; } })(),
      active,
      done,
    }, { status: 200 });
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    try { if (buildId) res.headers.set('X-Build-Id', String(buildId)); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


