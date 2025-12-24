import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { getSelectedOrgInn } from '@/server/orgContext';
import { readText, writeText } from '@/server/storage';
import { updateSaleFromStatus, findSaleByTaskId, updateSaleOfdUrlsByOrderId, setSaleCreatedAtRw, resolveOwnerAndInnByTask } from '@/server/taskStore';
import { ensureSaleFromTask } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';
import { fermaGetAuthTokenCached, fermaCreateReceipt } from '@/server/ofdFerma';
import { appendRwError, writeRwLastRequest } from '@/server/rwAudit';
import { buildFermaReceiptPayload, PAYMENT_METHOD_PREPAY_FULL, PAYMENT_METHOD_FULL_PAYMENT } from '@/app/api/ofd/ferma/build-payload';
import { getUserOrgInn } from '@/server/userStore';
import { getOrgPayoutRequisites } from '@/server/orgStore';
import { enqueueOffsetJob, startOfdScheduleWorker } from '@/server/ofdScheduleWorker';
import { fetchWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(_: Request) {
  try {
    const cookie = _.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    let userId = (mc ? decodeURIComponent(mc[1]) : undefined) || _.headers.get('x-user-id') || 'default';
    const urlObj = new URL(_.url);
    const segs = urlObj.pathname.split('/');
    let taskId = decodeURIComponent(segs[segs.length - 1] || '');
    let rwTokenFp: string | null = null;
    try { const s0 = await findSaleByTaskId(userId, taskId); rwTokenFp = (s0 as any)?.rwTokenFp ?? null; } catch {}
    let inn = getSelectedOrgInn(_);
    // Auto-resolve owner and inn by taskId if headers are missing and current user has no access
    if (!inn || String(inn).trim().length === 0 || inn === 'неизвестно') {
      try {
        const mapped = await resolveOwnerAndInnByTask(taskId);
        if (mapped.userId) userId = mapped.userId;
        if (mapped.orgInn) inn = mapped.orgInn;
        // Re-read fingerprint for mapped owner if we didn't have it
        if (!rwTokenFp && mapped.userId) {
          try { const s = await findSaleByTaskId(mapped.userId, taskId); rwTokenFp = (s as any)?.rwTokenFp ?? null; } catch {}
        }
      } catch {}
    }
    const resolved = await resolveRwTokenWithFingerprint(_, userId, inn, rwTokenFp);
    let token = resolved.token;
    if (!token && inn) {
      // As a last resort, try any active token for this org (superadmin helper)
      try {
        const { listActiveTokensForOrg } = await import('@/server/orgStore');
        const list = await listActiveTokensForOrg(String(inn).replace(/\D/g, ''));
        if (list.length > 0) token = list[0];
      } catch {}
    }
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    // поддерживаем специальный id last из локального стора для дебага
    taskId = decodeURIComponent(segs[segs.length - 1] || '');
    if (taskId === 'last') {
      try {
        const raw = await readText('.data/tasks.json');
        const parsed = raw ? (JSON.parse(raw) as { tasks?: { id: string | number }[] }) : { tasks: [] };
        const last = parsed.tasks && parsed.tasks.length > 0 ? parsed.tasks[parsed.tasks.length - 1].id : null;
        if (last != null) taskId = String(last);
      } catch {}
    }
    const url = new URL(`tasks/${encodeURIComponent(taskId)}`, base.endsWith('/') ? base : base + '/').toString();

    let res: Response;
    try {
      await writeRwLastRequest({ ts: new Date().toISOString(), scope: 'tasks:get', method: 'GET', url, userId });
      res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }, 15_000);
    } catch (e) {
      await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:get', method: 'GET', url, status: null, error: e instanceof Error ? e.message : String(e), userId });
      throw e;
    }

    // Fallback: if RW says Not Found with this token, try other active tokens for the org
    if (!res.ok && (res.status === 404 || res.status === 401) && inn) {
      try {
        const { listActiveTokensForOrg } = await import('@/server/orgStore');
        const candidates = await listActiveTokensForOrg(String(inn).replace(/\D/g, ''), undefined);
        for (const alt of candidates) {
          if (!alt || alt === token) continue;
          try {
            const r2 = await fetchWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${alt}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
            if (r2.ok) { res = r2; token = alt; break; }
          } catch {}
        }
      } catch {}
    }

    // Superadmin fallback: if still Not Found, try scanning all org tokens
    if (!res.ok && (res.status === 404 || res.status === 401)) {
      try {
        const { allOrganizations, getTokenForOrg, listActiveTokensForOrg } = await import('@/server/orgStore');
        const orgs = await allOrganizations();
        outer: for (const org of orgs) {
          const tokens = await listActiveTokensForOrg(org.inn);
          for (const t of tokens) {
            try {
              const r3 = await fetchWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
              if (r3.ok) { res = r3; token = t; inn = org.inn; break outer; }
            } catch {}
          }
        }
      } catch {}
    }

    let text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // лог статуса для отладки
    try { await writeText('.data/last_task_status.json', typeof data === 'string' ? data : JSON.stringify(data, null, 2)); } catch {}

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const message = (maybeObj?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: message }, { status: res.status });
    }

    let maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    let normalized: RocketworkTask = (maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask);

    // Ensure a local sale record exists for this task (creates if missing)
    try { const currentInn = getSelectedOrgInn(_); await ensureSaleFromTask({ userId, taskId, task: normalized as any, orgInn: currentInn || null }); } catch {}

    // Attempt short polling for receipts: если force=1 — опрашиваем без условий; иначе по строгим правилам
    let tries = 0;
    const force = new URL(_.url).searchParams.get('force') === '1';
    const needMore = async (obj: RocketworkTask): Promise<boolean> => {
      if (force) return true;
      const ao = String(obj?.acquiring_order?.status || '').toLowerCase();
      const isFinal = ao === 'paid' || ao === 'transferred' || ao === 'transfered';
      if (!isFinal) return false;
      const createdAt = (obj as any)?.created_at as string | undefined;
      const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
      try {
        const { findSaleByTaskId } = await import('@/server/taskStore');
        const s = await findSaleByTaskId(userId, taskId);
        const endStr = (s as any)?.serviceEndDate ? String((s as any).serviceEndDate).slice(0, 10) : null;
        // Если serviceEndDate не задан — трактуем как «день‑в‑день» (см. recordSaleOnCreate)
        const sameDayAssumption = endStr ? (createdDate && endStr && createdDate === endStr) : true;
        const hasFull = Boolean((s as any)?.ofdFullUrl || (s as any)?.ofdFullId);
        const hasPrepay = Boolean((s as any)?.ofdUrl || (s as any)?.ofdPrepayId);
        const isAgent = Boolean((s as any)?.isAgent);
        const hasAgentCommission = Boolean((s as any)?.additionalCommissionOfdUrl);
        const hasNpd = Boolean((s as any)?.npdReceiptUri);
        // Determine if partner is entrepreneur
        let isEntrepreneurPartner = false;
        if (isAgent) {
          try {
            const phoneDigits = (s as any)?.partnerPhone ? String((s as any).partnerPhone).replace(/\D/g, '') : '';
            if (phoneDigits) {
              const { listPartners } = await import('@/server/partnerStore');
              const partners = await listPartners(userId);
              const p = partners.find((pp: any) => String(pp.phone || '').replace(/\D/g, '') === phoneDigits);
              isEntrepreneurPartner = (p?.employmentKind === 'entrepreneur');
            } else {
              const ek = ((obj as any)?.executor?.employment_kind as string | undefined) ?? ((obj as any)?.employment_kind as string | undefined);
              isEntrepreneurPartner = ek === 'entrepreneur';
            }
          } catch {}
        }
        const needNpd = isAgent && !isEntrepreneurPartner;
        if (sameDayAssumption) {
          // Нужен полный чек; для агентской дополнительно ждём чек комиссии; НПД — только для СМЗ
          return !hasFull || (isAgent && (!hasAgentCommission || (needNpd && !hasNpd)));
        }
        // Отложенный расчёт: ждём предоплату; для агентской — ещё чек комиссии. Полный чек появится после pay — не ждём его здесь
        return !hasPrepay || (isAgent && !hasAgentCommission);
      } catch {}
      // Fallback на случай отсутствия записи — используем RW поля (обычно пусто, т.к. with_ofd_receipt=false)
      const purchase = obj?.ofd_url || obj?.acquiring_order?.ofd_url;
      const addComm = (obj as any)?.additional_commission_ofd_url as string | undefined;
      const must = obj?.additional_commission_value ? !(purchase && addComm) : !purchase;
      return must;
    };
    while (tries < 5 && (await needMore(normalized))) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
      res = await fetchWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
      } catch (e) {
        await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:get', method: 'GET', url, status: null, error: e instanceof Error ? e.message : String(e), userId });
        throw e;
      }
      text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
      tries += 1;
    }

    // If agent sale got transferred and root status is only completed, trigger pay
    try {
      const aoStatus = String(normalized?.acquiring_order?.status || '').toLowerCase();
      const rootStatus = String(normalized?.status || '').toLowerCase();
      const hasAgent = Boolean(normalized?.additional_commission_value);
      // New gate: require full-settlement receipt link AND commission receipt link present in our store
      let saleHasFull = false;
      let saleHasCommission = false;
      try { const s = await findSaleByTaskId(userId, taskId); saleHasFull = Boolean(s?.ofdFullUrl); saleHasCommission = Boolean((s as any)?.additionalCommissionOfdUrl); } catch {}
      if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed' && saleHasFull && saleHasCommission) {
        // Prefer org-scoped token for the sale if available
        try {
          const { findSaleByTaskId } = await import('@/server/taskStore');
          const s = await findSaleByTaskId(userId, taskId);
          if (s && s.orgInn) {
            try {
              const { getTokenForOrg } = await import('@/server/orgStore');
              const t2 = await getTokenForOrg(String(s.orgInn).replace(/\D/g, ''), userId);
              if (t2) { /* prefer org token for pay */ }
            } catch {}
          }
        } catch {}
        const payUrl = new URL(`tasks/${encodeURIComponent(taskId)}/pay`, base.endsWith('/') ? base : base + '/').toString();
        try {
          const authToken = (async () => { try { const { findSaleByTaskId } = await import('@/server/taskStore'); const s = await findSaleByTaskId(userId, taskId); if (s && s.orgInn) { try { const { getTokenForOrg } = await import('@/server/orgStore'); const t2 = await getTokenForOrg(String(s.orgInn).replace(/\D/g, ''), userId); if (t2) return t2; } catch {} } } catch {} return token; })();
          const tok = await authToken;
          const resPay = await fetchWithTimeout(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
          // IMPORTANT: drain body to avoid undici socket leaks even on success
          const payText = await resPay.text().catch(() => '');
          if (!resPay.ok) {
            try { const { appendRwError } = await import('@/server/rwAudit'); await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: resPay.status, responseText: payText, userId }); } catch {}
          }
        } catch (e) {
          try { const { appendRwError } = await import('@/server/rwAudit'); await appendRwError({ ts: new Date().toISOString(), scope: 'tasks:pay', method: 'PATCH', url: payUrl, status: null, error: e instanceof Error ? e.message : String(e), userId }); } catch {}
        }
        // After pay, poll NPD only for self-employed partners (not for entrepreneurs)
        try {
          let isEntrepreneurPartner = false;
          const { findSaleByTaskId } = await import('@/server/taskStore');
          const sale = await findSaleByTaskId(userId, taskId);
          const phoneDigits = (sale as any)?.partnerPhone ? String((sale as any).partnerPhone).replace(/\D/g, '') : '';
          if (phoneDigits) {
            const { listPartners } = await import('@/server/partnerStore');
            const partners = await listPartners(userId);
            const p = partners.find((pp: any) => String(pp.phone || '').replace(/\D/g, '') === phoneDigits);
            isEntrepreneurPartner = (p?.employmentKind === 'entrepreneur');
          } else {
            const ek = ((normalized as any)?.executor?.employment_kind as string | undefined) ?? ((normalized as any)?.employment_kind as string | undefined);
            isEntrepreneurPartner = ek === 'entrepreneur';
          }
          if (!isEntrepreneurPartner) {
        let triesNpd = 0;
        while (!normalized?.receipt_uri && triesNpd < 5) {
          await new Promise((r) => setTimeout(r, 1200));
          res = await fetchWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
          text = await res.text();
          try { data = text ? JSON.parse(text) : null; } catch { data = text; }
          maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
          normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
          triesNpd += 1;
        }
          }
        } catch {}
      }
    } catch {}

    // Persist into sales store; if deferred flow, prefer ofdFullUrl presence for UI
    try {
      const ofdUrl = (normalized?.ofd_url as string | undefined)
        ?? (normalized?.ofd_receipt_url as string | undefined)
        ?? (normalized?.acquiring_order?.ofd_url as string | undefined)
        ?? (normalized?.acquiring_order?.ofd_receipt_url as string | undefined)
        ?? null;
      const addOfd = (normalized?.additional_commission_ofd_url as string | undefined)
        ?? null;
      const npdReceipt = (normalized?.receipt_uri as string | undefined) ?? null;
      await updateSaleFromStatus(userId, taskId, { status: normalized?.acquiring_order?.status, ofdUrl, additionalCommissionOfdUrl: addOfd, npdReceiptUri: npdReceipt, rootStatus: (normalized as any)?.status } as any);
      try {
        const createdAtRw: string | undefined = (normalized as any)?.created_at || undefined;
        if (createdAtRw) await setSaleCreatedAtRw(userId, taskId, createdAtRw);
      } catch {}
      // If no RW ofd_url (because we turned it off) and we already have prepayment/full URLs from OFD callback store,
      // the client will still display '-' here; that's expected until callback arrives.
    } catch {}

    // Fallback path: if acquiring_order.status is final and sale has no receipt yet, create OFD receipt(s) ourselves
    try {
      const aoFin = String(normalized?.acquiring_order?.status || '').toLowerCase();
      if (aoFin === 'paid' || aoFin === 'transfered' || aoFin === 'transferred') {
        const sale = await findSaleByTaskId(userId, taskId);
        if (sale && sale.source !== 'external') {
          const createdAt = (normalized as any)?.created_at || sale.createdAtRw || sale.createdAt;
          const createdDate = createdAt ? String(createdAt).slice(0, 10) : null;
          const endDate = sale.serviceEndDate || null;
          const isToday = Boolean(createdDate && endDate && createdDate === endDate);
          const amountRub = Number(sale.amountGrossRub || 0);
          const retainedRub = Number(sale.retainedCommissionRub || 0);
          const amountNetRub = sale.isAgent ? Math.max(0, amountRub - retainedRub) : amountRub;
          const usedVat = (sale.vatRate || 'none') as any;
          const itemLabel = (sale.description && sale.description.trim().length > 0) ? sale.description.trim() : 'Оплата услуги';
          const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
          const tokenOfd = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });
          // Build callback URL from current request headers to avoid relying on env host
          const rawProto = _.headers.get('x-forwarded-proto') || 'http';
          const hostHdr = _.headers.get('x-forwarded-host') || _.headers.get('host') || 'localhost:3000';
          const isPublicHost = !/localhost|127\.0\.0\.1|(^10\.)|(^192\.168\.)/.test(hostHdr);
          const protoHdr = (rawProto === 'http' && isPublicHost) ? 'https' : rawProto;
          const secret = process.env.OFD_CALLBACK_SECRET || '';
          const callbackUrl = `${protoHdr}://${hostHdr}/api/ofd/ferma/callback${secret ? `?secret=${encodeURIComponent(secret)}&` : '?'}uid=${encodeURIComponent(userId)}`;

          const defaultEmail = process.env.OFD_DEFAULT_EMAIL || process.env.DEFAULT_RECEIPT_EMAIL || 'ofd@rockethumans.com';
          if (isToday) {
            // Need full settlement receipt if not already present
            if (!sale.ofdFullUrl && !sale.ofdFullId) {
              if (sale.isAgent) {
                const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                if (partnerInn) {
                  const invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (!invoiceIdFull) return NextResponse.json({ ok: true });
                  const partnerName = ((normalized as any)?.executor && [
                    (normalized as any)?.executor?.last_name,
                    (normalized as any)?.executor?.first_name,
                    (normalized as any)?.executor?.second_name,
                  ].filter(Boolean).join(' ').trim()) || undefined;
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const itemsParam = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const { listProductsForOrg } = await import('@/server/productsStore'); const products = inn ? await listProductsForOrg(inn) : []; const fromSnap = Array.isArray(snap) && snap.length>0 ? snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat=(['none','0','5','7','10','20'].includes(String(it?.vat))?String(it.vat):undefined) as any; return { label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate:(snapVat||(prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }) : []; if (fromSnap.length>0) return fromSnap; const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null; if (!code) return undefined; const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${protoHdr}://${hostHdr}`).toString(), { cache:'no-store', headers:{ 'x-user-id': userId } })).json().catch(()=>null); const cart = Array.isArray(link?.cartItems) ? link.cartItems : []; if (cart.length===0) return undefined; return cart.map((c:any)=>{ const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null; return { label:String(c.title||''), price:Number(c.price||0), qty:Number(c.qty||1), vatRate:((prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }); } catch { return undefined; } })();
                  const itemsFinal = (Array.isArray(itemsParam) && itemsParam.length>0)
                    ? itemsParam
                    : ((Array.isArray((sale as any)?.itemsSnapshot) && (sale as any).itemsSnapshot.length>0)
                      ? (sale as any).itemsSnapshot.map((it:any)=>({ label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate: usedVat }))
                      : undefined);
                  const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName || 'Исполнитель' }, items: itemsFinal });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                }
              } else {
                const orgInn = await getUserOrgInn(userId);
                const orgDataReq = orgInn ? await getOrgPayoutRequisites(orgInn) : { bik: null, account: null };
                if (orgInn) {
                  const invoiceIdFull = (sale as any).invoiceIdFull || null;
                  if (!invoiceIdFull) return NextResponse.json({ ok: true });
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  let supplierNameOrg: string | undefined;
                  try {
                    const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                    const rec = await findOrgByInn(orgInn);
                    supplierNameOrg = (rec?.name && rec.name.trim().length > 0) ? rec.name.trim() : undefined;
                    if (!supplierNameOrg) {
                      const tok = await getTokenForOrg(orgInn, userId);
                      if (tok) {
                        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                        const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                        const r = await fetchWithTimeout(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                        const txt = await r.text();
                        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                        const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                        if (nm) { supplierNameOrg = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                      }
                    }
                  } catch {}
                  const itemsParamOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap)||snap.length===0) return undefined; const { listProductsForOrg } = await import('@/server/productsStore'); const products = await listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase()))||null; const snapVat=(['none','0','5','7','10','20'].includes(String(it?.vat))?String(it.vat):undefined) as any; return { label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate:(snapVat||(prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }); } catch { return undefined; } })();
                  const itemsFinalOrg = (Array.isArray(itemsParamOrg) && itemsParamOrg.length>0)
                    ? itemsParamOrg
                    : ((Array.isArray((sale as any)?.itemsSnapshot) && (sale as any).itemsSnapshot.length>0)
                      ? (sale as any).itemsSnapshot.map((it:any)=>({ label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate: usedVat }))
                      : undefined);
                  const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_FULL_PAYMENT, orderId: sale.orderId, docType: 'Income', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierNameOrg }, items: itemsFinalOrg });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdFullId: created.id || null }); }
                }
              }
            }
          } else {
            // Prepayment receipt if not present, and schedule offset
            if (!sale.ofdUrl && !sale.ofdPrepayId) {
              if (sale.isAgent) {
                const partnerInn: string | undefined = (normalized as any)?.executor?.inn as string | undefined;
                if (partnerInn) {
                  const invoiceIdFull = (sale as any).invoiceIdPrepay || null;
                  if (!invoiceIdFull) return NextResponse.json({ ok: true });
                  const partnerName2 = ((normalized as any)?.executor && [
                    (normalized as any)?.executor?.last_name,
                    (normalized as any)?.executor?.first_name,
                    (normalized as any)?.executor?.second_name,
                  ].filter(Boolean).join(' ').trim()) || undefined;
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  const itemsParamA = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; const inn = (sale as any)?.orgInn ? String((sale as any).orgInn).replace(/\D/g,'') : undefined; const { listProductsForOrg } = await import('@/server/productsStore'); const products = inn ? await listProductsForOrg(inn) : []; const fromSnap = Array.isArray(snap) && snap.length>0 ? snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase())) || null; const snapVat=(['none','0','5','7','10','20'].includes(String(it?.vat))?String(it.vat):undefined) as any; return { label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate:(snapVat||(prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }) : []; if (fromSnap.length>0) return fromSnap; const code = (sale as any)?.linkCode ? String((sale as any).linkCode) : null; if (!code) return undefined; const link = await (await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, `${protoHdr}://${hostHdr}`).toString(), { cache:'no-store', headers:{ 'x-user-id': userId } })).json().catch(()=>null); const cart = Array.isArray(link?.cartItems) ? link.cartItems : []; if (cart.length===0) return undefined; return cart.map((c:any)=>{ const prod = products.find((p)=> (p.id && c?.id && String(p.id)===String(c.id)) || (p.title && c?.title && String(p.title).toLowerCase()===String(c.title).toLowerCase())) || null; return { label:String(c.title||''), price:Number(c.price||0), qty:Number(c.qty||1), vatRate:((prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }); } catch { return undefined; } })();
                  const itemsFinalA = (Array.isArray(itemsParamA) && itemsParamA.length>0)
                    ? itemsParamA
                    : ((Array.isArray((sale as any)?.itemsSnapshot) && (sale as any).itemsSnapshot.length>0)
                      ? (sale as any).itemsSnapshot.map((it:any)=>({ label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate: usedVat }))
                      : undefined);
                  const payload = buildFermaReceiptPayload({ party: 'partner', partyInn: partnerInn, description: itemLabel, amountRub: amountNetRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: partnerInn, SupplierName: partnerName2 || 'Исполнитель' }, items: itemsFinalA });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                }
              } else {
                const orgInn = await getUserOrgInn(userId);
                const orgDataReq2 = orgInn ? await getOrgPayoutRequisites(orgInn) : { bik: null, account: null };
                if (orgInn) {
                  const invoiceIdFull = (sale as any).invoiceIdPrepay || null;
                  if (!invoiceIdFull) return NextResponse.json({ ok: true });
                  const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
                  let supplierNameOrg2: string | undefined;
                  try {
                    const { findOrgByInn, getTokenForOrg, updateOrganizationName } = await import('@/server/orgStore');
                    const rec = await findOrgByInn(orgInn);
                    supplierNameOrg2 = (rec?.name && rec.name.trim().length > 0) ? rec.name.trim() : undefined;
                    if (!supplierNameOrg2) {
                      const tok = await getTokenForOrg(orgInn, userId);
                      if (tok) {
                        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
                        const accUrl = new URL('account', base.endsWith('/') ? base : base + '/').toString();
                        const r = await fetchWithTimeout(accUrl, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }, 15_000);
                        const txt = await r.text();
                        let d: any = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
                        const nm = ((d?.company_name as string | undefined) ?? (d?.companyName as string | undefined) ?? '').trim();
                        if (nm) { supplierNameOrg2 = nm; try { await updateOrganizationName(orgInn, nm); } catch {} }
                      }
                    }
                  } catch {}
                  const itemsParamAOrg = await (async ()=>{ try { const snap = (sale as any)?.itemsSnapshot as any[] | null; if (!Array.isArray(snap)||snap.length===0) return undefined; const { listProductsForOrg } = await import('@/server/productsStore'); const products = await listProductsForOrg(orgInn); return snap.map((it:any)=>{ const prod = products.find((p)=> (p.id && it?.id && String(p.id)===String(it.id)) || (p.title && it?.title && String(p.title).toLowerCase()===String(it.title).toLowerCase()))||null; const snapVat=(['none','0','5','7','10','20'].includes(String(it?.vat))?String(it.vat):undefined) as any; return { label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate:(snapVat||(prod?.vat as any)||usedVat), unit:(prod?.unit as any), kind:(prod?.kind as any) } as any; }); } catch { return undefined; } })();
                  const itemsFinalAOrg = (Array.isArray(itemsParamAOrg) && itemsParamAOrg.length>0)
                    ? itemsParamAOrg
                    : ((Array.isArray((sale as any)?.itemsSnapshot) && (sale as any).itemsSnapshot.length>0)
                      ? (sale as any).itemsSnapshot.map((it:any)=>({ label:String(it.title||''), price:Number(it.price||0), qty:Number(it.qty||1), vatRate: usedVat }))
                      : undefined);
                  const payload = buildFermaReceiptPayload({ party: 'org', partyInn: orgInn, description: itemLabel, amountRub, vatRate: usedVat, methodCode: PAYMENT_METHOD_PREPAY_FULL, orderId: sale.orderId, docType: 'IncomePrepayment', buyerEmail: bEmail, invoiceId: invoiceIdFull, callbackUrl, withPrepaymentItem: true, paymentAgentInfo: { AgentType: 'AGENT', SupplierInn: orgInn, SupplierName: supplierNameOrg2 }, items: itemsFinalAOrg });
                  const created = await fermaCreateReceipt(payload, { baseUrl, authToken: tokenOfd });
                  { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await updateSaleOfdUrlsByOrderId(userId, numOrder, { ofdPrepayId: created.id || null }); }
                }
              }
            }
            if (sale.serviceEndDate) {
              startOfdScheduleWorker();
              const dueDate = new Date(`${sale.serviceEndDate}T09:00:00Z`);
              let partnerInn: string | undefined;
              if (sale.isAgent) {
                partnerInn = (normalized as any)?.executor?.inn as string | undefined;
              }
              const bEmail = sale.clientEmail || (normalized as any)?.acquiring_order?.client_email || defaultEmail;
              { const numOrder = Number(String(sale.orderId).match(/(\d+)/g)?.slice(-1)[0] || NaN); await enqueueOffsetJob({ userId, orderId: numOrder, dueAt: dueDate.toISOString(), party: sale.isAgent ? 'partner' : 'org', partnerInn, description: 'Оплата услуги', amountRub: sale.isAgent ? amountNetRub : amountRub, vatRate: usedVat, buyerEmail: bEmail }); }
            }
          }
        }
      }
    } catch {}

    // Также проставим заголовок, чтобы клиент не кешировал
    // Augment response with UI hint which column to watch
    try {
      const sale = await findSaleByTaskId(userId, taskId);
      const mskToday = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }).split('.').reverse().join('-');
      const isToday = sale?.serviceEndDate === mskToday;
      const hint = { ofdTarget: isToday ? 'full' : 'prepay', orderId: sale?.orderId } as Record<string, unknown>;
      return new NextResponse(JSON.stringify({ ...(normalized as any), __hint: hint }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } });
    } catch {
    return new NextResponse(JSON.stringify(normalized), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


