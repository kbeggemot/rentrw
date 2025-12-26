import { NextResponse } from 'next/server';
import { getInstanceId } from '@/server/leaderLease';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    method: 'GET',
    now: new Date().toISOString(),
    instanceId: getInstanceId(),
    hostname: process.env.HOSTNAME || null,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
  });
}

export async function POST(req: Request) {
  let bytes = 0;
  try {
    const txt = await req.text();
    bytes = Buffer.byteLength(txt || '', 'utf8');
  } catch {}
  return NextResponse.json({
    ok: true,
    method: 'POST',
    now: new Date().toISOString(),
    instanceId: getInstanceId(),
    hostname: process.env.HOSTNAME || null,
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    bytes,
  });
}


