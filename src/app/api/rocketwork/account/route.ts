import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { getSelectedOrgInn } from '@/server/orgContext';
import { getTokenForOrg } from '@/server/orgStore';
import { fetchWithTimeout } from '@/server/http';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(req: Request) {
  try {
    const cookie = req.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || 'default';
    const inn = getSelectedOrgInn(req);
    let token: string | null = null;
    if (inn) {
      try { token = await getTokenForOrg(inn, userId); } catch { token = null; }
    }
    if (!token) token = await getDecryptedApiToken(userId);
    if (!token) {
      return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });
    }

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    const url = new URL('account', base.endsWith('/') ? base : base + '/').toString();

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      // внешний API, данные всегда актуальные
      cache: 'no-store',
    }, 15_000);

    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const message = (maybeObj?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: message }, { status: res.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


