import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Minimal validation for Telegram WebApp initData according to docs (for invoice bot)
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
    // Bot token must be known on server side; use env (INVOICE bot token)
    const token = process.env.TELEGRAM_INVOICE_BOT_TOKEN || '';
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

function b64ToUtf8(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? norm + '='.repeat(4 - (norm.length % 4)) : norm;
  return Buffer.from(pad, 'base64').toString('utf8');
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  // Prefer no body; optional initData can be passed via header `x-tg-initdata` as base64.
  // Also supports generic `x-fallback-payload` (base64(JSON)) used by the shared client helper.
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('via') !== 'get') {
      // Avoid accidental side effects (e.g. prefetch) — this GET is only for fallback.
      return NextResponse.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    }

    const initHdr = req.headers.get('x-tg-initdata') || '';
    let initData = '';
    try { initData = initHdr ? b64ToUtf8(initHdr) : ''; } catch { initData = ''; }
    if (!initData) {
      // Try generic payload header: base64(JSON.stringify({ initData }))
      const fb = req.headers.get('x-fallback-payload') || '';
      if (fb) {
        try {
          const txt = b64ToUtf8(fb);
          try {
            const obj = txt ? JSON.parse(txt) : null;
            if (obj && typeof obj === 'object' && typeof (obj as any).initData === 'string') initData = String((obj as any).initData || '');
          } catch {
            // If payload is not JSON, treat decoded string as initData
            initData = String(txt || '');
          }
        } catch {}
      }
    }
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    headers.set('x-fallback-method', 'GET');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body: JSON.stringify({ initData }) });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const initData = String(body?.initData || '');
    let waitId: string | null = null;
    try {
      const url = new URL(req.url);
      waitId = url.searchParams.get('wait');
    } catch {}
    
    let uid: string | null = null;
    
    // Try to validate initData if present (for mini-app flow)
    if (initData && initData.trim().length > 0) {
      const v = validateTelegramInitData(initData);
      if (v.ok) {
        uid = v.userId || null;
      }
      // If validation fails but we have waitId, continue anyway (browser flow)
    }

    // Mark that we expect a contact for this user id or waitId (webhook should correlate)
    try {
      const { writeText } = await import('@/server/storage');
      const key = `.data/tg_phone_wait_${encodeURIComponent(waitId || String(uid ?? 'unknown'))}.json`;
      const rec = { ts: new Date().toISOString(), userId: uid, waitId: waitId || null } as any;
      await writeText(key, JSON.stringify(rec));
      try {
        const logKey = `.data/logs/telegram_invoice/await-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.json`;
        await writeText(logKey, JSON.stringify({ ts: new Date().toISOString(), waitId, userId: uid }, null, 2));
      } catch {}
    } catch {}

    return NextResponse.json({ ok: true, userId: uid });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


