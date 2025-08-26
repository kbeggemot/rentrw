import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { setUserEmailVerified, updateUserEmail, updateUserPhone } from '@/server/userStore';
import { revokeAllCredentialsForUser } from '@/server/webauthn';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type UsersFile = { users?: Array<{ id: string; phone: string; email?: string | null; payoutOrgInn?: string | null }>; };
type OrgsFile = { orgs?: Record<string, { inn: string; name?: string | null; members: string[] }>; };

async function readUsers(): Promise<UsersFile> {
  const raw = await readText('.data/users.json');
  if (!raw) return { users: [] };
  try { return JSON.parse(raw) as UsersFile; } catch { return { users: [] }; }
}

async function readOrgs(): Promise<OrgsFile> {
  const raw = await readText('.data/orgs.json');
  if (!raw) return { orgs: {} as any };
  try { return JSON.parse(raw) as OrgsFile; } catch { return { orgs: {} as any }; }
}

function makeBackUrl(req: Request, path: string): string {
  try {
    const proto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    if (!host) return path; // relative fallback
    const rel = path.startsWith('/') ? path : '/' + path;
    return `${proto}://${host}${rel}`;
  } catch { return path; }
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const [usersFile, orgsFile] = await Promise.all([readUsers(), readOrgs()]);
  const users = Array.isArray(usersFile.users) ? usersFile.users : [];
  const orgs = (orgsFile.orgs && typeof orgsFile.orgs === 'object') ? orgsFile.orgs : {} as any;
  const items = users.map((u) => {
    const accessible: Array<{ inn: string; name: string | null }> = [];
    for (const org of Object.values(orgs) as any[]) {
      if (Array.isArray(org.members) && org.members.includes(u.id)) {
        accessible.push({ inn: org.inn, name: org.name ?? null });
      }
    }
    return { id: u.id, phone: u.phone, email: u.email ?? null, orgInn: u.payoutOrgInn ?? null, orgs: accessible, showAll: (u as any).showAllDataForOrg ? true : false };
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  // Support DELETE via form method override
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const method = String(fd.get('_method') || '').toUpperCase();
    // Admin updates via form
    if (method === 'PATCH') {
      const id = String(fd.get('id') || '').trim();
      if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
      const emailVerified = fd.get('emailVerified');
      const email = fd.get('email');
      const phone = fd.get('phone');
      if (emailVerified !== null) await setUserEmailVerified(id, String(emailVerified) === 'true');
      if (typeof email === 'string' && email) await updateUserEmail(id, String(email));
      if (typeof phone === 'string' && phone) await updateUserPhone(id, String(phone));
      const r = NextResponse.redirect(makeBackUrl(req, '/admin?tab=lk_users'), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Пользователь обновлён' }), { path: '/' });
      return r;
    }
    if (method === 'REVOKE_WEBAUTHN') {
      const id = String(fd.get('id') || '').trim();
      if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
      const count = await revokeAllCredentialsForUser(id);
      const r = NextResponse.redirect(makeBackUrl(req, '/admin?tab=lk_users'), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: `Отозваны биометрические токены: ${count}` }), { path: '/' });
      return r;
    }
    if (method === 'DELETE') {
      const id = String(fd.get('id') || '').trim();
      const confirm = String(fd.get('confirm') || '').trim().toLowerCase();
      if (confirm !== 'yes') {
        return NextResponse.json({ error: 'CONFIRM_REQUIRED' }, { status: 400 });
      }
      if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
      const u = await readUsers();
      const list = Array.isArray(u.users) ? u.users : [];
      const next = list.filter((x) => x.id !== id);
      await writeText('.data/users.json', JSON.stringify({ users: next }, null, 2));
      const r = NextResponse.redirect(makeBackUrl(req, '/admin?tab=lk_users'), 303);
      r.cookies.set('flash', JSON.stringify({ kind: 'success', msg: 'Пользователь удалён' }), { path: '/' });
      return r;
    }
  }
  return NextResponse.json({ error: 'UNSUPPORTED' }, { status: 400 });
}


