import { NextResponse } from 'next/server';
import { readText, list, statFile, readRangeFile } from '@/server/storage';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const raw = url.searchParams.get('name') || '';
  const name = raw.replace(/\.+/g, '').replace(/[^a-zA-Z0-9_\-\.]/g, '');
  if (!name) {
    // List files from storage (supports S3). Fallback to local FS if listing is not permitted.
    let entries: string[] = [];
    try {
      const files = await list('.data');
      if (Array.isArray(files) && files.length > 0) {
        entries = files
          .filter((f) => f.endsWith('.log') || f.endsWith('.json'))
          .map((f) => f.replace(/^\.?data\/?/, ''))
          .map((f) => f.replace(/^\.data\//, ''));
      }
    } catch {}
    if (entries.length === 0) {
      try {
        const dir = path.join(process.cwd(), '.data');
        const all = await fs.readdir(dir);
        entries = all.filter((f) => f.endsWith('.log') || f.endsWith('.json'));
      } catch {}
    }
    const set = Array.from(new Set([...entries, 'postbacks.log']));
    return NextResponse.json({ files: set });
  }
  // Stream only last 512KB to avoid huge downloads by mistake
  const filePath = path.join('.data', name);
  const st = await statFile(filePath);
  const maxTail = 512 * 1024; // 512KB
  if (st && st.size > maxTail) {
    const start = st.size - maxTail;
    const end = st.size - 1;
    const tail = await readRangeFile(filePath, start, end);
    const header = `--- tail ${maxTail}B of ${st.size}B ---\n`;
    return new NextResponse((header + (tail || '')) || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const content = await readText(filePath);
  return new NextResponse(content || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
