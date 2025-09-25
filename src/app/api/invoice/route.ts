import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Invoice = {
  id: number; // 6-digit
  code: string; // 4+ char unique public code
  createdAt: string;
  phone: string;
  orgInn: string;
  orgName: string;
  email?: string | null;
  description: string;
  amount: string; // keep as string with comma
};

async function readStore(): Promise<Invoice[]> {
  try { const { readText } = await import('@/server/storage'); const t = await readText('.data/invoices.json'); return t ? JSON.parse(t) : []; } catch { return []; }
}
async function writeStore(list: Invoice[]): Promise<void> {
  const { writeText } = await import('@/server/storage');
  await writeText('.data/invoices.json', JSON.stringify(list, null, 2));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cursor = Number(url.searchParams.get('cursor') || '0');
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') || '5')));
    const all = await readStore();
    const sorted = [...all].sort((a, b) => (a.id < b.id ? 1 : -1));
    const start = Math.max(0, cursor);
    const items = sorted.slice(start, start + limit);
    const nextCursor = start + limit < sorted.length ? start + limit : null;
    return NextResponse.json({ items, nextCursor });
  } catch (e) {
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const phone = String(body?.phone || '').trim();
    const orgInn = String(body?.orgInn || '').trim();
    const orgName = String(body?.orgName || '').trim();
    const email = (body?.email ? String(body.email).trim() : '') || null;
    const description = String(body?.description || '').trim();
    const amount = String(body?.amount || '').trim();
    if (!phone || !orgInn || !orgName || !description || !amount) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    // 6-digit unique id
    const gen = async (): Promise<number> => {
      const n = Math.floor(100000 + Math.random() * 900000);
      const list = await readStore();
      return list.some((x) => x.id === n) ? gen() : n;
    };
    const id = await gen();
    // 4-char unique code (expand length if too many collisions)
    const genCode = async (): Promise<string> => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const make = (len: number) => Array.from({ length: len }).map(() => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      const list = await readStore();
      const exists = new Set(list.map((x) => x.code));
      let len = 4;
      let attempts = 0;
      let code = make(len);
      while (exists.has(code)) {
        attempts += 1;
        if (attempts > 2000) { len += 1; attempts = 0; }
        code = make(len);
      }
      return code;
    };
    const code = await genCode();
    const inv: Invoice = { id, code, createdAt: new Date().toISOString(), phone, orgInn, orgName, email, description, amount };
    const list = await readStore();
    list.push(inv);
    await writeStore(list);
    return NextResponse.json({ ok: true, invoice: inv });
  } catch (e) {
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}


