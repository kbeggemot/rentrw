import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function GET(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ofd';
    if (type === 'ofd') {
      const txt = await readText('.data/ofd_audit.log');
      return new NextResponse(txt || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


