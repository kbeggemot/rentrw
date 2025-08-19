import { NextResponse } from 'next/server';
import { readFile as readFileFs } from 'fs/promises';
import path from 'path';
import { readFile as readFromStorage } from '@/server/storage';

export const runtime = 'nodejs';

async function readFileSafe(relPath: string): Promise<{ ok: boolean; text?: string }>{
  try {
    const txt = await readFromStorage(relPath);
    if (txt != null) return { ok: true, text: txt };
  } catch {}
  try {
    const abs = path.join(process.cwd(), relPath);
    const txt = await readFileFs(abs, 'utf8');
    return { ok: true, text: txt as unknown as string };
  } catch {}
  return { ok: false };
}

function tail(text: string, lines: number): string {
  const arr = text.split('\n');
  const slice = arr.slice(Math.max(0, arr.length - lines));
  return slice.join('\n');
}

export async function GET(): Promise<Response> {
  try {
    const files = {
      lastRequest: '.data/ofd_last_request.json',
      lastResponse: '.data/ofd_last_response.json',
      lastAuth: '.data/ofd_auth_token_last.json',
      lastCallback: '.data/ofd_callback_last.json',
      callbacksLog: '.data/ofd_callbacks.log',
    } as const;

    const [reqR, resR, authR, cbR, logR] = await Promise.all([
      readFileSafe(files.lastRequest),
      readFileSafe(files.lastResponse),
      readFileSafe(files.lastAuth),
      readFileSafe(files.lastCallback),
      readFileSafe(files.callbacksLog),
    ]);

    const redact = (txt?: string): string | undefined => {
      if (!txt) return txt;
      return txt
        .replace(/(AuthToken"\s*:\s*")[^"]+(" )/gi, '$1***$2')
        .replace(/(AuthToken"\s*:\s*")[^"]+("$)/gi, '$1***$2')
        .replace(/(Password"\s*:\s*")[^"]+(" )/gi, '$1***$2')
        .replace(/(Password"\s*:\s*")[^"]+("$)/gi, '$1***$2');
    };

    const out = {
      exists: {
        lastRequest: reqR.ok,
        lastResponse: resR.ok,
        lastAuth: authR.ok,
        lastCallback: cbR.ok,
        callbacksLog: logR.ok,
      },
      lastRequest: redact(reqR.text),
      lastResponse: redact(resR.text),
      lastAuthToken: redact(authR.text),
      lastCallback: cbR.text,
      callbacksTail: logR.text ? tail(logR.text, 100) : undefined,
    } as Record<string, unknown>;
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


