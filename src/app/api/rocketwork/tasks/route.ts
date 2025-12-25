import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDecryptedApiToken } from '@/server/secureStore';
import { resolveRwToken } from '@/server/rwToken';
import { getSelectedOrgInn } from '@/server/orgContext';
import { getNextOrderId } from '@/server/orderStore';
import { saveTaskId, recordSaleOnCreate } from '@/server/taskStore';
import { applyAgentCommissionToCart } from '@/lib/pricing';
import { getUserAgentSettings } from '@/server/userStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { getOrgPayoutRequisites } from '@/server/orgStore';
import { createResumeToken } from '@/server/payResumeStore';
// Removed immediate OFD creation on task creation; receipts are created on paid/transfered via postbacks
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { updateSaleOfdUrlsByOrderId } from '@/server/taskStore';
import { headers as nextHeaders } from 'next/headers';
import { readText } from '@/server/storage';
import { listWithdrawals, startWithdrawalPoller } from '@/server/withdrawalStore';
import { recordWithdrawalCreate } from '@/server/withdrawalStore';
import { listProductsForOrg } from '@/server/productsStore';
import { appendRwError, writeRwLastRequest } from '@/server/rwAudit';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getTokenForOrg } from '@/server/orgStore';
import { findLinkByCode } from '@/server/paymentLinkStore';
import { fetchTextWithTimeout, fetchWithTimeout, fireAndForgetFetch } from '@/server/http';

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
  cartItems?: Array<{ id?: string | null; title: string; price: number; qty: number; vat?: string }> | null;
  agentDescription?: string | null;
};

