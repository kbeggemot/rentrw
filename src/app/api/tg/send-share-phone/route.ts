import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

function validateTelegramInitData(initData: string): { ok: boolean; userId?: string | null; error?: string } {
  try {
    if (typeof initData !== 'string' || initData.trim().length === 0) return { ok: false, error: 'NO_INIT_DATA' };
    const sp = new URLSearchParams(initData);
    const hash = sp.get('hash') || '';
    if (!hash) return { ok: false, error: 'NO_HASH' };
    const pairs: string[] = [];
    sp.forEach((value, key) => { if (key !== 'hash') pairs.push(`${key}=${value}`); });
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) return { ok: false, error: 'NO_BOT_TOKEN' };
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calc !== hash) return { ok: false, error: 'BAD_SIGNATURE' };
    const user = sp.get('user');
    let userId: string | null = null;
    if (user) {
      try { const obj = JSON.parse(user); const id = obj?.id; if (typeof id === 'number' || typeof id === 'string') userId = String(id); } catch {}
    }
    return { ok: true, userId };
  } catch { return { ok: false, error: 'INVALID' }; }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const initData = String(body?.initData || '');
    const v = validateTelegramInitData(initData);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error || 'INVALID' }, { status: 400 });
    const userId = v.userId;
    if (!userId) return NextResponse.json({ ok: false, error: 'NO_USER_ID' }, { status: 400 });

    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const base = `https://api.telegram.org/bot${token}`;
    const payload = {
      chat_id: userId,
      text: 'Нажмите кнопку, чтобы поделиться номером телефона',
      reply_markup: {
        keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        selective: true
      }
    } as any;
    const res = await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const txt = await res.text();
    let ok = res.ok;
    try { const j = JSON.parse(txt); ok = Boolean(j?.ok); } catch {}
    if (!ok) return NextResponse.json({ ok: false, error: 'TG_SEND_FAILED', details: txt }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


