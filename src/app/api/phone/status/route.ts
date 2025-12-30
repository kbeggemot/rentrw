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
    // If we have neither uid nor wait — nothing to resolve
    if (!effectiveUid && !wait) return NextResponse.json({ ok: true, phone: null });
    try {
      const storage = await import('@/server/storage');
      const readText = storage.readText;
      const writeText = storage.writeText;
      let phone: string | null = null;
      let waitObj: any = null;

      // 1) If explicit wait token is provided — try wait file first (it may contain either phone OR a userId pointer).
      if (wait && String(wait).trim().length > 0) {
        const waitPath = `.data/tg_phone_wait_${encodeURIComponent(String(wait || 'unknown'))}.json`;
        const waitTxt = await readText(waitPath);
        if (waitTxt) {
          try {
            waitObj = JSON.parse(waitTxt);
            const p = waitObj?.phone || waitObj?.phone_number || null;
            if (p) phone = String(p);
          } catch {
            waitObj = null;
          }
        }
      }

      // 2) If still no phone — try per-user phone file.
      // Prefer explicit uid/cookie uid; otherwise try to use userId from wait record.
      if (!phone) {
        const uidFromWait = waitObj?.userId ? String(waitObj.userId) : null;
        const uidToUse = (effectiveUid && effectiveUid.trim().length > 0 ? effectiveUid : uidFromWait) || null;
        if (uidToUse) {
          const userPath = `.data/tg_phone_${encodeURIComponent(String(uidToUse))}.json`;
          const userTxt = await readText(userPath);
          if (userTxt) {
            try {
              const obj = JSON.parse(userTxt);
              const p = obj?.phone || obj?.phone_number || null;
              if (p) phone = String(p);
            } catch {}
          }
        }
      }

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
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