export async function POST(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const tgCookieMatch = /(?:^|;\s*)tg_uid=([^;]+)/.exec(cookie || '');
    const tgUserFromCookie = tgCookieMatch ? decodeURIComponent(tgCookieMatch[1]) : null;
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const body = (await req.json()) as BodyIn | any;

    // Prefer org from header/body/link to support Telegram WebView (no cookies)
    let preferredInn: string | null = null;
    try {
      const hdrInn = req.headers.get('x-org-inn');
      if (hdrInn && hdrInn.trim().length > 0) preferredInn = hdrInn.replace(/\D/g, '');
    } catch {}
    if (!preferredInn) {
      try { const bInn = typeof body?.orgInn === 'string' || typeof body?.orgInn === 'number' ? String(body.orgInn) : null; preferredInn = bInn ? bInn.replace(/\D/g, '') : null; } catch {}
    }
    if (!preferredInn) {
      try { const code = typeof body?.linkCode === 'string' ? String(body.linkCode) : null; if (code) { const link = await findLinkByCode(code); const li = (link?.orgInn || '').toString().replace(/\D/g, ''); preferredInn = li || null; } } catch {}
    }

    let token: string | null = null;
    let orgInn: string | null = null;
    let fingerprint: string | null = null;
    if (preferredInn) {
      try {
        const t = await getTokenForOrg(preferredInn, userId);
        if (t) { token = t; orgInn = preferredInn; }
      } catch {}
    }
    if (!token) {
      const res = await resolveRwToken(req, userId);
      token = res.token; orgInn = res.orgInn; fingerprint = res.fingerprint;
    }
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });

    // Withdrawal support
    if (body?.type === 'Withdrawal') {
      // Forced balance refresh skipped here; endpoint creates withdrawal task
      const inn = orgInn && String(orgInn).replace(/\D/g, '');
      if (!inn) return NextResponse.json({ error: 'NO_INN' }, { status: 400 });
      const { bik, account } = await getOrgPayoutRequisites(inn);
      const amountRub = Number(body?.amountRub || 0); // RW expects RUB, not cents
      if (!bik || !account) return NextResponse.json({ error: 'NO_PAYOUT_REQUISITES' }, { status: 400 });
      // Prevent concurrent withdrawals: allow only if no active (non-final) withdrawal exists
      try {
        const history = await listWithdrawals(userId, inn);
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
      const out = await fetchTextWithTimeout(
        url,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' },
        20_000
      );
      const res = out.res;
      const text = out.text;
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
        try { await recordWithdrawalCreate(userId, taskId, amountRub, inn || null); startWithdrawalPoller(userId, taskId); } catch {}
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
    // Global business rule: минимальная сумма оплаты — 10 ₽
    const MIN_AMOUNT_RUB = 10;
    if (body.agentSale) {
      const cType = body.commissionType as 'percent' | 'fixed' | undefined;
      const cVal = typeof body.commissionValue === 'number' ? Number(body.commissionValue) : undefined;
      if (cType && typeof cVal === 'number' && Number.isFinite(cVal)) {
        const retainedRub = cType === 'percent' ? amountRub * (cVal / 100) : cVal;
        const netRub = amountRub - retainedRub;
        if (!(netRub >= MIN_AMOUNT_RUB)) {
          return NextResponse.json({ error: 'Сумма оплаты за вычетом комиссии должна быть не менее 10 рублей' }, { status: 400 });
        }
      }
    } else {
      if (!(amountRub >= MIN_AMOUNT_RUB)) {
        return NextResponse.json({ error: 'Сумма должна быть не менее 10 рублей' }, { status: 400 });
      }
    }

    // Business rule: самозанятый не может реализовывать позиции с НДС (только Без НДС)
    if (body.agentSale) {
      const vr = typeof (body as any)?.vatRate === 'string' ? String((body as any).vatRate) : undefined;
      if (vr && vr !== 'none') {
        return NextResponse.json({ error: 'AGENT_VAT_FORBIDDEN' }, { status: 400 });
      }
      try {
        const org = (orgInn as string | null) ? String(orgInn).replace(/\D/g, '') : null;
        if (org && Array.isArray((body as any)?.cartItems) && (body as any).cartItems.length > 0) {
          const catalog = await listProductsForOrg(org);
          const hasVat = (body as any).cartItems.some((ci: any) => {
            const id = ci?.id ? String(ci.id) : null;
            const title = (ci?.title || '').toString().trim().toLowerCase();
            const p = catalog.find((x) => (id && String(x.id) === id) || (title && x.title.toLowerCase() === title));
            return p && p.vat !== 'none';
          });
          if (hasVat) {
            return NextResponse.json({ error: 'AGENT_VAT_FORBIDDEN' }, { status: 400 });
          }
        }
      } catch {}
    }
    // Cart mode: when positions are provided, description is not required
    const rawCart: Array<{ id?: string | null; title: string; price: number; qty: number; vat?: string }> | null = Array.isArray((body as any)?.cartItems) ? (body as any).cartItems : null;
    if (rawCart && rawCart.length > 0) {
      let normalized = rawCart
        .map((c: any) => ({ id: c?.id ?? null, title: String(c?.title || ''), price: Number(c?.price || 0), qty: Number(c?.qty || 0), vat: (['none','0','5','7','10','20'].includes(String(c?.vat)) ? String(c?.vat) : undefined) }))
        .filter((c) => c.title.trim().length > 0 && Number.isFinite(c.price) && Number.isFinite(c.qty) && c.price > 0 && c.qty > 0);
      if (normalized.length === 0) {
        return NextResponse.json({ error: 'CART_EMPTY' }, { status: 400 });
      }
      // Enrich with instantResult from product catalog at the moment of sale
      try {
        const inn = orgInn && String(orgInn).replace(/\D/g, '');
        if (inn) {
          const catalog = await listProductsForOrg(inn);
          normalized = normalized.map((it) => {
            const prod = catalog.find((p) => (it.id && String(p.id) === String(it.id)) || (p.title && String(p.title).toLowerCase() === it.title.toLowerCase())) as any || null;
            const instant = (prod?.instantResult && String(prod.instantResult).trim().length > 0) ? String(prod.instantResult).trim() : undefined;
            return instant ? { ...it, instantResult: instant } : it;
          }) as any;
        }
      } catch {}
      // If agent sale with commission: adjust prices but keep metadata (vat, id, instantResult)
      if (body.agentSale && body.commissionType && typeof body.commissionValue === 'number') {
        try {
          const adjusted = applyAgentCommissionToCart(normalized.map((n:any)=>({ title: n.title, price: n.price, qty: n.qty })), body.commissionType, Number(body.commissionValue)).adjusted;
          normalized = normalized.map((n, i) => ({ ...n, price: adjusted[i]?.price ?? n.price }));
        } catch {}
      }
      (body as any).cartItems = normalized;
    } else {
      if (!description) {
        return NextResponse.json({ error: 'Описание обязательно' }, { status: 400 });
      }
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
        fireAndForgetFetch(inviteUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ phone: partnerPhone, with_framework_agreement: false }),
          cache: 'no-store',
        }, 15_000);
      } catch {}

      async function getExecutorById(id: string) {
        const url = new URL(`executors/${encodeURIComponent(id)}`, base.endsWith('/') ? base : base + '/').toString();
        const out = await fetchTextWithTimeout(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          cache: 'no-store',
        }, 15_000);
        const res = out.res;
        const text = out.text;
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
      // Use RW payment_readiness for both Self-Employed and Entrepreneurs
      const exObj: any = (exData && typeof exData === 'object' && (exData as any).executor) ? (exData as any).executor : exData;
      const employmentKindRw: string | undefined = (exObj?.employment_kind as string | undefined) ?? (exData as any)?.employment_kind;
      const readinessRaw: string | undefined = (exObj?.payment_readiness as string | undefined) ?? (exData as any)?.payment_readiness;
      const readiness = readinessRaw ? String(readinessRaw).toLowerCase() : undefined;
      if (readiness === 'no_payments') {
        return NextResponse.json({ error: 'Партнёр не завершил регистрацию в Рокет Ворк' }, { status: 400 });
      }
      if (readiness === 'no_requisites') {
        return NextResponse.json({ error: 'Партнёр не может принять оплату, так как не указал свои платёжные данные' }, { status: 400 });
      }
      // Allow when all_is_well or no_tax_payment. If readiness is missing, fallback to old checks for SE only
      if (!(readiness === 'all_is_well' || readiness === 'no_tax_payment')) {
        const seStatus: string | undefined = (exData?.selfemployed_status as string | undefined)
          ?? (exData?.executor?.selfemployed_status as string | undefined);
        if ((employmentKindRw ?? 'selfemployed') === 'selfemployed') {
          if (!seStatus) return NextResponse.json({ error: 'Партнёр не завершил регистрацию в Рокет Ворк' }, { status: 400 });
          if (seStatus !== 'validated') return NextResponse.json({ error: 'Партнёр не может принять оплату, так как не является самозанятым' }, { status: 400 });
          const paymentInfo = (exData as any)?.executor?.payment_info ?? (exData as any)?.payment_info ?? null;
          if (paymentInfo == null) return NextResponse.json({ error: 'Партнёр не может принять оплату, так как не указал свои платёжные данные' }, { status: 400 });
        }
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
    // Derive RW description from cart titles when cart provided (truncate to 256)
    const cartTitlesJoined = (() => {
      const items = Array.isArray((body as any)?.cartItems) ? (body as any).cartItems : null;
      if (!items || items.length === 0) return null;
      const titles = items.map((i: any) => String(i?.title || '').trim()).filter((t: string) => t.length > 0);
      if (titles.length === 0) return null;
      return titles.join(', ').slice(0, 256);
    })();

    const rwDesc = cartTitlesJoined || description;

    const payload: Record<string, unknown> = {
      description: rwDesc, // описание услуги на верхнем уровне — обязательно
      document_name: 'Типовой договор',
      title: 'Типовой договор',
      amount_gross: amountRub, // в рублях
      services: [
        {
          description: rwDesc, // описание позиции услуги
          unit_price_cents: netUnitPriceCents,
          quantity,
          total_price_cents: netUnitPriceCents * quantity,
          payment_method_for_ofd: 4,
        },
      ],
      acquiring_order: {
        type: method.toUpperCase(), // QR | CARD
        client_email: clientEmail,
        payment_purpose: rwDesc,
        vat: 'VatNo',
        // мы сами формируем чеки в ОФД (и для "сегодня", и для отложенных)
        with_ofd_receipt: false,
        order: (process.env.NODE_ENV !== 'production') ? `0000${String(orderId)}` : String(orderId),
      },
    };
    // Idempotency: attach external id key to prevent duplicate task creation server-side
    try {
      const idemKey = `sale:${userId}:${String(orgInn || '')}:${String(orderId)}`;
      (payload as any).external_id = idemKey;
    } catch {}

    // Inject redirect_url to acquiring_order for bank success redirect
    try {
      const hdrs = await nextHeaders();
      const proto = hdrs.get('x-forwarded-proto') || 'http';
      const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
      // Create one-time resume token bound to userId+orderId to help payer browser resume polling
      const tokenForResume = await createResumeToken(userId, orderId);
      const successUrl = `${proto}://${host}/link/success?sid=${encodeURIComponent(tokenForResume)}`;
      (payload.acquiring_order as any).redirect_url = successUrl;
    } catch {}

    // Map VAT selection from UI into RW acquiring_order.vat for downstream OFD
    const vatRate: string | undefined = typeof (body as any)?.vatRate === 'string' ? (body as any).vatRate : undefined;
    if (vatRate) {
      const map: Record<string, string> = {
        none: 'VatNo',
        '0': 'Vat0',
        '5': 'Vat5',
        '7': 'Vat7',
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
      const agentSettings = await getUserAgentSettings(userId, orgInn || undefined);
      const agentDesc = agentSettings.agentDescription?.trim();
      if (!agentDesc) {
        return NextResponse.json({ error: 'Заполните описание ваших услуг, как Агента, в настройках' }, { status: 400 });
      }
      // Normalize description for OFD: collapse whitespace and restrict length to avoid rejection
      const agentDescNormalized = agentDesc.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 200);
      (payload as Record<string, unknown>).additional_commission_ofd_description = agentDescNormalized;
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

    // Persist last outgoing payload for debugging (S3-compatible) without blocking the main flow
    try {
      void writeRwLastRequest({ ts: new Date().toISOString(), scope: 'tasks:create', method: 'POST', url, requestBody: payload, userId }).catch(() => void 0);
    } catch {}

    // Apply deferred full-settlement logic (serviceEndDate != today in Europe/Moscow)
    const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
    const endDate: string | undefined = typeof (body as any)?.serviceEndDate === 'string' ? (body as any).serviceEndDate : undefined;
    const needDeferredFull = endDate && endDate !== mskToday;
    if (needDeferredFull) {
      (payload.acquiring_order as any).with_ofd_receipt = false;
    }

    let res: Response;
    let text = '';
    try {
      const out = await fetchTextWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      }, 20_000);
      res = out.res;
      text = out.text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try { await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:create', method: 'POST', url, status: null, requestBody: payload, error: msg, userId }); } catch {}
      return NextResponse.json({ error: `NETWORK_ERROR: ${msg}` }, { status: 502 });
    }
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const mo = maybeObj as Record<string, unknown> | null;
      const errorsArr = Array.isArray(mo?.errors) ? (mo?.errors as string[]) : null;
      const message = (maybeObj?.error as string | undefined) || (errorsArr ? errorsArr.join('; ') : undefined) || text || 'External API error';
      try { await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:create', method: 'POST', url, status: res.status, requestBody: payload, responseText: text, error: message, userId }); } catch {}
      return NextResponse.json({ error: message, details: maybeObj }, { status: res.status });
    }

    // Пытаемся извлечь id задачи из ответа и сохраняем (учитываем вариант task.id)
    const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    const taskObj = (maybeObj?.task as RocketworkTask | undefined) ?? undefined;
    const taskId = (taskObj?.id as number | string | undefined)
      ?? (maybeObj?.id as number | string | undefined)
      ?? (maybeObj?.task_id as number | string | undefined);
    if (taskId !== undefined) {
      // Skip slow legacy store updates on the critical path (S3/monolith). Best-effort.
      try { void saveTaskId(taskId, orderId).catch(() => void 0); } catch {}
      // Save sale snapshot for the user
      const commissionValueForRecord = body.agentSale ? (body.commissionValue !== undefined ? Number(body.commissionValue) : undefined) : undefined;
      const resolvedPayerTgId = (() => { const v = (body as any)?.payerTgId; const b = (typeof v === 'string' && v.trim().length > 0) ? String(v).trim() : null; return b || (tgUserFromCookie && tgUserFromCookie.trim().length > 0 ? tgUserFromCookie : null); })();
      // Resolve document name by hash if provided
      let resolvedDocName: string | null = null;
      try {
        const hash = (typeof (body as any)?.termsDocHash === 'string' && (body as any).termsDocHash.trim().length > 0) ? String((body as any).termsDocHash).trim() : '';
        if (hash) {
          const { findDocByHash } = await import('@/server/docsStore');
          const meta = await findDocByHash(hash);
          resolvedDocName = (meta?.name && String(meta.name).trim().length > 0) ? meta.name : null;
        }
      } catch {}

      // Persist sale snapshot in background (do not block payer UX on storage/S3 latency)
      void recordSaleOnCreate({
        userId,
        taskId,
        orderId,
        linkCode: (typeof (body as any)?.linkCode === 'string' && (body as any).linkCode.trim().length > 0) ? String((body as any).linkCode).trim() : undefined,
        orgInn: orgInn ?? null,
        rwTokenFp: fingerprint ?? null,
        payerTgId: resolvedPayerTgId,
        payerTgFirstName: (typeof (body as any)?.payerTgFirstName === 'string' && (body as any).payerTgFirstName.trim().length > 0) ? String((body as any).payerTgFirstName).trim() : null,
        payerTgLastName: (typeof (body as any)?.payerTgLastName === 'string' && (body as any).payerTgLastName.trim().length > 0) ? String((body as any).payerTgLastName).trim() : null,
        payerTgUsername: (typeof (body as any)?.payerTgUsername === 'string' && (body as any).payerTgUsername.trim().length > 0) ? String((body as any).payerTgUsername).trim() : null,
        clientEmail,
        description,
        amountGrossRub: amountRub,
        isAgent: !!body.agentSale,
        commissionType: body.agentSale ? body.commissionType : undefined,
        commissionValue: commissionValueForRecord,
        serviceEndDate: typeof (body as any)?.serviceEndDate === 'string' ? (body as any).serviceEndDate : undefined,
        vatRate: vatRate || undefined,
        cartItems: (Array.isArray((body as any)?.cartItems) ? (body as any).cartItems : null) as any,
        agentDescription: (typeof (body as any)?.agentDescription === 'string' ? (body as any).agentDescription : null) ?? null,
        partnerPhone: (body.agentSale && typeof (body as any)?.agentPhone === 'string' && (body as any).agentPhone.trim().length > 0) ? String((body as any).agentPhone).trim() : null,
        // сейчас ФИО не передаётся — оставляем null (можем расширить форму и API позднее)
        partnerFio: null,
        termsDocHash: (typeof (body as any)?.termsDocHash === 'string' && (body as any).termsDocHash.trim().length > 0) ? String((body as any).termsDocHash).trim() : null,
        termsDocName: (typeof (body as any)?.termsDocName === 'string' && (body as any).termsDocName.trim().length > 0) ? String((body as any).termsDocName).trim() : (resolvedDocName ?? null),
      }).catch(() => void 0);

      // Audit: record how payerTgId/linkCode were resolved
      try { void appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'create/meta', data: { linkCode: (body as any)?.linkCode ?? null, payerTgId_body: (body as any)?.payerTgId ?? null, payerTgId_cookie: tgUserFromCookie ?? null, payerTgId_saved: resolvedPayerTgId ?? null } }).catch(() => void 0); } catch {}

      // Removed: prepayment receipt creation and offset scheduling at creation time
      // Ensure subscription in background (do not block payment link creation)
      try {
        void (async () => {
          try {
            const hdrs = await nextHeaders();
            const rawProto = hdrs.get('x-forwarded-proto') || 'http';
            const cbBaseHost = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
            const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(cbBaseHost || '');
            const cbBaseProto = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
            const callbackBase = `${cbBaseProto}://${cbBaseHost}`;
            // Read our cached subs to decide whether ensure is needed
            let hasTasks = false, hasExecutors = false;
            try {
              const txt = await readText(`.data/postback_cache_${userId}.json`);
              const d = txt ? JSON.parse(txt) : {};
              const arr = Array.isArray(d?.subscriptions) ? d.subscriptions : [];
              const cb = new URL(`/api/rocketwork/postbacks/${encodeURIComponent(userId)}`, callbackBase).toString();
              for (const s of arr) {
                const subs = Array.isArray(s?.subscribed_on) ? s.subscribed_on.map((x: any)=>String(x)) : [];
                const uri = String(s?.callback_url ?? s?.uri ?? '');
                if (uri === cb) {
                  if (subs.includes('tasks')) hasTasks = true;
                  if (subs.includes('executors')) hasExecutors = true;
                }
              }
            } catch {}
            if (!hasTasks || !hasExecutors) {
              const query = !hasTasks && !hasExecutors ? '' : (!hasTasks ? '&stream=tasks' : '&stream=executors');
              const upsertUrl = new URL(`/api/rocketwork/postbacks?ensure=1${query}`, callbackBase).toString();
              fireAndForgetFetch(
                upsertUrl,
                { method: 'GET', headers: { cookie: `session_user=${encodeURIComponent(userId)}` }, cache: 'no-store' },
                15_000
              );
            }
          } catch {}
        })().catch(() => void 0);
      } catch {}
    }

    return NextResponse.json({ ok: true, order_id: orderId, task_id: taskId, data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


