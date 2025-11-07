import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    // Verify Telegram secret header for invoice bot
    try {
      const configured = process.env.TELEGRAM_INVOICE_SECRET_TOKEN;
      if (configured) {
        const got = req.headers.get('x-telegram-bot-api-secret-token');
        if (!got || got !== configured) {
          try {
            const fs = await import('fs/promises');
            await fs.appendFile('.data/telegram_invoice_debug.log', `[${new Date().toISOString()}] secret_mismatch got=${JSON.stringify(got)}\n`);
          } catch {}
          return NextResponse.json({ ok: false }, { status: 403 });
        }
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
        // Persist per-user phone
        const savePath = `.data/tg_phone_${encodeURIComponent(tgUserId)}.json`;
        await writeText(savePath, JSON.stringify({ userId: tgUserId, phone: digits, source: 'telegram_contact_invoice', ts: new Date().toISOString() }));
        // Also mark any pending wait tokens as complete (best-effort)
        try {
          const { list } = await import('@/server/storage');
          const all = await list('.data');
          const waits = all.filter((p: string) => /\.data\/tg_phone_wait_.*\.json$/.test(p));
          for (const w of waits) {
            try {
              const txt = await readText(w); const obj = txt ? JSON.parse(txt as any) : null;
              if (obj && (!obj.userId || String(obj.userId) === tgUserId)) {
                await writeText(w, JSON.stringify({ ...obj, userId: tgUserId, phone: digits, ts: new Date().toISOString() }));
              }
            } catch {}
          }
        } catch {}
        try {
          const fs = await import('fs/promises');
          await fs.appendFile('.data/telegram_invoice_debug.log', `[${new Date().toISOString()}] contact_saved user=${tgUserId} phone=${digits}\n`);
        } catch {}
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}


