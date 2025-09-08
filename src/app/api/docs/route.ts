import { NextResponse } from 'next/server';
import { listDocsInUse, savePdfForUser } from '@/server/docsStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const items = await listDocsInUse(userId);
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const ct = req.headers.get('content-type') || '';
    if (!ct.startsWith('application/pdf')) return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
    const ab = await req.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.byteLength > 5 * 1024 * 1024) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 400 });
    // Try to read original filename from header (URL-encoded)
    const rawName = req.headers.get('x-file-name');
    let fileName: string | null = null;
    if (typeof rawName === 'string' && rawName.length > 0) {
      try { fileName = decodeURIComponent(rawName); } catch { fileName = rawName; }
      // keep only basename
      fileName = fileName.split('\\').pop()?.split('/').pop() || fileName;
    }
    const meta = await savePdfForUser(userId, fileName, buf);
    return NextResponse.json({ ok: true, item: meta });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


