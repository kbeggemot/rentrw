import { fetchTextWithTimeout } from '@/server/http';
import { NextResponse } from 'next/server';
import dns from 'dns';

export const runtime = 'nodejs';

type Probe = { url: string; ok: boolean; status: number; ms: number; text?: string | null; error?: string | null };

async function timedFetch(url: string, timeoutMs: number): Promise<Probe> {
  const started = Date.now();
  try {
    const out = await fetchTextWithTimeout(url, { cache: 'no-store', headers: { Accept: 'application/json' } }, timeoutMs);
    const res = out.res;
    const txt = out.text || '';
    const ms = Date.now() - started;
    return { url, ok: res.ok, status: res.status, ms, text: txt ? txt.slice(0, 300) : '' };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    return { url, ok: false, status: 0, ms, error: msg };
  }
}

export async function GET() {
  try {
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const baseNorm = base.endsWith('/') ? base : base + '/';
    const host = (() => { try { return new URL(baseNorm).hostname; } catch { return null; } })();

    const dnsAll = await (async () => {
      if (!host) return null;
      try {
        const out = await dns.promises.lookup(host, { all: true });
        return out.map((x) => ({ address: x.address, family: x.family }));
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    })();

    const urls = [
      new URL('', baseNorm).toString(),
      new URL('account', baseNorm).toString(),
    ];

    const probes = [] as Probe[];
    for (const u of urls) probes.push(await timedFetch(u, 12_000));

    return NextResponse.json({ base: baseNorm, host, dns: dnsAll, probes }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


