import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const raw = await readText('.data/docs.json');
    const parsed = raw ? JSON.parse(raw) : { items: [] };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ items: [] });
  }
}
