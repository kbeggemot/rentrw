import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    
    const body = await req.json().catch(() => null);
    const phone = String(body?.phone || '').trim();
    if (!phone) return NextResponse.json({ error: 'NO_PHONE' }, { status: 400 });
    
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const digits = phone.replace(/\D/g, '');
    
    // invite best-effort
    try { 
      await fetch(new URL('executors/invite', base.endsWith('/') ? base : base + '/').toString(), { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          Accept: 'application/json' 
        }, 
        body: JSON.stringify({ phone: digits, with_framework_agreement: false }), 
        cache: 'no-store' 
      }); 
    } catch {}
    
    const url = new URL(`executors/${encodeURIComponent(digits)}`, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetch(url, { cache: 'no-store' });
    const txt = await res.text();
    let executorData: any = null; 
    try { executorData = txt ? JSON.parse(txt) : null; } catch { executorData = txt; }
    
    if (res.status === 404 || (typeof executorData === 'object' && executorData && ((executorData.error && /not\s*found/i.test(String(executorData.error))) || executorData.executor == null || (executorData.executor && executorData.executor.inn == null)))) {
      return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
    }
    
    if (!res.ok) {
      return NextResponse.json({ error: (executorData?.error as string) || 'RW_ERROR' }, { status: 400 });
    }
    
    const status: string | undefined = (executorData?.executor?.selfemployed_status as string | undefined) ?? (executorData?.selfemployed_status as string | undefined);
    if (!status) return NextResponse.json({ error: 'PARTNER_NOT_REGISTERED' }, { status: 400 });
    if (status !== 'validated') return NextResponse.json({ error: 'PARTNER_NOT_VALIDATED' }, { status: 400 });
    
    const paymentInfo = (executorData?.executor?.payment_info ?? executorData?.payment_info ?? null);
    if (!paymentInfo) return NextResponse.json({ error: 'PARTNER_NO_PAYMENT_INFO' }, { status: 400 });
    
    return NextResponse.json({ 
      ok: true, 
      executor: executorData?.executor || executorData,
      status,
      inn: executorData?.executor?.inn || executorData?.inn
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
