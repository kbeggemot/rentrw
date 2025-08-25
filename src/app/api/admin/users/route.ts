import { NextResponse } from 'next/server';
import { addAdmin, deleteAdmin, listAdmins, setAdminPassword, ensureRootAdmin, getAdminByUsername } from '@/server/adminStore';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function currentRole(req: Request): Promise<'superadmin' | 'admin' | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  if (!m) return null;
  const u = await getAdminByUsername(decodeURIComponent(m[1]));
  return u?.role || null;
}

export async function GET(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    await ensureRootAdmin();
    const users = await listAdmins();
    const role = await currentRole(req);
    return NextResponse.json({ users, role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    if ((await currentRole(req)) !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const body = await req.json().catch(() => ({} as any));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    const role = (body?.role === 'superadmin' ? 'superadmin' : 'admin') as 'superadmin' | 'admin';
    if (!username || !password) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    await addAdmin(username, password, role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    if ((await currentRole(req)) !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const body = await req.json().catch(() => ({} as any));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();
    if (!username || !password) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    await setAdminPassword(username, password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    if ((await currentRole(req)) !== 'superadmin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const url = new URL(req.url);
    const username = url.searchParams.get('username');
    if (!username) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    await deleteAdmin(username);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


