import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function tryFetch(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url, text } as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, url, text: msg } as const;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  try {
    const candidates = [
      'https://api.ipify.org?format=json',
      'https://ifconfig.me/ip',
      'https://ipinfo.io/ip',
    ];
    const results: any[] = [];
    let chosen: { ok: boolean; status: number; url: string; text: string } | null = null;
    for (const u of candidates) {
      const r = await tryFetch(u);
      results.push(r);
      if (r.ok && r.text) { chosen = r; break; }
    }
    const ip = (() => {
      if (!chosen) return null;
      try {
        if (chosen.url.includes('ipify')) {
          const j = JSON.parse(chosen.text);
          return j.ip || null;
        }
        return chosen.text.trim();
      } catch { return chosen.text.trim(); }
    })();

    return NextResponse.json({ ip, provider: chosen?.url || null, probes: results }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


