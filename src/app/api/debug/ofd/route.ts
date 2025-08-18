import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

async function readFileSafe(file: string): Promise<{ ok: boolean; text?: string }>{
  try {
    const txt = await fs.readFile(file, 'utf8');
    return { ok: true, text: txt };
  } catch {
    return { ok: false };
  }
}

function tail(text: string, lines: number): string {
  const arr = text.split('\n');
  const slice = arr.slice(Math.max(0, arr.length - lines));
  return slice.join('\n');
}

export async function GET(): Promise<Response> {
  try {
    const dataDir = path.join(process.cwd(), '.data');
    const files = {
      lastRequest: path.join(dataDir, 'ofd_last_request.json'),
      lastResponse: path.join(dataDir, 'ofd_last_response.json'),
      lastAuth: path.join(dataDir, 'ofd_auth_token_last.json'),
      lastCallback: path.join(dataDir, 'ofd_callback_last.json'),
      callbacksLog: path.join(dataDir, 'ofd_callbacks.log'),
    } as const;

    const [reqR, resR, authR, cbR, logR] = await Promise.all([
      readFileSafe(files.lastRequest),
      readFileSafe(files.lastResponse),
      readFileSafe(files.lastAuth),
      readFileSafe(files.lastCallback),
      readFileSafe(files.callbacksLog),
    ]);

    // Redact possible secrets
    const redact = (txt?: string): string | undefined => {
      if (!txt) return txt;
      return txt
        .replace(/(AuthToken"\s*:\s*")[^"]+(")/gi, '$1***$2')
        .replace(/(Password"\s*:\s*")[^"]+(")/gi, '$1***$2');
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


