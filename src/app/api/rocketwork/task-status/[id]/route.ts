import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { resolveRwTokenWithFingerprint } from '@/server/rwToken';
import { listSales, findSaleByTaskId } from '@/server/taskStore';
import { getSelectedOrgInn } from '@/server/orgContext';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(_: Request) {
  try {
    const cookie = _.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || _.headers.get('x-user-id') || 'default';
    // Try resolve via sale.rwTokenFp where possible
    const urlObj = new URL(_.url);
    const segs = urlObj.pathname.split('/');
    let taskId = decodeURIComponent(segs[segs.length - 1] || '');
    if (taskId === 'last') {
      try {
        const raw = await readText('.data/tasks.json');
        const parsed = raw ? (JSON.parse(raw) as { tasks?: { id: string | number }[] }) : { tasks: [] };
        const last = parsed.tasks && parsed.tasks.length > 0 ? parsed.tasks[parsed.tasks.length - 1].id : null;
        if (last != null) taskId = String(last);
      } catch {}
    }
    let rwTokenFp: string | null = null;
    try { const s = await findSaleByTaskId(userId, taskId); rwTokenFp = (s as any)?.rwTokenFp ?? null; } catch {}
    const inn = getSelectedOrgInn(_);
    const { token } = await resolveRwTokenWithFingerprint(_, userId, inn, rwTokenFp);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    // поддерживаем специальный id last: берём последний task_id из локального стора
    const url = new URL(`tasks/${encodeURIComponent(taskId)}`, base.endsWith('/') ? base : base + '/').toString();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // save last status response for debugging
    try { await writeText('.data/last_task_status.json', typeof data === 'string' ? data : JSON.stringify(data, null, 2)); } catch {}

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const message = (maybeObj?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: message }, { status: res.status });
    }

    // Нормализуем возможную форму ответа { task: {...} }
    const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    const normalized = maybeObj?.task ?? data;
    return NextResponse.json(normalized, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


