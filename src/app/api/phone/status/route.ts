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
      const { readText } = await import('@/server/storage');
      const p = effectiveUid ? `.data/tg_phone_${encodeURIComponent(String(effectiveUid))}.json` : `.data/tg_phone_wait_${encodeURIComponent(String(wait || 'unknown'))}.json`;
      const txt = await readText(p);
      if (!txt) return NextResponse.json({ ok: true, phone: null });
      try {
        const obj = JSON.parse(txt);
        const phone = obj?.phone || obj?.phone_number || null;
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


