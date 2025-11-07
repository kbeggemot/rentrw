import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wait = url.searchParams.get('wait');
    const uid = url.searchParams.get('uid');
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)tg_uid=([^;]+)/.exec(cookie);
    const cookieUid = mc ? decodeURIComponent(mc[1]) : null;
    const effectiveUid = (uid && uid.trim().length > 0 ? uid : cookieUid) || null;
    // If we have a wait id, map it to any user id's phone (server writes with userId only)
    if (!effectiveUid && !wait) return NextResponse.json({ ok: true, phone: null });
    try {
      const storage = await import('@/server/storage');
      const readText = storage.readText;
      const writeText = storage.writeText;
      const p = effectiveUid ? `.data/tg_phone_${encodeURIComponent(String(effectiveUid))}.json` : `.data/tg_phone_wait_${encodeURIComponent(String(wait || 'unknown'))}.json`;
      const txt = await readText(p);
      if (!txt) return NextResponse.json({ ok: true, phone: null });
      try {
        const obj = JSON.parse(txt);
        const phone = obj?.phone || obj?.phone_number || null;
        if (phone) {
          try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const logKey = `.data/logs/telegram_invoice/status-${ts}-${Math.random().toString(36).slice(2, 8)}.json`;
            await writeText(logKey, JSON.stringify({ ts: new Date().toISOString(), wait, uid: effectiveUid, phone }, null, 2));
          } catch {}
        }
        return NextResponse.json({ ok: true, phone: phone ? String(phone) : null });
      } catch {
        return NextResponse.json({ ok: true, phone: null });
      }
    } catch {
      return NextResponse.json({ ok: true, phone: null });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


