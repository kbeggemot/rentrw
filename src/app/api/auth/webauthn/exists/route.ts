import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const CREDS_FILE = path.join(process.cwd(), '.data', 'webauthn_creds.json');

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ exists: false });
  try {
    const raw = await fs.readFile(CREDS_FILE, 'utf8').catch(() => '{}');
    const all = JSON.parse(raw || '{}') as Record<string, Array<{ id: string }>>;
    const exists = Object.values(all).some((list) => (list || []).some((c) => c.id === id || Buffer.from(id, 'utf8').toString('base64') === c.id));
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ exists: false });
  }
}


