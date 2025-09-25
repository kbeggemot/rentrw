import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

    async function call(payload: any): Promise<{ ok: boolean; data?: any; status?: number }> {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Token ' + token,
          ...(secret ? { 'X-Secret': secret } as Record<string, string> : {})
        },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      const txt = await res.text();
      let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
      if (!res.ok) return { ok: false, data, status: res.status };
      return { ok: true, data };
    }

    const base: any = { query: inn, count: 1 };
    const typed: any = { ...base, ...(inn.length === 10 ? { type: 'LEGAL', branch_type: 'MAIN' } : { type: 'INDIVIDUAL' }) };

    // First try with explicit type; then fallback to generic
    let r = await call(typed);
    if (!r.ok || !Array.isArray(r.data?.suggestions) || r.data.suggestions.length === 0) {
      r = await call(base);
    }
    if (!r.ok) return NextResponse.json({ ok: false, error: 'REMOTE_ERROR' }, { status: r.status || 502 });

    const suggestions = Array.isArray(r.data?.suggestions) ? r.data.suggestions : [];
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
