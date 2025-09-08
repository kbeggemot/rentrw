import { NextResponse } from 'next/server';
import { applyAgentCommissionToCart } from '@/lib/pricing';
import { deletePaymentLink, findLinkByCode, markLinkAccessed, updatePaymentLink } from '@/server/paymentLinkStore';
import { getUserPayoutRequisites } from '@/server/userStore';
import { listProductsForOrg } from '@/server/productsStore';

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
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const item = await findLinkByCode(code);
    if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    try { await markLinkAccessed(code); } catch {}
    const { userId, title, description, sumMode, amountRub, vatRate, isAgent, commissionType, commissionValue, partnerPhone, method } = item;
    let orgName: string | null = null;
    // 1) Try org name from org store by link's orgInn
    try {
      const innRaw = (item.orgInn || '').toString();
      const inn = innRaw.replace(/\D/g, '');
      if (inn) {
        const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
        const org = await findOrgByInn(inn);
        orgName = (org?.name ?? null) as any;
        // 2) If missing, try to fetch from RW /account using any active token for this org
        if (!orgName) {
          const token = await getTokenForOrg(inn, userId);
          if (token) {
            try {
              const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
              const url = new URL('account', base.endsWith('/') ? base : base + '/').toString();
              const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
              const txt = await res.text();
              let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
              if (res.ok && data) {
                const name = data?.account?.company_name || data?.company_name || null;
                if (name && typeof name === 'string' && name.trim().length > 0) {
                  orgName = name.trim();
                  try { await updateOrganizationName(inn, orgName); } catch {}
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // 3) Legacy fallback (selected org in cookie)
    try { if (!orgName) { const reqs = await getUserPayoutRequisites(userId); orgName = reqs.orgName || null; } } catch {}
    // Enrich cart items with product photos for public page rendering
    let cartItems = item.cartItems || null;
    try {
      if (Array.isArray(item.cartItems) && item.cartItems.length > 0) {
        const innRaw = (item.orgInn || '').toString();
        const inn = innRaw.replace(/\D/g, '');
        const products = inn ? await listProductsForOrg(inn) : [];
        cartItems = item.cartItems.map((c: any) => {
          const p = products.find((x) => (x.id && c?.id && String(x.id) === String(c.id)) || (x.title && c?.title && String(x.title).toLowerCase() === String(c.title).toLowerCase())) || null;
          const rawPhotos: string[] = Array.isArray((p as any)?.photos) ? ((p as any).photos as string[]) : [];
          const cooked = rawPhotos.map((ph) => (typeof ph === 'string' && ph.startsWith('.data/'))
            ? `/api/products/${encodeURIComponent(p?.id || '')}?path=${encodeURIComponent(ph)}`
            : ph);
          return { ...c, photos: cooked, priceCurrent: (p as any)?.price ?? null, instantResult: (p as any)?.instantResult ?? null };
        });
      }
    } catch {}
    return NextResponse.json({ code, userId, title, description, sumMode, amountRub, vatRate, isAgent, commissionType, commissionValue, partnerPhone, method, orgName: orgName || null, orgInn: item.orgInn || null, cartItems, allowCartAdjust: !!item.allowCartAdjust, startEmptyCart: !!(item as any)?.startEmptyCart, cartDisplay: item.cartDisplay || null, agentDescription: (item as any)?.agentDescription ?? null, disabled: !!(item as any)?.disabled, termsDocHash: (item as any)?.termsDocHash ?? null }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() || '');
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const ok = await deletePaymentLink(userId, code);
    return NextResponse.json({ ok });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const url = new URL(req.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (!code) return NextResponse.json({ error: 'NO_CODE' }, { status: 400 });
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const current = await findLinkByCode(code);
    if (!current) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (current.userId !== userId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json().catch(() => null);
    // Determine mode from incoming payload (allows switching between modes)
    const isCart = Array.isArray(body?.cartItems) && body.cartItems.length > 0;

    // Common editable fields
    const title = String(body?.title || '').trim();
    if (!title) return NextResponse.json({ error: 'TITLE_REQUIRED' }, { status: 400 });
    const method = (body?.method === 'qr' || body?.method === 'card') ? body?.method : 'any';
    const isAgent = !!body?.isAgent;
    let commissionType: 'percent' | 'fixed' | null = null;
    let commissionValue: number | null = null;
    let partnerPhone: string | null = null;
    if (isAgent) {
      commissionType = (body?.commissionType === 'fixed' || body?.commissionType === 'percent') ? body?.commissionType : null;
      commissionValue = typeof body?.commissionValue === 'number' ? Number(body?.commissionValue) : null;
      partnerPhone = String(body?.partnerPhone || '').trim() || null;
      if (!commissionType) return NextResponse.json({ error: 'COMMISSION_TYPE_REQUIRED' }, { status: 400 });
      if (commissionValue == null || !Number.isFinite(commissionValue)) return NextResponse.json({ error: 'COMMISSION_VALUE_REQUIRED' }, { status: 400 });
      if (commissionType === 'percent' && (commissionValue < 0 || commissionValue > 100)) return NextResponse.json({ error: 'COMMISSION_PERCENT_RANGE' }, { status: 400 });
      if (commissionType === 'fixed' && commissionValue <= 0) return NextResponse.json({ error: 'COMMISSION_FIXED_POSITIVE' }, { status: 400 });
      if (!partnerPhone) return NextResponse.json({ error: 'PARTNER_PHONE_REQUIRED' }, { status: 400 });
    }

    if (!isCart) {
      // service mode
      const description = String(body?.description || '').trim();
      if (!description) return NextResponse.json({ error: 'DESCRIPTION_REQUIRED' }, { status: 400 });
      const sumMode = (body?.sumMode === 'fixed' ? 'fixed' : 'custom') as 'custom' | 'fixed';
      let amountRub: number | null = null;
      if (sumMode === 'fixed') {
        const raw = String(body?.amountRub ?? '').trim();
        const normalized = raw.replace(/\s+/g, '').replace(/,/g, '.');
        const n = Number(normalized);
        amountRub = Number.isFinite(n) ? n : NaN;
        if (!Number.isFinite(amountRub) || Number(amountRub) <= 0) return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 });
      }
      // Agent VAT rule: в режиме «свободная услуга» при агентской НДС должен быть only none
      if (isAgent) {
        const vr = String(body?.vatRate || 'none');
        if (vr !== 'none') return NextResponse.json({ error: 'AGENT_VAT_FORBIDDEN' }, { status: 400 });
      }
      // Business rule: минимальная сумма (после вычета комиссии при агентской) — 10 ₽
      const MIN_AMOUNT_RUB = 10;
      if (amountRub != null) {
        if (isAgent && commissionType && commissionValue != null) {
          const retained = commissionType === 'percent' ? Number(amountRub) * (Number(commissionValue) / 100) : Number(commissionValue);
          const net = Number(amountRub) - retained;
          if (!(net >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_NET_10' }, { status: 400 });
        } else {
          if (!(Number(amountRub) >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_10' }, { status: 400 });
        }
      }
      const vatRate = (['none','0','5','7','10','20'].includes(String(body?.vatRate)) ? String(body?.vatRate) : 'none') as 'none'|'0'|'5'|'7'|'10'|'20';
      const updated = await updatePaymentLink(userId, code, {
        title,
        description,
        sumMode,
        amountRub: amountRub ?? undefined,
        vatRate,
        method,
        isAgent,
        commissionType: commissionType as any,
        commissionValue: commissionValue ?? undefined,
        partnerPhone,
        // propagate termsDocHash updates when provided
        ...(typeof (body as any)?.termsDocHash !== 'undefined' ? { termsDocHash: (body as any).termsDocHash ? String((body as any).termsDocHash) : null } : {}),
        disabled: typeof (body as any)?.disabled === 'boolean' ? Boolean((body as any).disabled) : undefined,
      });
      if (!updated) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ ok: true, item: updated });
    } else {
      // cart mode
      const cartItems = Array.isArray(body?.cartItems) ? body.cartItems : [];
      if (!Array.isArray(cartItems) || cartItems.length === 0) return NextResponse.json({ error: 'CART_EMPTY' }, { status: 400 });
      let normalized = cartItems.map((c: any) => ({
        id: c?.id ?? null,
        title: String(c?.title || ''),
        price: Number(String(c?.price ?? '0').toString().replace(/,/g, '.')),
        qty: Number(String(c?.qty ?? '1').toString().replace(/,/g, '.')),
      })).filter((c: any) => Number.isFinite(c.price) && Number.isFinite(c.qty) && c.price > 0 && c.qty > 0);
      if (normalized.length === 0) return NextResponse.json({ error: 'CART_EMPTY' }, { status: 400 });
      // If agent is enabled and agent params changed — recalc and persist adjusted prices.
      // Otherwise, trust incoming prices (they are already adjusted in the stored link).
      if (isAgent && commissionType && commissionValue != null) {
        const agentChanged = (
          !!current.isAgent !== !!isAgent ||
          (current as any)?.commissionType !== commissionType ||
          Number((current as any)?.commissionValue ?? NaN) !== Number(commissionValue)
        );
        if (agentChanged) {
          try {
            normalized = applyAgentCommissionToCart(
              normalized.map(i=>({ title:i.title, price:i.price, qty:i.qty })),
              commissionType as any,
              Number(commissionValue)
            ).adjusted as any;
          } catch {}
        }
      }
      const allowCartAdjust = !!body?.allowCartAdjust;
      const cartDisplay = body?.cartDisplay === 'list' ? 'list' : (body?.cartDisplay === 'grid' ? 'grid' : undefined);
      const total = normalized.reduce((s: number, r: any) => s + r.price * r.qty, 0);
      // Agent VAT rule: нельзя, если хоть у одной позиции НДС != none
      if (isAgent) {
        try {
          const innRaw = (current.orgInn || '').toString();
          const inn = innRaw.replace(/\D/g, '');
          const catalog = inn ? await listProductsForOrg(inn) : [];
          const hasVat = normalized.some((ci: any) => {
            const id = ci?.id ? String(ci.id) : null;
            const title = (ci?.title || '').toString().trim().toLowerCase();
            const p = catalog.find((x) => (id && String(x.id) === id) || (title && x.title.toLowerCase() === title));
            return p && p.vat !== 'none';
          });
          if (hasVat) return NextResponse.json({ error: 'AGENT_VAT_FORBIDDEN' }, { status: 400 });
        } catch {}
      }
      // Business rule: минимальная сумма (после комиссии) — 10 ₽
      const MIN_AMOUNT_RUB = 10;
      if (isAgent && commissionType && commissionValue != null) {
        const retained = commissionType === 'percent' ? total * (Number(commissionValue) / 100) : Number(commissionValue);
        const net = total - retained;
        if (!(net >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_NET_10' }, { status: 400 });
      } else {
        if (!(total >= MIN_AMOUNT_RUB)) return NextResponse.json({ error: 'MIN_10' }, { status: 400 });
      }
      const startEmptyCart = !!body?.startEmptyCart;
      const updated = await updatePaymentLink(userId, code, {
        title,
        cartItems: normalized as any,
        allowCartAdjust,
        startEmptyCart,
        amountRub: total,
        method,
        isAgent,
        commissionType: commissionType as any,
        commissionValue: commissionValue ?? undefined,
        partnerPhone,
        cartDisplay: cartDisplay as any,
        ...(typeof (body as any)?.termsDocHash !== 'undefined' ? { termsDocHash: (body as any).termsDocHash ? String((body as any).termsDocHash) : null } : {}),
        disabled: typeof (body as any)?.disabled === 'boolean' ? Boolean((body as any).disabled) : undefined,
      });
      if (!updated) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ ok: true, item: updated });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


