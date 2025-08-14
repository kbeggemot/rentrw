import { NextResponse } from 'next/server';
import { consumeResetToken } from '@/server/resetStore';
import { getUserById, hashPassword } from '@/server/userStore';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token: string | undefined = body?.token;
    const password: string | undefined = body?.password;
    if (!token || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const rec = await consumeResetToken(token);
    if (!rec) return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
    const user = await getUserById(rec.userId);
    if (!user) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    const { hash, salt } = hashPassword(password);
    // update user record
    const dataDir = path.join(process.cwd(), '.data');
    const usersFile = path.join(dataDir, 'users.json');
    const raw = await fs.readFile(usersFile, 'utf8').catch(() => null);
    if (!raw) return NextResponse.json({ error: 'STORE_ERROR' }, { status: 500 });
    const parsed = JSON.parse(raw) as { users?: any[] };
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const idx = users.findIndex((u: any) => u.id === user.id);
    if (idx === -1) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    users[idx].passHash = hash;
    users[idx].passSalt = salt;
    await fs.writeFile(usersFile, JSON.stringify({ users }, null, 2), 'utf8');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


