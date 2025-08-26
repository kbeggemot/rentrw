import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const raw = await readText('.data/orgs.json');
  const data = raw ? JSON.parse(raw) : { orgs: {} } as any;
  const out: Array<{ fingerprint: string; inn: string; orgName: string | null; users: string[]; createdAt: string; updatedAt: string }>=[];
  const orgMap = (data && typeof data.orgs === 'object') ? (data.orgs as Record<string, any>) : {};
  for (const org of Object.values(orgMap)) {
    const toks: any[] = Array.isArray(org?.tokens) ? org.tokens : [];
    for (const t of toks) {
      out.push({
        fingerprint: String(t.fingerprint||''),
        inn: String(org.inn||''),
        orgName: (org.name ?? null) as string | null,
        users: Array.isArray(t.holderUserIds) ? t.holderUserIds : [],
        createdAt: String(t.createdAt||''),
        updatedAt: String(t.updatedAt||'')
      });
    }
  }
  out.sort((a,b)=> (a.updatedAt < b.updatedAt ? 1 : -1));
  return NextResponse.json({ items: out });
}


