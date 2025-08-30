import { NextResponse } from 'next/server';
import { getSelectedOrgInn } from '@/server/orgContext';
import { findProductById } from '@/server/productsStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const orgInn = getSelectedOrgInn(req);
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const id = decodeURIComponent(segs[segs.length - 1] || '');
    const item = await findProductById(id, orgInn);
    if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}


