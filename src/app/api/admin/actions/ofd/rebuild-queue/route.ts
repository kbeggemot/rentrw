import { NextResponse } from 'next/server';
import { readText, writeText } from '@/server/storage';
import { listAllSales } from '@/server/taskStore';
import { getDecryptedApiToken } from '@/server/secureStore';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

function isAuthed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

export async function POST(req: Request) {
  try {
    if (!isAuthed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const url = new URL(req.url);
    const onlyToday = url.searchParams.get('today') === '1';

    const all = await listAllSales();

    const mskToday = new Date()
      .toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
      .split('.')
      .reverse()
      .join('-');

    type Job = {
      id: string;
      userId: string;
      orderId: number;
      dueAt: string;
      party: 'partner' | 'org';
      partnerInn?: string;
      partnerName?: string;
      description: string;
      amountRub: number;
      vatRate: any;
      buyerEmail?: string | null;
    };

    const jobs: Job[] = [];
    for (const s of all) {
      // root status gating: не трогаем отменённые/ошибочные
      const root = String((s as any).rootStatus || '').toLowerCase();
      if (root === 'error' || root === 'canceled' || root === 'cancelled') continue;
      // бизнес‑правило: чекам соответствуют только оплачен/переведён [[memory:7106251]]
      const st = String(s.status || '').toLowerCase();
      if (!(st === 'paid' || st === 'transfered' || st === 'transferred')) continue;

      if ((s as any).ofdFullUrl) continue;
      const end = (s as any).serviceEndDate as string | null;
      if (!end) continue;
      if (onlyToday && end !== mskToday) continue;

      const amountRub = s.isAgent
        ? Math.max(0, (s.amountGrossRub || 0) - ((s as any).retainedCommissionRub || 0))
        : (s.amountGrossRub || 0);
      if (!(amountRub > 0)) continue;

      const description = (s as any).description && (s as any).description.trim().length > 0
        ? (s as any).description.trim()
        : 'Оплата услуги';
      const vatRate = ((s as any).vatRate as any) || 'none';
      const orderId = Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN);
      if (!Number.isFinite(orderId)) continue;

      // Schedule time: 12:00 MSK (09:00Z) в дату окончания услуги
      const dueAtIso = new Date(`${end}T09:00:00Z`).toISOString();

      if (s.isAgent) {
        // Для агентских нужен ИНН исполнителя
        let partnerInn: string | undefined;
        let partnerName: string | undefined;
        try {
          const token = await getDecryptedApiToken(s.userId).catch(() => null);
          if (token) {
            const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
            const tUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            const r = await fetch(tUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            const txt = await r.text();
            let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
            const t = d && typeof d === 'object' && 'task' in d ? (d as any).task : d;
            partnerInn = (t?.executor?.inn as string | undefined) ?? undefined;
            partnerName = (t?.executor && [t.executor.last_name, t.executor.first_name, t.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
          }
        } catch {}
        if (!partnerInn) continue;
        jobs.push({ id: `${s.userId}:${orderId}`, userId: s.userId, orderId, dueAt: dueAtIso, party: 'partner', partnerInn, partnerName, description, amountRub, vatRate, buyerEmail: null });
      } else {
        jobs.push({ id: `${s.userId}:${orderId}`, userId: s.userId, orderId, dueAt: dueAtIso, party: 'org', description, amountRub, vatRate, buyerEmail: null });
      }
    }

    await writeText('.data/ofd_jobs.json', JSON.stringify({ jobs }, null, 2));

    return NextResponse.json({ ok: true, jobs: jobs.length, today: onlyToday });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  try {
    const body = readFallbackJsonBody(req, ['x-fallback-payload']) || '';
    if (!body) return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body });
    const res = await POST(req2);
    try { res.headers.set('Cache-Control', 'no-store'); } catch {}
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


