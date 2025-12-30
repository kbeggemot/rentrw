import { NextResponse } from 'next/server';
import { fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

type Invoice = {
  id: number; // 6-digit
  code: string; // 4+ char unique public code
  createdAt: string;
  phone: string;
  payerType: 'ru' | 'foreign'; // тип компании-плательщика
  orgInn: string;
  orgName: string;
  taxId?: string | null; // для иностранных
  address?: string | null; // юридический адрес для иностранных
  email?: string | null;
  description: string;
  amount: string; // keep as string with comma
  currency?: 'USD' | 'EUR' | null; // для иностранных
  servicePeriodStart?: string | null; // YYYY-MM-DD
  servicePeriodEnd?: string | null; // YYYY-MM-DD
  executorFio?: string | null;
  executorInn?: string | null;
  // Расчётные поля (для иностранных)
  invoice_amount?: number | null; // сумма инвойса в валюте
  sum_convert_cur?: number | null; // сумма к конвертации в валюте
  sum_convert_rub?: number | null; // сумма к конвертации в рублях
  get_bcc_weighted_average_rate?: number | null; // курс для конвертации
  total_amount_rub?: number | null; // итоговая сумма к выплате в рублях
};

function b64ToUtf8(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? norm + '='.repeat(4 - (norm.length % 4)) : norm;
  return Buffer.from(pad, 'base64').toString('utf8');
}

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
    // Fallback create flow: GET /api/invoice?create=1 with header x-invoice-payload=base64(JSON)
    if (url.searchParams.get('create') === '1') {
      const hdr = req.headers.get('x-invoice-payload') || '';
      if (!hdr) return NextResponse.json({ ok: false, error: 'NO_PAYLOAD' }, { status: 400 });
      let jsonStr = '';
      try { jsonStr = b64ToUtf8(hdr); } catch { jsonStr = ''; }
      if (!jsonStr) return NextResponse.json({ ok: false, error: 'BAD_PAYLOAD' }, { status: 400 });
      const headers = new Headers(req.headers);
      headers.set('content-type', 'application/json');
      try { headers.delete('content-length'); } catch {}
      headers.set('x-fallback-method', 'GET');
      const req2 = new Request(url.toString(), { method: 'POST', headers, body: jsonStr });
      return await POST(req2);
    }
    const cursor = Number(url.searchParams.get('cursor') || '0');
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') || '5')));
    const phoneDigits = (() => { try { return String(url.searchParams.get('phone') || '').replace(/\D/g, ''); } catch { return ''; } })();
    const all = await readStore();
    const filtered = (() => {
      if (!phoneDigits) return all;
      return all.filter((x) => {
        try { return String(x.phone || '').replace(/\D/g, '') === phoneDigits; } catch { return false; }
      });
    })();
    const sorted = [...filtered].sort((a: any, b: any) => {
      const at = Date.parse((a && a.createdAt) || 0);
      const bt = Date.parse((b && b.createdAt) || 0);
      if (!Number.isNaN(at) || !Number.isNaN(bt)) {
        if (Number.isNaN(at)) return 1;
        if (Number.isNaN(bt)) return -1;
        return bt - at; // newest first
      }
      // Fallback by id desc
      return a.id < b.id ? 1 : -1;
    });
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
    const payerType: 'ru' | 'foreign' = (body?.payerType === 'foreign' || body?.payerType === 'ru') ? body.payerType : 'ru';
    const orgInn = String(body?.orgInn || '').trim();
    const orgName = String(body?.orgName || '').trim();
    const taxId = body?.taxId ? String(body.taxId).trim() : null;
    const address = body?.address ? String(body.address).trim() : null;
    const email = (body?.email ? String(body.email).trim() : '') || null;
    const description = String(body?.description || '').trim();
    const amount = String(body?.amount || '').trim();
    const currency = (body?.currency === 'USD' || body?.currency === 'EUR') ? body.currency : null;
    const servicePeriodStart = body?.servicePeriodStart ? String(body.servicePeriodStart).trim() : null;
    const servicePeriodEnd = body?.servicePeriodEnd ? String(body.servicePeriodEnd).trim() : null;
    let executorFio = body?.executorFio ? String(body.executorFio).trim() : null;
    let executorInn = body?.executorInn ? String(body.executorInn).replace(/\D/g, '') : null;
    if (!phone || !orgName || !description || !amount) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    if (payerType === 'ru' && !orgInn) return NextResponse.json({ error: 'MISSING_INN' }, { status: 400 });
    if (payerType === 'foreign' && (!taxId || !address)) return NextResponse.json({ error: 'MISSING_FOREIGN_FIELDS' }, { status: 400 });
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
          const out = await fetchTextWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
          const txt = out.text;
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
    
    // Расчёт для иностранных компаний
    let invoice_amount: number | null = null;
    let sum_convert_cur: number | null = null;
    let sum_convert_rub: number | null = null;
    let get_bcc_weighted_average_rate: number | null = null;
    let total_amount_rub: number | null = null;
    
    if (payerType === 'foreign' && currency) {
      try {
        const amtNum = Number(String(amount).replace(',', '.'));
        if (!Number.isFinite(amtNum)) throw new Error('INVALID_AMOUNT');
        invoice_amount = amtNum;
        sum_convert_cur = Math.max(invoice_amount - (invoice_amount * 0.03), 0);
        
        // Fetch BCC rates from website (parse from data-legal JSON attribute)
        async function fetchBccRates(): Promise<{ rub_kzt_buy: number; rub_kzt_sell: number; cur_kzt_buy: number; cur_kzt_sell: number }> {
          const url = 'https://www.bcc.kz/personal/currency-rates/';
          const out = await fetchTextWithTimeout(url, { cache: 'no-store' }, 15_000);
          if (!out.res.ok) throw new Error('BCC_FETCH_FAILED');
          const html = out.text;
          // Extract JSON from data-legal attribute
          const m = /data-legal='([^']+)'/.exec(html);
          if (!m || !m[1]) throw new Error('RATE_DATA_NOT_FOUND');
          const jsonStr = m[1].replace(/&quot;/g, '"');
          const data = JSON.parse(jsonStr);
          if (!Array.isArray(data)) throw new Error('INVALID_RATE_DATA');
          
          const usd = data.find((x: any) => String(x.name).toLowerCase() === 'usd');
          const eur = data.find((x: any) => String(x.name).toLowerCase() === 'eur');
          const rub = data.find((x: any) => String(x.name).toLowerCase() === 'rub');
          if (!usd || !eur || !rub) throw new Error('MISSING_CURRENCY_DATA');
          
          const parse = (val: any) => {
            const n = Number(String(val).replace(',', '.'));
            if (!Number.isFinite(n) || n <= 0) throw new Error('INVALID_RATE_VALUE');
            return n;
          };
          
          const rub_kzt_buy = parse(rub.buy);
          const rub_kzt_sell = parse(rub.sell);
          const cur_kzt_buy = parse(currency === 'USD' ? usd.buy : eur.buy);
          const cur_kzt_sell = parse(currency === 'USD' ? usd.sell : eur.sell);
          
          return { rub_kzt_buy, rub_kzt_sell, cur_kzt_buy, cur_kzt_sell };
        }
        
        const rates = await fetchBccRates();
        const cross_rate_sell = rates.cur_kzt_sell / rates.rub_kzt_buy;
        const cross_rate_buy = rates.cur_kzt_buy / rates.rub_kzt_sell;
        const cross_rate_average = (cross_rate_buy + cross_rate_sell) / 2;
        const spread = (cross_rate_sell - cross_rate_buy) / 2;
        get_bcc_weighted_average_rate = cross_rate_average - spread;
        
        // Сумма в рублях после конвертации (комиссия 3% уже учтена в sum_convert_cur)
        sum_convert_rub = sum_convert_cur * get_bcc_weighted_average_rate;
        total_amount_rub = sum_convert_rub;
      } catch (e) {
        return NextResponse.json({ error: 'BCC_RATES_UNAVAILABLE', message: 'Не удалось получить актуальные курсы валют. Попробуйте позже' }, { status: 503 });
      }
    }
    
    const inv: Invoice = { id, code, createdAt: new Date().toISOString(), phone, payerType, orgInn, orgName, taxId, address, email, description, amount, currency, servicePeriodStart, servicePeriodEnd, executorFio, executorInn, invoice_amount, sum_convert_cur, sum_convert_rub, get_bcc_weighted_average_rate, total_amount_rub };
    const list = await readStore();
    list.push(inv);
    await writeStore(list);

    // If customer email provided — send email with invoice link (best-effort, no blocking)
    if (email && /@/.test(email)) {
      try {
        const { sendEmail } = await import('@/server/email');
        const link = (process.env.NEXT_PUBLIC_BASE_URL || 'https://ypla.ru').replace(/\/$/, '') + `/invoice/${encodeURIComponent(inv.code || inv.id)}`;
        
        if (payerType === 'foreign') {
          const { renderInvoiceForCustomerEmailForeign } = await import('@/server/emailTemplates');
          const subject = `Invoice No. ${inv.id} ${inv.invoice_amount || inv.amount} ${inv.currency || ''}`;
          const html = renderInvoiceForCustomerEmailForeign({
            invoiceNumber: inv.id,
            invoiceAmount: String(inv.invoice_amount || inv.amount),
            currency: inv.currency || 'USD',
            contractorName: inv.executorFio || 'Contractor',
            invoiceLink: link
          });
          await sendEmail({ to: email, subject, html });
        } else {
          const { renderInvoiceForCustomerEmail } = await import('@/server/emailTemplates');
          const subject = `Счёт на оплату №${inv.id} — ${inv.amount} ₽`;
          const html = renderInvoiceForCustomerEmail({ invoiceNumber: inv.id, amount: `${inv.amount}`, sellerName: inv.executorFio || 'Исполнитель', invoiceLink: link });
          await sendEmail({ to: email, subject, html });
        }
      } catch {}
    }

    return NextResponse.json({ ok: true, invoice: inv });
  } catch (e) {
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}


