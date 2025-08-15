import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const file = path.join(process.cwd(), '.data', 'webauthn_creds.json');
    const raw = await fs.readFile(file, 'utf8').catch(() => '{}');
    const data = JSON.parse(raw || '{}');
    const hasAny = Array.isArray(data?.[userId]) && data[userId].length > 0;
    return NextResponse.json({ hasAny });
  } catch {
    return NextResponse.json({ hasAny: false });
  }
}


