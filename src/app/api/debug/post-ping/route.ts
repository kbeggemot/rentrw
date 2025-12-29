import { NextResponse } from 'next/server';
import { getInstanceId } from '@/server/leaderLease';
import { startWatchdog } from '@/server/watchdog';
import { getBuildId } from '@/server/buildInfo';

export const runtime = 'nodejs';

function baseResponse(method: string, buildId: string | null, req?: Request) {
  const res = NextResponse.json({
    ok: true,
    method,
    now: new Date().toISOString(),
    buildId,
    instanceId: getInstanceId(),
    hostname: process.env.HOSTNAME || null,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
  }, { status: 200 });

  try { res.headers.set('Cache-Control', 'no-store'); } catch {}
  try { res.headers.set('X-Instance-Id', getInstanceId()); } catch {}
  try { if (buildId) res.headers.set('X-Build-Id', String(buildId)); } catch {}
  try {
    if (req) {
      const url = new URL(req.url);
      if (url.searchParams.get('close') === '1') res.headers.set('Connection', 'close');
    }
  } catch {}

  return res;
}

export async function GET(req: Request) {
  try { startWatchdog(); } catch {}
  const buildId = await getBuildId().catch(() => null);
  return baseResponse('GET', buildId, req);
}

export async function POST(req: Request) {
  try { startWatchdog(); } catch {}
  const buildId = await getBuildId().catch(() => null);
  return baseResponse('POST', buildId, req);
}


