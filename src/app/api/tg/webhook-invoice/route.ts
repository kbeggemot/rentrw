import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function logInvoiceDebug(entry: Record<string, any>): Promise<void> {
  try {
    const { writeText } = await import('@/server/storage');
    const ts = new Date().toISOString();
    const fileTs = ts.replace(/[:.]/g, '-');
    const key = `.data/logs/telegram_invoice/${fileTs}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeText(key, JSON.stringify({ ts, ...entry }, null, 2));
  } catch {}
}

export async function POST(req: Request) {
  try {
    // Verify Telegram secret header for invoice bot
    try {
      const configured = process.env.TELEGRAM_INVOICE_SECRET_TOKEN;
      if (configured) {
        const got = req.headers.get('x-telegram-bot-api-secret-token');
        if (!got || got !== configured) {
          await logInvoiceDebug({ event: 'secret_mismatch', got: got || null });
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
        const updatedWaits: string[] = [];
        try {
          const { list } = await import('@/server/storage');
          const all = await list('.data');
          const waits = all.filter((p: string) => /\.data\/tg_phone_wait_.*\.json$/.test(p));
          for (const w of waits) {
            try {
              const txt = await readText(w); const obj = txt ? JSON.parse(txt as any) : null;
              if (obj && (!obj.userId || String(obj.userId) === tgUserId)) {
                await writeText(w, JSON.stringify({ ...obj, userId: tgUserId, phone: digits, ts: new Date().toISOString() }));
                if (obj?.waitId) updatedWaits.push(String(obj.waitId));
                else {
                  const m = /tg_phone_wait_(.*)\.json$/.exec(w);
                  if (m) updatedWaits.push(m[1]);
                }
              }
            } catch {}
          }
        } catch {}
        await logInvoiceDebug({ event: 'contact_saved', userId: tgUserId, phone: digits, updatedWaits });
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}


