import { NextResponse } from 'next/server';
import { upsertOfdReceipt } from '@/server/ofdStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    // Optional shared-secret validation
    const reqUrl = new URL(req.url);
    const secret = reqUrl.searchParams.get('secret') || req.headers.get('x-ofd-signature') || '';
    const expected = process.env.OFD_CALLBACK_SECRET || '';
    if (expected && secret !== expected) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const userId = getUserId(req) || 'default';
    const text = await req.text();
    let body: any = null; try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    // Expect ReceiptId and links in callback (adjust to actual schema if differs)
    const receiptId: string | undefined = body?.Data?.ReceiptId || body?.ReceiptId || body?.id;
    const fn: string | undefined = body?.Data?.Fn || body?.Fn;
    const fd: string | number | undefined = body?.Data?.Fd || body?.Fd;
    const fp: string | number | undefined = body?.Data?.Fp || body?.Fp;
    // Build demo link pattern if parts are known
    let receiptUrl: string | undefined;
    if (fn && fd != null && fp != null) {
      receiptUrl = `https://check-demo.ofd.ru/rec/${encodeURIComponent(fn)}/${encodeURIComponent(String(fd))}/${encodeURIComponent(String(fp))}`;
    }
    if (receiptId) {
      await upsertOfdReceipt({ userId, receiptId, fn: fn ?? null, fd: fd ?? null, fp: fp ?? null, url: receiptUrl ?? null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: body });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


