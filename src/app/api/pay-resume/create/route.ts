import { NextResponse } from 'next/server';
import { createResumeToken } from '@/server/payResumeStore';

export const runtime = 'nodejs';

async function getUserId(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const fromCookie = m ? decodeURIComponent(m[1]) : undefined;
  return (fromCookie || req.headers.get('x-user-id') || null) as string | null;
}

export async function POST(req: Request) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    let orderId: number | null = null;
    try {
      const url = new URL(req.url);
      const q = url.searchParams.get('order');
      if (q) orderId = Number(q);
    } catch {}
    if (orderId == null) {
      try { const body = await req.json(); const v = (body?.order as any); if (typeof v === 'number' || typeof v === 'string') orderId = Number(v); } catch {}
    }
    if (orderId == null || !Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });
    const sid = await createResumeToken(userId, Number(orderId));
    return NextResponse.json({ ok: true, sid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // allow simple GET usage too
  return POST(req);
}


