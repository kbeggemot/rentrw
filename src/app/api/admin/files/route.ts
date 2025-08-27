import { NextResponse } from 'next/server';
import { readText, list } from '@/server/storage';
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
    // List files from storage (supports S3)
    let files: string[] = [];
    try { files = await list('.data'); } catch {}
    const entries = files
      .filter((f) => f.endsWith('.log') || f.endsWith('.json'))
      .map((f) => f.replace(/^\.?data\/?/, ''))
      .map((f) => f.replace(/^\.data\//, ''));
    const set = Array.from(new Set([...entries, 'postbacks.log']));
    return NextResponse.json({ files: set });
  }
  const content = await readText(path.join('.data', name));
  return new NextResponse(content || '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
