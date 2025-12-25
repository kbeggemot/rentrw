import { NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

type Sample = {
  ok: boolean;
  url: string;
  ms: number;
  status?: number;
  instanceId?: string | null;
  hostname?: string | null;
  pid?: number | null;
  uptimeSec?: number | null;
  error?: string | null;
};

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const n = Math.max(1, Math.min(30, Math.floor(num(url.searchParams.get('n'), 12))));
    const timeoutMs = Math.max(500, Math.min(20_000, Math.floor(num(url.searchParams.get('timeoutMs'), 3_000))));

    const hdrs = await nextHeaders();
    const rawProto = hdrs.get('x-forwarded-proto') || 'http';
    const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
    const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(host || '');
    const proto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
    const base = `${proto}://${host}`;

    const results: Sample[] = [];
    for (let i = 0; i < n; i += 1) {
      const u = `${base}/api/debug/health?ts=${Date.now()}&i=${i}`;
      const started = Date.now();
      try {
        const out = await fetchTextWithTimeout(u, { cache: 'no-store', headers: { Accept: 'application/json' } }, timeoutMs);
        const ms = Date.now() - started;
        const status = out.res.status;
        let data: any = null;
        try { data = out.text ? JSON.parse(out.text) : null; } catch { data = null; }
        results.push({
          ok: out.res.ok,
          url: u,
          ms,
          status,
          instanceId: data?.instanceId ?? null,
          hostname: data?.hostname ?? null,
          pid: typeof data?.pid === 'number' ? data.pid : null,
          uptimeSec: typeof data?.uptimeSec === 'number' ? data.uptimeSec : null,
        });
      } catch (e) {
        const ms = Date.now() - started;
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ ok: false, url: u, ms, error: msg });
      }
    }

    const ids = results.map((r) => r.instanceId).filter((x): x is string => Boolean(x));
    const unique = Array.from(new Set(ids));
    const timeouts = results.filter((r) => !r.ok && (r.error || '').toLowerCase().includes('abort'));
    const failures = results.filter((r) => !r.ok);

    return NextResponse.json({
      now: new Date().toISOString(),
      base,
      n,
      timeoutMs,
      uniqueInstanceIds: unique,
      counts: { total: results.length, ok: results.filter((r) => r.ok).length, failures: failures.length, timeouts: timeouts.length },
      samples: results,
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


