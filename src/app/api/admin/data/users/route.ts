import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

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
    if (method === 'DELETE') {
      const id = String(fd.get('id') || '').trim();
      if (!id) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
      const u = await readUsers();
      const list = Array.isArray(u.users) ? u.users : [];
      const next = list.filter((x) => x.id !== id);
      await writeText('.data/users.json', JSON.stringify({ users: next }, null, 2));
      return NextResponse.redirect(new URL('/admin?tab=lk_users', req.url), 303);
    }
  }
  return NextResponse.json({ error: 'UNSUPPORTED' }, { status: 400 });
}


