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
  executorFio?: string | null;
  executorInn?: string | null;
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
    let executorFio = body?.executorFio ? String(body.executorFio).trim() : null;
    let executorInn = body?.executorInn ? String(body.executorInn).replace(/\D/g, '') : null;
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
    // If not provided by client, best-effort pull FIO/INN now to persist inside the invoice
    if (!executorFio || !executorInn) {
      try {
        const HARD_ORG_INN = '7729542170';
        const { listActiveTokensForOrg } = await import('@/server/orgStore');
        const tokens = await listActiveTokensForOrg(HARD_ORG_INN).catch(() => [] as string[]);
        const token = Array.isArray(tokens) && tokens.length > 0 ? tokens[0] : null;
        if (token) {
          const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
          const digits = phone.replace(/\D/g, '');
          const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          const txt = await r.text();
          let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
          const raw: any = data && typeof data === 'object' ? data : {};
          const ex = (raw.executor && typeof raw.executor === 'object') ? raw.executor : raw;
          if (!executorFio) {
            const fio = [ex?.last_name, ex?.first_name, ex?.second_name].filter(Boolean).join(' ').trim();
            if (fio) executorFio = fio;
          }
          if (!executorInn) {
            const inn = (ex && (ex.inn || ex.tax_id)) ? String(ex.inn || ex.tax_id) : null;
            if (inn) executorInn = inn.replace(/\D/g, '');
          }
        }
      } catch {}
    }

    const code = await genCode();
    const inv: Invoice = { id, code, createdAt: new Date().toISOString(), phone, orgInn, orgName, email, description, amount, executorFio, executorInn };
    const list = await readStore();
    list.push(inv);
    await writeStore(list);
    return NextResponse.json({ ok: true, invoice: inv });
  } catch (e) {
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}


