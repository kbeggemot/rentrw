import { NextResponse } from 'next/server';
import { fermaCreateAuthToken } from '@/server/ofdFerma';
import { writeText } from '@/server/storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const out = await fermaCreateAuthToken(undefined, undefined, undefined);
    if (!out.authToken) {
      try { await writeText('.data/ofd_auth_token_last_error.json', JSON.stringify({ ts: new Date().toISOString(), status: out.rawStatus, text: out.rawText }, null, 2)); } catch {}
      return NextResponse.json({ ok: false, status: out.rawStatus }, { status: 502 });
    }
    return NextResponse.json({ ok: true, expires: out.expires }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    try { await writeText('.data/ofd_auth_token_last_error.json', JSON.stringify({ ts: new Date().toISOString(), error: msg }, null, 2)); } catch {}
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const login: string | undefined = body?.login;
    const password: string | undefined = body?.password;
    const baseUrl: string | undefined = body?.baseUrl;
    const out = await fermaCreateAuthToken(login, password, { baseUrl });
    if (!out.authToken) return NextResponse.json({ error: 'NO_TOKEN', status: out.rawStatus, text: out.rawText }, { status: 502 });
    return NextResponse.json({ authToken: out.authToken, expires: out.expires }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


