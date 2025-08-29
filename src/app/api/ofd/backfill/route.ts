import { NextResponse } from 'next/server';
import { listSales } from '@/server/taskStore';
import { enqueueOffsetJob, startOfdScheduleWorker } from '@/server/ofdScheduleWorker';
import { getDecryptedApiToken } from '@/server/secureStore';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });

    const url = new URL(req.url);
    const onlyToday = url.searchParams.get('today') === '1';

    const sales = await listSales(userId);
    const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');

    const token = await getDecryptedApiToken(userId).catch(() => null);
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';

    let created = 0;
    for (const s of sales) {
      if (s.ofdFullUrl) continue; // уже есть полный расчёт
      if (!s.serviceEndDate) continue; // нет даты окончания
      if (onlyToday && s.serviceEndDate !== mskToday) continue;
      if (s.serviceEndDate > mskToday) continue; // будущая дата – ждём

      const amountRub = s.isAgent ? Math.max(0, (s.amountGrossRub || 0) - (s.retainedCommissionRub || 0)) : (s.amountGrossRub || 0);
      if (!(amountRub > 0)) continue;

      const description = (s.description && s.description.trim().length > 0) ? s.description : 'Оплата услуги';
      const vatRate = (s.vatRate as any) || 'none';

      if (s.isAgent) {
        // Для агентской нужен ИНН и ФИО исполнителя — получим их из RW задачи
        let partnerInn: string | undefined;
        let partnerName: string | undefined;
        if (token) {
          try {
            const taskUrl = new URL(`tasks/${encodeURIComponent(String(s.taskId))}`, base.endsWith('/') ? base : base + '/').toString();
            const r = await fetch(taskUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
            const t = await r.text();
            let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
            const task = d && typeof d === 'object' && 'task' in d ? (d as any).task : d;
            partnerInn = (task?.executor?.inn as string | undefined) ?? undefined;
            partnerName = (task?.executor && [task.executor.last_name, task.executor.first_name, task.executor.second_name].filter(Boolean).join(' ').trim()) || undefined;
          } catch {}
        }
        if (!partnerInn) continue; // без ИНН партнёра чек сформировать нельзя
        await enqueueOffsetJob({ userId, orderId: Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN), dueAt: new Date(Date.now() - 1000).toISOString(), party: 'partner', partnerInn, partnerName, description, amountRub, vatRate, buyerEmail: null });
        created += 1;
      } else {
        await enqueueOffsetJob({ userId, orderId: Number(String(s.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN), dueAt: new Date(Date.now() - 1000).toISOString(), party: 'org', description, amountRub, vatRate, buyerEmail: null });
        created += 1;
      }
    }

    // Запустим воркер (идемпотентно) и первый прогон
    try { startOfdScheduleWorker(); } catch {}

    return NextResponse.json({ ok: true, enqueued: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


