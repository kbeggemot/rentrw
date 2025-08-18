import { NextResponse } from 'next/server';
import { fermaGetReceiptStatus } from '@/server/ofdFerma';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const id = decodeURIComponent(segs[segs.length - 1] || '');
    if (!id) return NextResponse.json({ error: 'NO_ID' }, { status: 400 });
    const resp = await fermaGetReceiptStatus(id);
    return NextResponse.json(resp, { status: resp.rawStatus || 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


