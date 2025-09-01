import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';
import { promises as fs } from 'fs';
import path from 'path';

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
    if (type === 's3') {
      // ВАЖНО: лог s3_io.log всегда пишется на локальный FS, даже когда S3_ENABLED=1.
      // Поэтому читаем напрямую с диска, а не через storage.readText (который уходит в S3).
      try {
        const abs = path.join(process.cwd(), '.data', 's3_io.log');
        const buf = await fs.readFile(abs, 'utf8').catch(() => '');
        return new NextResponse(buf || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } catch {
        return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }
    return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


