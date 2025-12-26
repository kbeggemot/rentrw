import { NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import dns from 'dns';
import https from 'https';

export const runtime = 'nodejs';

type IpProbe = {
  ip: string;
  family: 4 | 6;
  ok: boolean;
  ms: number;
  status?: number | null;
  error?: string | null;
  instanceId?: string | null;
  hostname?: string | null;
};

function n(v: string | null, fallback: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function httpsGetJsonViaIp(opts: {
  ip: string;
  family: 4 | 6;
  host: string;
  path: string;
  timeoutMs: number;
}): Promise<IpProbe> {
  const started = Date.now();
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
  return new Promise<IpProbe>((resolve) => {
    const req = https.request({
      host: opts.ip,
      family: opts.family,
      port: 443,
      method: 'GET',
      path: opts.path,
      servername: opts.host, // SNI
      headers: {
        Host: opts.host,
        Accept: 'application/json',
        Connection: 'close',
        'Cache-Control': 'no-cache',
      },
      agent,
      timeout: opts.timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => {
        if (chunks.reduce((a, b) => a + b.length, 0) < 8192) chunks.push(Buffer.from(c));
      });
      res.on('end', () => {
        const ms = Date.now() - started;
        const txt = Buffer.concat(chunks).toString('utf8');
        let data: any = null;
        try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
        resolve({
          ip: opts.ip,
          family: opts.family,
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          ms,
          status: res.statusCode || null,
          instanceId: data?.instanceId ?? null,
          hostname: data?.hostname ?? null,
        });
      });
    });
    req.on('timeout', () => {
      try { req.destroy(new Error('TIMEOUT')); } catch {}
    });
    req.on('error', (e) => {
      const ms = Date.now() - started;
      resolve({ ip: opts.ip, family: opts.family, ok: false, ms, status: null, error: e instanceof Error ? e.message : String(e) });
    });
    req.end();
  }).finally(() => {
    try { agent.destroy(); } catch {}
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const timeoutMs = Math.max(300, Math.min(20_000, Math.floor(n(url.searchParams.get('timeoutMs'), 2500))));
    const limit = Math.max(1, Math.min(20, Math.floor(n(url.searchParams.get('limit'), 10))));

    const hdrs = await nextHeaders();
    const rawHost = (url.searchParams.get('host') || hdrs.get('x-forwarded-host') || hdrs.get('host') || 'ypla.ru').trim();
    const host = rawHost.split(',')[0].trim();
    const path = (url.searchParams.get('path') || '/api/debug/health').trim();

    const a4 = await dns.promises.resolve4(host).catch(() => [] as string[]);
    const a6 = await dns.promises.resolve6(host).catch(() => [] as string[]);

    const ips: Array<{ ip: string; family: 4 | 6 }> = [];
    for (const ip of a4.slice(0, limit)) ips.push({ ip, family: 4 });
    for (const ip of a6.slice(0, limit)) ips.push({ ip, family: 6 });

    const probes: IpProbe[] = [];
    for (let i = 0; i < ips.length; i += 1) {
      const { ip, family } = ips[i];
      const p = `${path}${path.includes('?') ? '&' : '?'}ts=${Date.now()}&i=${i}`;
      probes.push(await httpsGetJsonViaIp({ ip, family, host, path: p, timeoutMs }));
    }

    return NextResponse.json({
      now: new Date().toISOString(),
      host,
      path,
      timeoutMs,
      resolved: { a4, a6 },
      probes,
      summary: {
        total: probes.length,
        ok: probes.filter((p) => p.ok).length,
        failures: probes.filter((p) => !p.ok).length,
      },
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


