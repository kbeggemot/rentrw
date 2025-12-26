import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { getInstanceId } from '@/server/leaderLease';
import { startWatchdog } from '@/server/watchdog';

export const runtime = 'nodejs';

type Step = { ok: boolean; ms: number; error?: string | null };

export async function GET() {
  try {
    try { startWatchdog(); } catch {}
    const s3Enabled = (process.env.S3_ENABLED || '0') === '1';
    const id = getInstanceId();
    const key = `.data/debug/storage_probe_${id}.json`;
    const payload = JSON.stringify({ ts: new Date().toISOString(), instanceId: id });

    const steps: Record<string, Step> = {};

    const timed = async (name: string, fn: () => Promise<void>) => {
      const started = Date.now();
      try {
        await fn();
        steps[name] = { ok: true, ms: Date.now() - started };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps[name] = { ok: false, ms: Date.now() - started, error: msg };
      }
    };

    await timed('writeText', async () => { await writeText(key, payload); });
    await timed('readText', async () => { await readText(key); });

    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      instanceId: id,
      s3Enabled,
      key,
      steps,
    }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


