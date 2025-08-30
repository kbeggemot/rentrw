import { NextResponse } from 'next/server';
import { getSelectedOrgInn } from '@/server/orgContext';
import { findProductById } from '@/server/productsStore';
import { readBinary } from '@/server/storage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const orgInn = getSelectedOrgInn(req);
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const id = decodeURIComponent(segs[segs.length - 1] || '');
    // If query path is present -> serve file bytes of uploaded photo (proxy helper)
    const filePath = url.searchParams.get('path');
    if (filePath) {
      const safe = filePath.replace(/\.+/g, '.').replace(/^\/+/, '');
      const data = await readBinary(safe);
      if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      const body = new Uint8Array(data.data); // ensure BodyInit
      return new NextResponse(body as any, { headers: { 'Content-Type': data.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    const item = await findProductById(id, orgInn);
    if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}


