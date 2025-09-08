import { NextResponse } from 'next/server';
import { resolveDoc } from '@/server/docsStore';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ hash: string }> }) {
  try {
    const p = await ctx.params;
    const hash = String(p.hash || '');
    if (!/^[a-f0-9]{64}$/i.test(hash)) return NextResponse.json({ error: 'BAD_HASH' }, { status: 400 });
    const found = await resolveDoc(hash);
    if (!found) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return new NextResponse(found.buf as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(found.size), 'Content-Disposition': `inline; filename="${encodeURIComponent(found.name)}"` } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


