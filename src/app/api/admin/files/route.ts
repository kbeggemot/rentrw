import { NextResponse } from 'next/server';
import { list, readText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const name = url.searchParams.get('name');
  if (!name) {
    // list files in .data
    const files = await list('');
    // include common logs only
    const pick = files.filter((f)=> f.startsWith('.data/') && (f.endsWith('.log') || f.endsWith('.json'))).map((f)=> f.replace(/^\.data\//,''));
    // Add friendly known files
    const set = Array.from(new Set([...pick, 'postbacks.log']));
    return NextResponse.json({ files: set });
  }
  const content = await readText(`.data/${name}`);
  return new NextResponse(content || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
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
    const name = (url.searchParams.get('name') || '').replace(/\.\.+/g,'').replace(/[^a-zA-Z0-9_\-\.]/g,'');
    if (!name) {
      // list files in .data
      const dir = path.join(process.cwd(), '.data');
      let entries: string[] = [];
      try { entries = await fs.readdir(dir); } catch {}
      return NextResponse.json({ files: entries });
    }
    const txt = await readText(path.join('.data', name));
    const res = new NextResponse(txt || '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


