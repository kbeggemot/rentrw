import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { listSales } from '@/server/taskStore';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function parsePayload(req: Request): Promise<{ userId: string; taskId: string }> {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    return {
      userId: String(url.searchParams.get('userId') || '').trim(),
      taskId: String(url.searchParams.get('taskId') || '').trim(),
    };
  }
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({} as any));
    return { userId: String(body?.userId || '').trim(), taskId: String(body?.taskId ?? '').trim() };
  }
  const fd = await req.formData().catch(() => null);
  return { userId: String(fd?.get('userId') || url.searchParams.get('userId') || '').trim(), taskId: String(fd?.get('taskId') || url.searchParams.get('taskId') || '').trim() };
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const { userId, taskId } = await parsePayload(req);
    if (!userId || !taskId) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const { getDecryptedApiToken } = await import('@/server/secureStore');
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
    const url = new URL(`tasks/${encodeURIComponent(String(taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: 'RW_ERROR', details: text }, { status: 502 });
    const out = NextResponse.json({ ok: true, details: text });
    try { out.headers.set('Cache-Control', 'no-store'); } catch {}
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(req.headers.get('cookie') || '');
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const { userId, taskId } = await parsePayload(req);
    if (!userId || !taskId) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    // Call RW pay endpoint directly
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const { getDecryptedApiToken } = await import('@/server/secureStore');
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
    const url = new URL(`tasks/${encodeURIComponent(String(taskId))}/pay`, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: 'RW_ERROR', details: text }, { status: 502 });
    return NextResponse.json({ ok: true, details: text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


