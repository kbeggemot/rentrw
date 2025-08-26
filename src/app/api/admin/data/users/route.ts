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
    return { id: u.id, phone: u.phone, email: u.email ?? null, orgInn: u.payoutOrgInn ?? null, orgs: accessible };
  });
  return NextResponse.json({ items });
}


