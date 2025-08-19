import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ exists: false });
  try {
    const raw = await readText('.data/webauthn_creds.json');
    const all = raw ? (JSON.parse(raw || '{}') as Record<string, Array<{ id: string }>>) : {};
    const idB64 = Buffer.from(id, 'utf8').toString('base64');
    const exists = Object.values(all).some((list) => (list || []).some((c) => c.id === id || c.id === idB64));
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false });
  }
}


