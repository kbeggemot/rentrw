import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const g = globalThis as any as {
      __partnerValidateTrace?: { active: Record<string, any>; done: any[] };
    };
    const hub = g.__partnerValidateTrace || { active: {}, done: [] };
    const active = Object.values(hub.active || {}).map((t: any) => ({
      id: t.id,
      startedAt: t.startedAt,
      lastStep: t.lastStep,
      msTotal: t.msTotal,
      marks: Array.isArray(t.marks) ? t.marks.slice(-12) : [],
      notes: t.notes || {},
      error: t.error || null,
      done: Boolean(t.done),
    }));
    const done = (hub.done || []).slice(0, 20).map((t: any) => ({
      id: t.id,
      startedAt: t.startedAt,
      lastStep: t.lastStep,
      msTotal: t.msTotal,
      marks: Array.isArray(t.marks) ? t.marks.slice(-12) : [],
      notes: t.notes || {},
      error: t.error || null,
      done: Boolean(t.done),
    }));
    const meta = {
      now: new Date().toISOString(),
      pid: typeof process !== 'undefined' ? process.pid : null,
      uptimeSec: typeof process !== 'undefined' ? Math.floor(process.uptime()) : null,
      hostname: (() => { try { return (process as any)?.env?.HOSTNAME || null; } catch { return null; } })(),
      node: (() => { try { return (process as any)?.version || null; } catch { return null; } })(),
    };
    return NextResponse.json({ ...meta, active, done }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


