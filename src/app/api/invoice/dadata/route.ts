import { NextResponse } from 'next/server';
import { fetchTextWithTimeout } from '@/server/http';
import { readFallbackJsonBody } from '@/server/getFallback';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  // Accept JSON payload via header `x-invoice-payload` or `x-fallback-payload` (base64 of UTF-8 JSON).
  try {
    const jsonStr = readFallbackJsonBody(req, ['x-invoice-payload', 'x-fallback-payload']) || '';
    if (!jsonStr) return NextResponse.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    if (!jsonStr) return NextResponse.json({ ok: false, error: 'BAD_PAYLOAD' }, { status: 400 });
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    try { headers.delete('content-length'); } catch {}
    const url = new URL(req.url);
    url.searchParams.set('via', 'get');
    const req2 = new Request(url.toString(), { method: 'POST', headers, body: jsonStr });
    return await POST(req2);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);
    const inn = String(body?.inn || '').replace(/\D/g, '');
    if (!inn || (inn.length !== 10 && inn.length !== 12)) {
      return NextResponse.json({ ok: false, error: 'BAD_INN' }, { status: 400 });
    }
    const token = process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || '';
    const secret = process.env.DADATA_API_SECRET || process.env.DADATA_SECRET || '';
    if (!token) return NextResponse.json({ ok: false, error: 'NO_TOKEN' }, { status: 500 });

    const url = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
    const out = await fetchTextWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Token ${token}`,
        ...(secret ? { 'X-Secret': secret } as Record<string, string> : {})
      },
      body: JSON.stringify({ query: inn }),
      cache: 'no-store'
    }, 15_000);
    const res = out.res;
    const txt = out.text;
    let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'REMOTE_ERROR', details: typeof data?.message === 'string' ? data.message : null }, { status: 502 });
    }
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    if (!suggestions || suggestions.length === 0) {
      return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    }
    const first = suggestions[0];
    const nameShort = first?.data?.name?.short_with_opf || first?.data?.name?.full_with_opf || first?.value || first?.unrestricted_value || null;
    if (!nameShort) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true, name: nameShort });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 });
  }
}


