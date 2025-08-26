import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';
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
    // List files from local .data directory (S3 listing not supported here)
    const dir = path.join(process.cwd(), '.data');
    let entries: string[] = [];
    try {
      const all = await fs.readdir(dir);
      entries = all.filter((f) => f.endsWith('.log') || f.endsWith('.json'));
    } catch {}
    // Add friendly known file if present in S3 or FS consumers
    const set = Array.from(new Set([...entries, 'postbacks.log']));
    return NextResponse.json({ files: set });
  }
  const content = await readText(path.join('.data', name));
  return new NextResponse(content || '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
