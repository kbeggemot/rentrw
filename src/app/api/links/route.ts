import { NextResponse } from 'next/server';
import { createPaymentLink, listPaymentLinks, listPaymentLinksForOrg, listAllPaymentLinksForOrg, isCodeTaken } from '@/server/paymentLinkStore';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { listProductsForOrg } from '@/server/productsStore';
import { getSelectedOrgInn } from '@/server/orgContext';
import { partnerExists, upsertPartnerFromValidation } from '@/server/partnerStore';
import { applyAgentCommissionToCart } from '@/lib/pricing';
import { fireAndForgetFetch } from '@/server/http';

export const runtime = 'nodejs';

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
    // optional: live uniqueness check for vanity code
    const url = new URL(req.url);
    const check = url.searchParams.get('check');
    if (check) {
      const candidate = String(check).trim().toLowerCase();
      const taken = await (await import('@/server/paymentLinkStore')).isCodeTaken(candidate);
      // Reserved sub-routes under /link
      const reserved = new Set(['new', 'success', 's']);
      const isReserved = reserved.has(candidate);
      return NextResponse.json({ code: candidate, taken: taken || isReserved, reserved: isReserved });
    }
    const inn = getSelectedOrgInn(req);
    const { getShowAllDataFlag } = await import('@/server/userStore');
    const showAll = await getShowAllDataFlag(userId);
    const itemsRaw = inn ? (showAll ? await listAllPaymentLinksForOrg(inn) : await listPaymentLinksForOrg(userId, inn)) : await listPaymentLinks(userId);
    // Pagination: limit + cursor (supports created_desc and code_* sorts)
    const limitParam = Number(url.searchParams.get('limit') || '');
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
    const cursor = url.searchParams.get('cursor');
    const sortParam = String(url.searchParams.get('sort') || '');
    const sortMode: 'created_desc' | 'code_asc' | 'code_desc' = (sortParam === 'code_asc' || sortParam === 'code_desc') ? (sortParam as any) : 'created_desc';

    const safeCode = (v: any) => String(v || '');
    const sorted = sortMode === 'created_desc'
      ? [...itemsRaw].sort((a: any, b: any) => {
          const at = Date.parse(a?.createdAt || 0);
          const bt = Date.parse(b?.createdAt || 0);
          if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
          if (!Number.isFinite(at)) return 1;
          if (!Number.isFinite(bt)) return -1;
          if (bt !== at) return bt - at; // latest first
          return safeCode(b.code).localeCompare(safeCode(a.code));
        })
      : (sortMode === 'code_asc'
        ? [...itemsRaw].sort((a: any, b: any) => safeCode(a.code).localeCompare(safeCode(b.code)))
        : [...itemsRaw].sort((a: any, b: any) => safeCode(b.code).localeCompare(safeCode(a.code))));

    let startIndex = 0;
    if (cursor) {
      if (sortMode === 'created_desc') {
        const [curIso, curCode] = String(cursor).split('|');
        const curTs = Date.parse(curIso || '') || 0;
        let i = 0;
        while (i < sorted.length) {
          const it = sorted[i];
          const ts = Date.parse((it as any)?.createdAt || 0) || 0;
          if (ts < curTs || (ts === curTs && safeCode((it as any)?.code) < safeCode(curCode))) break;
          i += 1;
        }
        startIndex = i;
      } else if (sortMode === 'code_asc') {
        const cur = safeCode(cursor);
        let i = 0;
        while (i < sorted.length) {
          const it = sorted[i];
          if (safeCode((it as any)?.code) > cur) break;
          i += 1;
        }
        startIndex = i;
      } else if (sortMode === 'code_desc') {
        const cur = safeCode(cursor);
        let i = 0;
        while (i < sorted.length) {
          const it = sorted[i];
          if (safeCode((it as any)?.code) < cur) break;
          i += 1;
        }
        startIndex = i;
      }
    }
    const pageItems = sorted.slice(startIndex, startIndex + limit);
    let nextCursor: string | null = null;
    if ((startIndex + limit) < sorted.length && pageItems.length > 0) {
      if (sortMode === 'created_desc') {
        nextCursor = `${pageItems[pageItems.length - 1].createdAt}|${pageItems[pageItems.length - 1].code}`;
      } else {
        nextCursor = safeCode(pageItems[pageItems.length - 1].code);
      }
    }
    return NextResponse.json({ items: pageItems, nextCursor });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const inn = getSelectedOrgInn(req);
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim();
    const sumMode = (body?.sumMode === 'fixed' ? 'fixed' : 'custom') as 'custom' | 'fixed';
    // Normalize amount from UI: accept both comma and dot, then coerce to number
    let amountRub: number | null = null;
    if (sumMode === 'fixed') {
      const raw = String(body?.amountRub ?? '').trim();
      const normalized = raw.replace(/\s+/g, '').replace(/,/g, '.');
      const n = Number(normalized);
      amountRub = Number.isFinite(n) ? n : NaN;
    }
    const vatRate = (['none','0','5','7','10','20'].includes(String(body?.vatRate)) ? String(body?.vatRate) : 'none') as 'none'|'0'|'5'|'7'|'10'|'20';
    const isAgent = !!body?.isAgent;
    // Vanity code (optional)
    const preferredRaw: string = typeof body?.preferredCode === 'string' ? body.preferredCode : '';
    let preferredCode: string | null = preferredRaw ? preferredRaw.trim() : null;
    if (preferredCode && preferredCode.length > 0) {
      // normalize: spaces->dash, transliterate basic Cyrillic, lowercase
      const trMap: Record<string, string> = { 'ё':'yo','й':'y','ц':'ts','у':'u','к':'k','е':'e','н':'n','г':'g','ш':'sh','щ':'sch','з':'z','х':'h','ъ':'','ф':'f','ы':'y','в':'v','а':'a','п':'p','р':'r','о':'o','л':'l','д':'d','ж':'zh','э':'e','я':'ya','ч':'ch','с':'s','м':'m','и':'i','т':'t','ь':'','б':'b','ю':'yu' };
      const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[а-яё]/g, (ch) => trMap[ch] ?? ch).replace(/[^a-z0-9-]/g, '');
      preferredCode = normalize(preferredCode);
      if (!/^[a-z0-9-]+$/.test(preferredCode)) return NextResponse.json({ error: 'VANITY_INVALID' }, { status: 400 });
      if (preferredCode.length < 3) return NextResponse.json({ error: 'VANITY_TOO_SHORT' }, { status: 400 });
      if (preferredCode.length > 30) return NextResponse.json({ error: 'VANITY_TOO_LONG' }, { status: 400 });
      // blacklist simple set (sexual/obscene); merge with optional ENV VANITY_BLACKLIST (comma-separated)
      const blacklistBase = [
        'bad','fuck','shit','pizda','huy','blyad','whore','suka','deb','лох','mudak','govno',
        // sexual explicit (ru/en + translit)
        'sex','seks','porno','porn','porr','xxx','intim','bdsm','fetish','fetishy','swing',
        'anal','oral','minet','kunilingus','kuni','erotic','ero',
        'секс','порно','порево','эротик','эротика','интим','минет','кунилингус','анал','оральн',
        'проститут','шлюх','шлюха','бордель','стриптиз',
        // lgbt-related terms (ru/en + translit)
        'lgbt','lgbtq','lgbtqia','gay','gey','gei','lesbian','lez','lezb','queer','trans','transgender','transex','nonbinary','non-binary','nb','pride','rainbow',
        'гей','геи','гей','лесби','лесбиян','квир','транс','трансгендер','транссексу','небинар','прайд','радуга'
      ];
      const envExtra = (process.env.VANITY_BLACKLIST || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
      const blacklist = [...new Set([...blacklistBase, ...envExtra])];
      if (blacklist.some((w) => preferredCode!.includes(w))) return NextResponse.json({ error: 'VANITY_FORBIDDEN' }, { status: 400 });
      // reserved routes under /link
      const reserved = new Set(['new', 'success', 's']);
      if (reserved.has(preferredCode)) return NextResponse.json({ error: 'VANITY_TAKEN' }, { status: 409 });
      if (await isCodeTaken(preferredCode)) return NextResponse.json({ error: 'VANITY_TAKEN' }, { status: 409 });
    }
    const commissionType = isAgent && (body?.commissionType === 'fixed' || body?.commissionType === 'percent') ? body?.commissionType : null;
    const commissionValue = isAgent && typeof body?.commissionValue === 'number' ? Number(body?.commissionValue) : null;
    const partnerPhone = isAgent ? (String(body?.partnerPhone || '').trim() || null) : null;
    const method = (body?.method === 'qr' || body?.method === 'card') ? body?.method : 'any';
    if (!title) return NextResponse.json({ error: 'TITLE_REQUIRED' }, { status: 400 });
    // description is required only for "free service" mode; when cartItems present, it's optional
    let cartItems = Array.isArray(body?.cartItems) ? body.cartItems : null;
    if (!cartItems && !description) return NextResponse.json({ error: 'DESCRIPTION_REQUIRED' }, { status: 400 });
    if (sumMode === 'fixed' && (!Number.isFinite(amountRub) || Number(amountRub) <= 0)) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 });
    // Validate agent fields and partner in RW when isAgent
    if (isAgent) {
      if (!commissionType) return NextResponse.json({ error: 'COMMISSION_TYPE_REQUIRED' }, { status: 400 });
      if (commissionValue == null || !Number.isFinite(commissionValue)) return NextResponse.json({ error: 'COMMISSION_VALUE_REQUIRED' }, { status: 400 });
      if (commissionType === 'percent' && (commissionValue < 0 || commissionValue > 100)) return NextResponse.json({ error: 'COMMISSION_PERCENT_RANGE' }, { status: 400 });
      if (commissionType === 'fixed' && commissionValue <= 0) return NextResponse.json({ error: 'COMMISSION_FIXED_POSITIVE' }, { status: 400 });
      if (!partnerPhone) return NextResponse.json({ error: 'PARTNER_PHONE_REQUIRED' }, { status: 400 });
      // Check partner via RW similar to main flow
      try {
        const inn = getSelectedOrgInn(req);
        const { token } = await resolveRwTokenWithFingerprint(req, userId, inn, null);
        if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const digits = String(partnerPhone).replace(/\D/g, '');
        // invite best-effort (fire-and-forget with timeout + body drain to avoid undici socket leaks)
        try {
          const inviteUrl = new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString();
          fireAndForgetFetch(inviteUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ phone: digits, with_framework_agreement: false }), cache: 'no-store' }, 15_000);
        } catch {}
        const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await res.text();
        let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
        if (res.status === 404 || (typeof data === 'object' && data && ((data.error && /not\s*found/i.test(String(data.error))) || data.executor == null || (data.executor && data.executor.inn == null)))) {
          return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
        }
        if (!res.ok) {
          return NextResponse.json({ error: (data?.error as string) || 'RW_ERROR' }, { status: 400 });
        }
        const status: string | undefined = (data?.executor?.selfemployed_status as string | undefined) ?? (data?.selfemployed_status as string | undefined);
        const employmentKind: string | undefined = (data?.executor?.employment_kind as string | undefined) ?? (data?.employment_kind as string | undefined);
        const isEntrepreneur = employmentKind === 'entrepreneur';
        const isSEValidated = Boolean(status && status === 'validated' && ((employmentKind ?? 'selfemployed') === 'selfemployed'));
        if (!(isEntrepreneur || isSEValidated)) {
          if ((employmentKind ?? 'selfemployed') === 'selfemployed' && status && status !== 'validated') {
            return NextResponse.json({ error: 'PARTNER_NOT_VALIDATED' }, { status: 400 });
          }
          return NextResponse.json({ error: 'PARTNER_NOT_VALIDATED_OR_NOT_SE_IP' }, { status: 400 });
        }
        // Readiness-based gate: do not require payment_info for entrepreneurs
        const readinessRaw: string | undefined = ((data?.executor?.payment_readiness as string | undefined) ?? (data as any)?.payment_readiness) as any;
        const readiness = readinessRaw ? String(readinessRaw).toLowerCase() : undefined;
        if (readiness === 'no_payments') {
          return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
        }
        if (readiness === 'no_requisites') {
          return NextResponse.json({ error: 'PARTNER_NO_PAYMENT_INFO' }, { status: 400 });
        }
        // If readiness is missing — do not block по payment_info ни для кого (см. договорённость)
        
        // Auto-add/update partner if validation successful
        await upsertPartnerFromValidation(userId, digits, data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'CHECK_ERROR';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    // Rule: НДС запрещён только для самозанятых (SE validated). Для ИП — разрешён.
    if (isAgent) {
      try {
        const inn = getSelectedOrgInn(req);
        const { token } = await resolveRwTokenWithFingerprint(req, userId, inn, null);
        if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const digits = String(partnerPhone || '').replace(/\D/g, '');
        const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await res.text();
        let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
        if (res.status === 404) return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
        if (!res.ok) return NextResponse.json({ error: (data?.error as string) || 'RW_ERROR' }, { status: 400 });
        const seStatus: string | undefined = (data?.executor?.selfemployed_status as string | undefined) ?? (data?.selfemployed_status as string | undefined);
        const employmentKind: string | undefined = (data?.executor?.employment_kind as string | undefined) ?? (data?.employment_kind as string | undefined);
        const isEntrepreneur = employmentKind === 'entrepreneur';
        const isSEValidated = Boolean(seStatus && seStatus === 'validated' && ((employmentKind ?? 'selfemployed') === 'selfemployed'));
        // Fail-closed: НДС разрешён только для ИП. Если НДС присутствует и партнёр не ИП — блокируем.
        const vr = String(body?.vatRate || 'none');
        let cartHasVat = false;
        if (Array.isArray(cartItems) && cartItems.length > 0) {
          try {
            const catalog = inn ? await listProductsForOrg(inn) : [];
            cartHasVat = cartItems.some((ci: any) => {
              const id = ci?.id ? String(ci.id) : null;
              const title = (ci?.title || '').toString().trim().toLowerCase();
              const p = catalog.find((x) => (id && String(x.id) === id) || (title && x.title.toLowerCase() === title));
              return p && p.vat !== 'none';
            });
          } catch {}
        }
        const vatPresent = (vr !== 'none') || cartHasVat;
        if (vatPresent && !isEntrepreneur) {
          return NextResponse.json({ error: 'AGENT_VAT_FORBIDDEN' }, { status: 400 });
        }
        // Save/refresh partner entry
        await upsertPartnerFromValidation(userId, digits, data, inn ?? null);
      } catch {}
    }
    // If cart + agent: avoid double-lowering.
    if (Array.isArray(cartItems) && cartItems.length > 0 && isAgent && commissionType && commissionValue != null) {
      try {
        const normalized = cartItems.map((i:any)=>({ title:i.title, price:Number(i.price||0), qty:Number(i.qty||1) }));
        const sumCart = normalized.reduce((s, r)=> s + r.price * r.qty, 0);
        const p = Number(commissionValue);
        const eps = 0.01;
        const hasT = Number.isFinite(Number(amountRub));
        const T = hasT ? Number(amountRub) : sumCart;
        const effExpected = commissionType === 'percent' ? (T * (1 - p/100)) : Math.max(T - p, 0);
        const looksAdjusted = Math.abs(sumCart - effExpected) < eps;
        const looksOriginal = Math.abs(sumCart - T) < eps;
        if (looksAdjusted) {
          cartItems = normalized as any; // already lowered on client
        } else if (looksOriginal) {
          cartItems = applyAgentCommissionToCart(normalized, commissionType as any, p).adjusted as any;
        } else {
          // ambiguous — prefer no extra adjustment
          cartItems = normalized as any;
        }
      } catch {}
    }
    // Business rule: минимальная сумма после вычета комиссии — не менее 10 ₽
    // Применяем только если есть фиксированная сумма (sumMode='fixed') или режим корзины
    const MIN_AMOUNT_RUB = 10;
    const totalRub = (() => {
      if (Array.isArray(cartItems) && cartItems.length > 0) {
        try { return cartItems.reduce((s: number, r: any) => s + Number(r.price || 0) * Number(r.qty || 1), 0); } catch { return Number(amountRub || 0); }
      }
      return Number(amountRub || 0);
    })();
    const enforceMin = (Array.isArray(cartItems) && cartItems.length > 0) || sumMode === 'fixed';
    if (enforceMin) {
      if (isAgent && commissionType && typeof commissionValue === 'number') {
        const retained = commissionType === 'percent' ? totalRub * (commissionValue / 100) : commissionValue;
        const net = totalRub - retained;
        if (!(net >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_NET_10' }, { status: 400 });
      } else {
        if (!(totalRub >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_10' }, { status: 400 });
      }
    }

    const item = await createPaymentLink(userId, { title, description, sumMode, amountRub: amountRub ?? undefined, vatRate, isAgent, commissionType: commissionType as any, commissionValue: commissionValue ?? undefined, partnerPhone, method, orgInn: inn ?? undefined, preferredCode: preferredCode ?? undefined, cartItems: cartItems ?? undefined, allowCartAdjust: Boolean(body?.allowCartAdjust), startEmptyCart: Boolean(body?.startEmptyCart), cartDisplay: (body?.cartDisplay === 'list' ? 'list' : (body?.cartDisplay === 'grid' ? 'grid' : undefined)), agentDescription: (typeof body?.agentDescription === 'string' ? body.agentDescription : undefined), termsDocHash: (typeof body?.termsDocHash === 'string' && body.termsDocHash.trim().length>0) ? body.termsDocHash : undefined } as any);
    const hostHdr = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const protoHdr = req.headers.get('x-forwarded-proto') || (hostHdr.startsWith('localhost') ? 'http' : 'https');
    const url = `${protoHdr}://${hostHdr}/link/${encodeURIComponent(item.code)}`;
    return NextResponse.json({ ok: true, link: url, item }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


