import { NextResponse } from 'next/server';
import { consumeResetToken } from '@/server/resetStore';
import { getUserById, setUserPassword } from '@/server/userStore';
import { writeText } from '@/server/storage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token: string | undefined = body?.token;
    const password: string | undefined = body?.password;
    if (!token || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const rec = await consumeResetToken(token);
    if (!rec) {
      try { await writeText('.data/reset_debug_last.json', JSON.stringify({ ts: new Date().toISOString(), token, found: false }, null, 2)); } catch {}
      return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
    }
    const user = await getUserById(rec.userId);
    if (!user) {
      try { await writeText('.data/reset_debug_last.json', JSON.stringify({ ts: new Date().toISOString(), token, found: true, userId: rec.userId, user: 'not_found' }, null, 2)); } catch {}
      return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    }
    try {
      await setUserPassword(user.id, password);
      try { await writeText('.data/reset_debug_last.json', JSON.stringify({ ts: new Date().toISOString(), token, found: true, userId: user.id, result: 'ok' }, null, 2)); } catch {}
      return NextResponse.json({ ok: true });
    } catch (e) {
      try { await writeText('.data/reset_debug_last.json', JSON.stringify({ ts: new Date().toISOString(), token, found: true, userId: user.id, error: String(e) }, null, 2)); } catch {}
      return NextResponse.json({ error: 'STORE_ERROR' }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


