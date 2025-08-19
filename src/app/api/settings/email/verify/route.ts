import { NextResponse } from 'next/server';
import { getUserById, updateUserEmail, setUserEmailVerified } from '@/server/userStore';
import { promises as fs } from 'fs';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const body = await req.json().catch(() => null) as { code?: string } | null;
    const code = String(body?.code || '').trim();
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });

    const file = `.data/email_code_${userId}.txt`;
    const raw = await readText(file);
    if (!raw) return NextResponse.json({ error: 'NO_PENDING' }, { status: 400 });
    let parsed: { email?: string; code?: string; ts?: number } = {};
    try { parsed = JSON.parse(raw); } catch {}
    if (!parsed.code || !parsed.email) return NextResponse.json({ error: 'NO_PENDING' }, { status: 400 });
    if (parsed.code !== code) return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
    // optional: expire after 15 minutes
    if (parsed.ts && Date.now() - parsed.ts > 15 * 60 * 1000) return NextResponse.json({ error: 'EXPIRED' }, { status: 400 });

    // Confirm email already stored earlier
    const user = await getUserById(userId);
    if (!user?.email || user.email !== parsed.email) {
      // In case email changed in between, set it back
      await updateUserEmail(userId, parsed.email!);
    }
    await writeText(file, '');
    await setUserEmailVerified(userId, true);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


