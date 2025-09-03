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
  const id = url.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  const showAll = await getShowAllDataFlag(id).catch(()=>false);
  return NextResponse.json({ showAll });
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!(await isSuperAdmin(req))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  // Support both JSON and form POSTs
  let id = '';
  let showAll = false;
  let back: string | null = null;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json().catch(()=>({} as any));
      id = String((body as any)?.id || '').trim();
      showAll = Boolean((body as any)?.showAll);
    } else {
      const fd = await req.formData();
      id = String(fd.get('id') || '').trim();
      const v = String(fd.get('showAll') || '');
      showAll = v === 'true' || v === '1' || v === 'on';
      back = String(fd.get('back') || '').trim() || null;
    }
  } catch {}
  if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
  try { await setShowAllDataFlag(id, showAll); } catch {}
  // Choose response type by Content-Type: forms => redirect with flash, JSON => JSON
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    const loc = back || `/admin/lk-users/${encodeURIComponent(id)}`;
    // Return lightweight HTML redirect to avoid history replacement issues in some browsers
    const res = NextResponse.redirect(new URL(loc, req.url), 303);
    try { res.headers.set('Set-Cookie', `flash=OK; Path=/; Max-Age=5; SameSite=Lax`); } catch {}
    return res;
  }
  return NextResponse.json({ ok: true, showAll });
}


