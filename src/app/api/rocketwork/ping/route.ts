import { NextResponse } from 'next/server';
import { getInstanceId } from '@/server/leaderLease';
import { startWatchdog } from '@/server/watchdog';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try { startWatchdog(); } catch {}
  const url = new URL(req.url);
  const res = NextResponse.json({
    ok: true,
    method: 'GET',
    now: new Date().toISOString(),
    instanceId: getInstanceId(),
    hostname: process.env.HOSTNAME || null,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
  });
  try { res.headers.set('Cache-Control', 'no-store'); } catch {}
  try { res.headers.set('X-Instance-Id', getInstanceId()); } catch {}
  try { if (url.searchParams.get('close') === '1') res.headers.set('Connection', 'close'); } catch {}
  return res;
}

export async function POST(req: Request) {
  try { startWatchdog(); } catch {}
  let bytes = 0;
  try {
    const txt = await req.text();
    bytes = Buffer.byteLength(txt || '', 'utf8');
  } catch {}
  const res = NextResponse.json({
    ok: true,
    method: 'POST',
    now: new Date().toISOString(),
    instanceId: getInstanceId(),
    hostname: process.env.HOSTNAME || null,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    bytes,
  });
  try { res.headers.set('Cache-Control', 'no-store'); } catch {}
  try { res.headers.set('X-Instance-Id', getInstanceId()); } catch {}
  return res;
}


