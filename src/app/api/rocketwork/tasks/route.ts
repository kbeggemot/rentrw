import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDecryptedApiToken } from '@/server/secureStore';
import { getNextOrderId } from '@/server/orderStore';
import { saveTaskId, recordSaleOnCreate } from '@/server/taskStore';
import { getUserAgentSettings } from '@/server/userStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { getUserPayoutRequisites, getUserOrgInn } from '@/server/userStore';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from '@/server/ofdFerma';
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { enqueueOffsetJob, startOfdScheduleWorker } from '@/server/ofdScheduleWorker';
import { updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { headers as nextHeaders } from 'next/headers';
import { listWithdrawals } from '@/server/withdrawalStore';
import { recordWithdrawalCreate } from '@/server/withdrawalStore';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

type BodyIn = {
  amountRub: number; // сумма в рублях
  description: string;
  commissionPercent?: number; // 0..100 optional
  method: 'qr' | 'card';
  clientEmail?: string | null;
  agentSale?: boolean;
  agentPhone?: string;
  commissionType?: 'percent' | 'fixed';
  commissionValue?: number; // percent or fixed rubles depending on commissionType
  serviceEndDate?: string; // YYYY-MM-DD
};

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const body = (await req.json()) as BodyIn | any;
    // Withdrawal support
    if (body?.type === 'Withdrawal') {
      // Forced balance refresh skipped here; endpoint creates withdrawal task
      const inn = await getUserOrgInn(userId);
      const { bik, account } = await getUserPayoutRequisites(userId);
      const amountRub = Number(body?.amountRub || 0); // RW expects RUB, not cents
      if (!inn) return NextResponse.json({ error: 'NO_INN' }, { status: 400 });
      if (!bik || !account) return NextResponse.json({ error: 'NO_PAYOUT_REQUISITES' }, { status: 400 });
      // Prevent concurrent withdrawals: allow only if no active (non-final) withdrawal exists
      try {
        const history = await listWithdrawals(userId);
        const isFinal = (s: any) => {
          const st = String(s || '').toLowerCase();
          return st === 'paid' || st === 'error' || st === 'canceled' || st === 'cancelled' || st === 'failed' || st === 'refunded';
        };
        const active = history.find((it) => !isFinal(it?.status));
        if (active) {
          return NextResponse.json({ error: 'WITHDRAWAL_IN_PROGRESS', taskId: active.taskId }, { status: 409 });
        }
      } catch {}
      const payload = {
        type: 'Withdrawal',
        amount_gross: amountRub,
        executor_inn: inn,
        payment_info: {
          bank_account: {
            bic: bik,
            account_number: account,
          },
        },
      } as Record<string, unknown>;
      const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
      const url = new URL('tasks', base.endsWith('/') ? base : base + '/').toString();
      // Debug log of withdrawal request/response
      try {
        const dataDir = path.join(process.cwd(), '.data');
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, 'last_withdrawal_request.json'), JSON.stringify({ ts: new Date().toISOString(), url, payload }, null, 2), 'utf8');
      } catch {}
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
      const text = await res.text();
      try {
        const dataDir = path.join(process.cwd(), '.data');
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, 'last_withdrawal_response.json'), JSON.stringify({ ts: new Date().toISOString(), status: res.status, text }, null, 2), 'utf8');
      } catch {}
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const message = (data?.error as string | undefined) || text || 'External API error';
        return NextResponse.json({ error: message }, { status: res.status });
      }
      const taskId = (data?.task?.id ?? data?.id ?? data?.task_id) as string | number | undefined;
      if (taskId !== undefined) {
        try { await recordWithdrawalCreate(userId, taskId, amountRub); } catch {}
      }
      return NextResponse.json({ ok: true, task_id: taskId, data }, { status: 201 });
    }

    const amountRub = Number((body as BodyIn).amountRub);
    const commissionPercent = body.commissionPercent !== undefined ? Number(body.commissionPercent) : undefined;
    const description = String(body.description || '').trim();
    const method = body.method === 'card' ? 'card' : 'qr';
    const clientEmail = body.clientEmail && body.clientEmail.trim().length > 0
      ? body.clientEmail.trim()
      : 'ofd@rockethumans.com';

    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: 'Описание обязательно' }, { status: 400 });
    }
    if (commissionPercent !== undefined) {
      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        return NextResponse.json({ error: 'Некорректная комиссия' }, { status: 400 });
      }
    }

    const orderId = await getNextOrderId();
    const unitPriceCents = Math.round(amountRub * 100);
    const quantity = 1;
    let verifiedPartnerPhone: string | undefined;
    // If agent sale with partner phone provided, verify executor
    if (body.agentSale && body.agentPhone && body.agentPhone.trim().length > 0) {
      const partnerPhone = body.agentPhone.trim();
      const phoneDigits = partnerPhone.replace(/\D/g, '');
      const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;

      // 1) Сначала отправляем инвайт и дожидаемся ответа RW
      try {
        const inviteUrl = new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString();
        await fetch(inviteUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ phone: partnerPhone, with_framework_agreement: false }),
          cache: 'no-store',
        });
      } catch {}

      async function getExecutorById(id: string) {
        const url = new URL(`executors/${encodeURIComponent(id)}`, base.endsWith('/') ? base : base + '/').toString();
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          cache: 'no-store',
        });
        const text = await res.text();
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { url, res, data };
      }

      // Prefer digits-only lookup, then fallback to raw phone
      const digitsResp = await getExecutorById(phoneDigits);
      let chosen = digitsResp;
      if (!digitsResp.res.ok && digitsResp.res.status !== 404) {
        // if digits returned non-404 error, try raw as fallback
        const rawResp = await getExecutorById(partnerPhone);
        chosen = rawResp;
      } else if (digitsResp.res.status === 404) {
        // if digits 404, treat as not found (regardless of raw)
        chosen = digitsResp;
      }

      // persist last executor check for debugging
      try {
        const dataDir = path.join(process.cwd(), '.data');
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, 'last_executor_check.json'), JSON.stringify({ tried: { digits: { url: digitsResp.url, status: digitsResp.res.status }, chosen: { url: chosen.url, status: chosen.res.status } }, body: chosen.data }, null, 2), 'utf8');
      } catch {}

      const exRes = chosen.res;
      const exData = chosen.data;
      const notFoundByStatus = exRes.status === 404;
      const notFoundByBody = typeof exData === 'object' && exData && (
        /not\s*found/i.test(String((exData as any).error || '')) ||
        /not\s*found/i.test(String((exData as any).message || '')) ||
        (Array.isArray((exData as any).errors) && (exData as any).errors.some((e: unknown) => /исполнитель\s+не\s+найден/i.test(String(e || '')))) ||
        (exData as any).code === 404 ||
        (exData as any).executor === null ||
        (exData as any).executor === undefined ||
        ((exData as any).executor && (exData as any).executor.inn == null)
      );
      if (notFoundByStatus || notFoundByBody) {
        return NextResponse.json({ error: 'Партнёр не завершил регистрацию в Рокет Ворк' }, { status: 400 });
      }
      if (!exRes.ok) {
        const msg = (exData?.error as string | undefined) || 'Ошибка проверки исполнителя';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const seStatus: string | undefined = (exData?.selfemployed_status as string | undefined)
        ?? (exData?.executor?.selfemployed_status as string | undefined);
      if (!seStatus) {
        return NextResponse.json({ error: 'Партнёр не завершил регистрацию в Рокет Ворк' }, { status: 400 });
      }
      if (seStatus !== 'validated') {
        return NextResponse.json({ error: 'Партнёр не может принять оплату, так как не является самозанятым' }, { status: 400 });
      }
      // validated: ensure payment info is present
      const paymentInfo = (exData as any)?.executor?.payment_info ?? (exData as any)?.payment_info ?? null;
      if (paymentInfo == null) {
        return NextResponse.json({ error: 'Партнёр не может принять оплату, так как не указал свои платёжные данные' }, { status: 400 });
      }
      verifiedPartnerPhone = partnerPhone;
    }


    // Calculate net price after agent commission if applicable
    let netUnitPriceCents = unitPriceCents;
    if (body.agentSale) {
      if (body.commissionType === 'percent' && body.commissionValue !== undefined) {
        const commissionCents = Math.round(unitPriceCents * (Number(body.commissionValue) / 100));
        netUnitPriceCents = Math.max(0, unitPriceCents - commissionCents);
      } else if (body.commissionType === 'fixed' && body.commissionValue !== undefined) {
        const commissionCents = Math.round(Number(body.commissionValue) * 100);
        netUnitPriceCents = Math.max(0, unitPriceCents - commissionCents);
      }
    }

    // Формируем тело запроса к RocketWork: создание сделки для приёма платежа
    // Документация: tasks POST
    const payload: Record<string, unknown> = {
      description, // описание услуги на верхнем уровне — обязательно
      document_name: 'Типовой договор',
      title: 'Типовой договор',
      amount_gross: amountRub, // в рублях
      services: [
        {
          description, // описание позиции услуги
          unit_price_cents: netUnitPriceCents,
          quantity,
          total_price_cents: netUnitPriceCents * quantity,
          payment_method_for_ofd: 4,
        },
      ],
      acquiring_order: {
        type: method.toUpperCase(), // QR | CARD
        client_email: clientEmail,
        payment_purpose: description,
        vat: 'VatNo',
        with_ofd_receipt: true,
        order: String(orderId),
      },
    };

    // Map VAT selection from UI into RW acquiring_order.vat for downstream OFD
    const vatRate: string | undefined = typeof (body as any)?.vatRate === 'string' ? (body as any).vatRate : undefined;
    if (vatRate) {
      const map: Record<string, string> = {
        none: 'VatNo',
        '0': 'Vat0',
        '10': 'Vat10',
        '20': 'Vat20',
      };
      const rwVat = map[vatRate] || 'VatNo';
      (payload.acquiring_order as any).vat = rwVat;
    }

    if (body.agentSale) {
      // Place additional_commission_* at the ROOT of payload per RW requirements
      if (body.commissionType === 'percent' && body.commissionValue !== undefined) {
        (payload as Record<string, unknown>).additional_commission_value = `${String(body.commissionValue)}%`;
      } else if (body.commissionType === 'fixed' && body.commissionValue !== undefined) {
        (payload as Record<string, unknown>).additional_commission_value = String(body.commissionValue);
      }
      (payload as Record<string, unknown>).additional_commission_from = 'client';
      (payload as Record<string, unknown>).additional_commission_ofd_receipt = true;
      // Get agent description from user settings; require it
      const agentSettings = await getUserAgentSettings(userId);
      const agentDesc = agentSettings.agentDescription?.trim();
      if (!agentDesc) {
        return NextResponse.json({ error: 'Заполните описание ваших услуг, как Агента, в настройках' }, { status: 400 });
      }
      (payload as Record<string, unknown>).additional_commission_ofd_description = agentDesc;
      (payload as Record<string, unknown>).additional_commission_included = true;
      // Extra fields for agent sale
      if (verifiedPartnerPhone) {
        (payload as Record<string, unknown>).executor = verifiedPartnerPhone;
      }
      (payload as Record<string, unknown>).act_required = false;
      (payload as Record<string, unknown>).document_number = 'оферта';
      (payload as Record<string, unknown>).document_date = new Date().toISOString().slice(0, 10);
      (payload as Record<string, unknown>).autocomplete = true;
    } else if (commissionPercent !== undefined) {
      // Legacy optional agent commission percent when not using agent sale details
      (payload as Record<string, unknown>).additional_info = { agent_commission_percent: commissionPercent };
    }

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    const url = new URL('tasks', base.endsWith('/') ? base : base + '/').toString();

    // Persist last outgoing payload for debugging
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, 'last_task_request.json'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          url,
          order_id: orderId,
          payload,
        }, null, 2),
        'utf8'
      );
    } catch {}

    // Apply deferred full-settlement logic (serviceEndDate != today in Europe/Moscow)
    const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
    const endDate: string | undefined = typeof (body as any)?.serviceEndDate === 'string' ? (body as any).serviceEndDate : undefined;
    const needDeferredFull = endDate && endDate !== mskToday;
    if (needDeferredFull) {
      (payload.acquiring_order as any).with_ofd_receipt = false;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const mo = maybeObj as Record<string, unknown> | null;
      const errorsArr = Array.isArray(mo?.errors) ? (mo?.errors as string[]) : null;
      const message = (maybeObj?.error as string | undefined) || (errorsArr ? errorsArr.join('; ') : undefined) || text || 'External API error';
      return NextResponse.json({ error: message, details: maybeObj }, { status: res.status });
    }

    // Пытаемся извлечь id задачи из ответа и сохраняем (учитываем вариант task.id)
    const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    const taskObj = (maybeObj?.task as RocketworkTask | undefined) ?? undefined;
    const taskId = (taskObj?.id as number | string | undefined)
      ?? (maybeObj?.id as number | string | undefined)
      ?? (maybeObj?.task_id as number | string | undefined);
    if (taskId !== undefined) {
      await saveTaskId(taskId, orderId);
      // Save sale snapshot for the user
      const commissionValueForRecord = body.agentSale ? (body.commissionValue !== undefined ? Number(body.commissionValue) : undefined) : undefined;
      await recordSaleOnCreate({
        userId,
        taskId,
        orderId,
        amountGrossRub: amountRub,
        isAgent: !!body.agentSale,
        commissionType: body.agentSale ? body.commissionType : undefined,
        commissionValue: commissionValueForRecord,
        serviceEndDate: typeof (body as any)?.serviceEndDate === 'string' ? (body as any).serviceEndDate : undefined,
        vatRate: vatRate || undefined,
      });

      if (needDeferredFull) {
        try {
          // start worker (idempotent)
          startOfdScheduleWorker();
          // Build and send prepayment receipt now
          const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
          const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
          const hdrs = await nextHeaders();
          const proto = hdrs.get('x-forwarded-proto') || 'http';
          const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
          const secret = process.env.OFD_CALLBACK_SECRET || '';
          const callbackUrl = `${proto}://${host}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;
          const invoiceId = String(orderId);
          const usedVat = (vatRate || 'none') as any;
          if (body.agentSale) {
            // partner prepayment
            const partnerPhone = String(body.agentPhone || '').trim();
            const phoneDigits = partnerPhone.replace(/\D/g, '');
            let partnerInn: string | undefined;
            try {
              const exUrl = new URL(`executors/${encodeURIComponent(phoneDigits)}`, base.endsWith('/') ? base : base + '/').toString();
              const exRes = await fetch(exUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
              const exTxt = await exRes.text();
              let ex: any = null; try { ex = exTxt ? JSON.parse(exTxt) : null; } catch { ex = exTxt; }
              partnerInn = (ex?.executor?.inn as string | undefined) ?? (ex?.inn as string | undefined);
            } catch {}
            if (!partnerInn) throw new Error('NO_PARTNER_INN');
            const pp = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description, amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId, docType: 'IncomePrepayment', buyerEmail: clientEmail, invoiceId, callbackUrl, withPrepaymentItem: true });
            await fermaCreateReceipt(pp, { baseUrl, authToken: tokenOfd });
            await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: null });
            // enqueue offset at 12:00 MSK of endDate
            const dueDate = new Date(`${endDate}T09:00:00Z`); // 12:00 MSK ~= 09:00 UTC
            await enqueueOffsetJob({ userId, orderId, dueAt: dueDate.toISOString(), party: 'partner', partnerInn, description, amountRub, vatRate: usedVat, buyerEmail: clientEmail || undefined });
          } else {
            const orgInn = await getUserOrgInn(userId);
            const orgData = await getUserPayoutRequisites(userId);
            if (!orgInn) throw new Error('NO_ORG_INN');
            const pp = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description, amountRub: amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId, docType: 'IncomePrepayment', buyerEmail: clientEmail, invoiceId, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: orgData.orgName || 'Организация' } });
            await fermaCreateReceipt(pp, { baseUrl, authToken: tokenOfd });
            await updateSaleOfdUrlsByOrderId(userId, orderId, { ofdUrl: null });
            const dueDate = new Date(`${endDate}T09:00:00Z`); // 12:00 MSK
            await enqueueOffsetJob({ userId, orderId, dueAt: dueDate.toISOString(), party: 'org', description, amountRub, vatRate: usedVat, buyerEmail: clientEmail || undefined });
          }
        } catch {}
      }
    }

    return NextResponse.json({ ok: true, order_id: orderId, task_id: taskId, data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


