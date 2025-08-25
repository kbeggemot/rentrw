import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const admin = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!admin || admin.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const body = await req.json().catch(()=>({} as any));
    const userId = String(body?.userId || '').trim();
    const phone = String(body?.phone || '').trim();
    if (!userId || !phone) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const { getDecryptedApiToken } = await import('@/server/secureStore');
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
    const digits = phone.replace(/\D/g,'');
    const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    const t = await r.text();
    let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return NextResponse.json({ ok: r.ok, status: r.status, body: d });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


