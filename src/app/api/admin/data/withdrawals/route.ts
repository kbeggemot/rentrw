import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const raw = await readText('.data/withdrawals.json');
  const d = raw ? JSON.parse(raw) : { items: [] };
  const items = Array.isArray(d?.items) ? d.items : [];
  return NextResponse.json({ items });
}


