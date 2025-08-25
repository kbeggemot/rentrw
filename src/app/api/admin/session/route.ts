import { NextResponse } from 'next/server';
import { ensureRootAdmin, validateAdmin } from '@/server/adminStore';

export const runtime = 'nodejs';

function setCookie(res: NextResponse, name: string, value: string, opts?: { maxAge?: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts?.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.headers.append('Set-Cookie', parts.join('; '));
}

export async function POST(req: Request) {
  try {
    await ensureRootAdmin();
    const body = await req.json().catch(() => ({} as any));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    const u = await validateAdmin(username, password);
    if (!u) return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
    const res = NextResponse.json({ ok: true });
    setCookie(res, 'admin_user', username, { maxAge: 60 * 60 * 12 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', 'admin_user=; Path=/; Max-Age=0; SameSite=Lax');
  return res;
}


