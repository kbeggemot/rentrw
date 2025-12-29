import { NextResponse } from 'next/server';
import { fireAndForgetFetch, fetchTextWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

const HARD_ORG_INN = '7729542170'; // ООО «ЦУП»

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const rawPhone = String(body?.phone || '').trim();
    if (!rawPhone) return NextResponse.json({ ok: false, error: 'NO_PHONE', message: 'Не передан телефон исполнителя' }, { status: 400 });
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 10) return NextResponse.json({ ok: false, error: 'BAD_PHONE', message: 'Телефон указан неверно' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';

    // Resolve token for hardcoded org (без контекста пользователя)
    let token: string | null = null;
    try {
      const { listActiveTokensForOrg } = await import('@/server/orgStore');
      const list = await listActiveTokensForOrg(HARD_ORG_INN);
      token = list && list.length > 0 ? list[0] : null;
    } catch {}
    if (!token) return NextResponse.json({ ok: false, error: 'NO_TOKEN', message: 'Не найден активный токен организации для запросов в РВ' }, { status: 500 });

    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // 1) Приглашение (best-effort)
    try {
      const inviteUrl = new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString();
      // IMPORTANT: fire-and-forget with timeout + body drain (avoids undici socket leaks)
      fireAndForgetFetch(inviteUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, with_framework_agreement: false }),
        cache: 'no-store'
      }, 15_000);
    } catch {}

    // 2) Проверка
    const checkUrl = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
    const out = await fetchTextWithTimeout(checkUrl, { method: 'GET', headers, cache: 'no-store' }, 15_000);
    const res = out.res;
    const text = out.text;
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // Стандартизованная разборка
    const raw: any = data && typeof data === 'object' ? data : {};
    const ex = (raw.executor && typeof raw.executor === 'object') ? raw.executor : raw;
    const employmentKindRaw: string | undefined = (ex?.employment_kind as string | undefined) ?? (raw?.employment_kind as string | undefined);
    const status: string | undefined = (ex?.selfemployed_status as string | undefined)
      ?? (raw?.selfemployed_status as string | undefined)
      ?? (ex?.status as string | undefined)
      ?? (raw?.status as string | undefined);
    const readiness = (ex?.payment_readiness as string | undefined) ?? (raw?.payment_readiness as string | undefined);
    const fio = ex ? [ex.last_name, ex.first_name, ex.second_name].filter(Boolean).join(' ').trim() || null : null;
    const inn = (ex && (ex.inn || ex.tax_id)) ? String(ex.inn || ex.tax_id) : (raw && (raw.inn || raw.tax_id) ? String(raw.inn || raw.tax_id) : null);

    // Ошибки регистрации
    if (res.status === 404 || data == null) {
      return NextResponse.json({ ok: false, error: 'PARTNER_NOT_REGISTERED', message: 'Вы не завершили регистрацию в Рокет Ворке' }, { status: 400 });
    }
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && typeof (data as any).error === 'string') ? (data as any).error : 'Ошибка РВ';
      return NextResponse.json({ ok: false, error: 'RW_ERROR', message: msg }, { status: 400 });
    }

    // В счетах пропускаем только самозанятых (selfemployed) с валидированным статусом
    const kind = (employmentKindRaw ?? 'selfemployed').toLowerCase();
    if (kind !== 'selfemployed') {
      return NextResponse.json({ ok: false, error: 'PARTNER_NOT_VALIDATED_OR_NOT_SE_IP', message: 'Вы не можете принять оплату: вы не самозанятый (НПД)' }, { status: 400 });
    }
    // readiness может дать общий «готов к оплатам», но нам всё равно нужна валидация НПД
    if (!(status && status.toLowerCase() === 'validated')) {
      return NextResponse.json({ ok: false, error: 'PARTNER_NOT_VALIDATED', message: 'Вы не можете принять оплату: нет статуса самозанятого' }, { status: 400 });
    }

    // Доп. подсказки при readiness
    if (readiness && typeof readiness === 'string') {
      const r = readiness.toLowerCase();
      if (r === 'no_payments') {
        return NextResponse.json({ ok: false, error: 'PARTNER_NOT_REGISTERED', message: 'Вы не завершили регистрацию в Рокет Ворке' }, { status: 400 });
      }
      if (r === 'no_requisites') {
        return NextResponse.json({ ok: false, error: 'PARTNER_NO_PAYMENT_INFO', message: 'У вас нет платёжных реквизитов' }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, message: 'Все в порядке', fio, inn });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}



