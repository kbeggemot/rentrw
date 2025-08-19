import { NextResponse } from 'next/server';
import { fermaGetReceiptStatus } from '@/server/ofdFerma';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const id = decodeURIComponent(segs[segs.length - 1] || '');
    if (!id) return NextResponse.json({ error: 'NO_ID' }, { status: 400 });
    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const login = process.env.FERMA_LOGIN || '';
    const password = process.env.FERMA_PASSWORD || '';
    const { fermaGetAuthTokenCached } = await import('@/server/ofdFerma');
    const token = await fermaGetAuthTokenCached(login, password, { baseUrl });
    const resp = await fermaGetReceiptStatus(id, { baseUrl, authToken: token });
    return NextResponse.json(resp, { status: resp.rawStatus || 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


