import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    // Optional security: verify Telegram secret header if configured
    try {
      const configured = process.env.TELEGRAM_SECRET_TOKEN;
      if (configured) {
        const got = req.headers.get('x-telegram-bot-api-secret-token');
        if (!got || got !== configured) return NextResponse.json({ ok: false }, { status: 403 });
      }
    } catch {}

    const update: any = await req.json().catch(() => null);
    const msg = update?.message;
    const contact = msg?.contact;
    const from = msg?.from;
    if (contact && from && (String(contact.user_id || '') === String(from.id || ''))) {
      const tgUserId = String(from.id);
      const digits = String(contact.phone_number || '').replace(/\D/g, '');
      try {
        const { readText, writeText } = await import('@/server/storage');
        // If we were awaiting this user's contact, mark phone as confirmed
        const waitPath = `.data/tg_phone_wait_${encodeURIComponent(tgUserId)}.json`;
        const hadWait = await readText(waitPath);
        if (hadWait != null) {
          const savePath = `.data/tg_phone_${encodeURIComponent(tgUserId)}.json`;
          await writeText(savePath, JSON.stringify({ userId: tgUserId, phone: digits, source: 'telegram_contact', ts: new Date().toISOString() }));
        }
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}


