import { NextResponse } from 'next/server';
import { getAdminByUsername } from '@/server/adminStore';
import { getShowAllDataFlag, setShowAllDataFlag } from '@/server/userStore';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

async function isSuperAdmin(req: Request): Promise<boolean> {
  try {
    const cookie = req.headers.get('cookie') || '';
    const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
    const user = m ? await getAdminByUsername(decodeURIComponent(m[1])) : null;
    return !!user && user.role === 'superadmin';
  } catch { return false; }
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const url = new URL(req.url);
  const username = url.searchParams.get('username') || '';
  const userId = username;
  const showAll = await getShowAllDataFlag(userId).catch(()=>false);
  return NextResponse.json({ showAll });
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!(await isSuperAdmin(req))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = await req.json().catch(()=>({} as any));
  const username = String(body?.username || '').trim();
  const id = String(body?.id || username || '').trim();
  const showAll = Boolean(body?.showAll);
  if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const userId = id;
  try { await setShowAllDataFlag(userId, showAll); } catch {}
  return NextResponse.json({ ok: true, showAll });
}


