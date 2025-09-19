import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Minimal validation for Telegram WebApp initData according to docs
function validateTelegramInitData(initData: string): { ok: boolean; userId?: string | null; error?: string } {
  try {
    if (typeof initData !== 'string' || initData.trim().length === 0) return { ok: false, error: 'NO_INIT_DATA' };
    const sp = new URLSearchParams(initData);
    const hash = sp.get('hash') || '';
    if (!hash) return { ok: false, error: 'NO_HASH' };
    // Prepare data_check_string
    const pairs: string[] = [];
    sp.forEach((value, key) => {
      if (key === 'hash') return;
      pairs.push(`${key}=${value}`);
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    // Bot token must be known on server side; use env
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) return { ok: false, error: 'NO_BOT_TOKEN' };
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calc !== hash) return { ok: false, error: 'BAD_SIGNATURE' };
    // Optional: check auth_date freshness
    const authDate = Number(sp.get('auth_date') || '0');
    if (Number.isFinite(authDate) && authDate > 0) {
      const ageSec = Math.floor(Date.now() / 1000) - authDate;
      if (ageSec > 3600 * 24) return { ok: false, error: 'STALE' };
    }
    // Extract user id
    let userId: string | null = null;
    try { const u = sp.get('user'); if (u) { const obj = JSON.parse(u); const id = obj?.id; if (typeof id === 'number' || typeof id === 'string') userId = String(id); } } catch {}
    return { ok: true, userId };
  } catch {
    return { ok: false, error: 'INVALID' };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const initData = String(body?.initData || '');
    const v = validateTelegramInitData(initData);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error || 'INVALID' }, { status: 400 });
    const uid = v.userId || null;

    // Mark that we expect a contact for this user id (webhook should correlate)
    try {
      const { writeText } = await import('@/server/storage');
      const key = `.data/tg_phone_wait_${uid ?? 'unknown'}.json`;
      const rec = { ts: new Date().toISOString(), userId: uid };
      await writeText(key, JSON.stringify(rec));
    } catch {}

    return NextResponse.json({ ok: true, userId: uid });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


