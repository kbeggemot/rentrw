import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { updateWithdrawal } from '@/server/withdrawalStore';
import { promises as fs } from 'fs';
import path from 'path';

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
    const url = new URL(req.url);
    const segs = url.pathname.split('/');
    const taskId = decodeURIComponent(segs[segs.length - 1] || '');
    if (!taskId) return NextResponse.json({ error: 'NO_TASK' }, { status: 400 });

    // 1) Quick local marker check
    try {
      const marker = path.join(process.cwd(), '.data', `withdrawal_${userId}_${String(taskId)}.json`);
      const raw = await fs.readFile(marker, 'utf8');
      if (raw) return NextResponse.json({ done: true, source: 'marker' });
    } catch {}

    // 2) Ask external API directly
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 400 });
    const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
    const taskUrl = new URL(`tasks/${encodeURIComponent(String(taskId))}`, base.endsWith('/') ? base : base + '/').toString();
    const res = await fetch(taskUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: msg }, { status: res.status });
    }
    const obj = (data && typeof data === 'object' && 'task' in data) ? (data as any).task : data;
    const type = String(obj?.type || '').toLowerCase();
    const rootStatus = String(obj?.status || '').toLowerCase();
    // For Withdrawal we rely ONLY on root task.status
    const done = type === 'withdrawal' && rootStatus === 'paid';
    const currentStatus = obj?.status || null;
    if (done) {
      try {
        const marker = path.join(process.cwd(), '.data', `withdrawal_${userId}_${String(taskId)}.json`);
        await fs.mkdir(path.dirname(marker), { recursive: true });
        await fs.writeFile(marker, JSON.stringify({ userId, taskId, paidAt: new Date().toISOString() }), 'utf8');
      } catch {}
    }
    try { await updateWithdrawal(userId, taskId, { status: currentStatus, paidAt: done ? new Date().toISOString() : undefined, __source: 'manual' } as any); } catch {}
    return NextResponse.json({ done, status: currentStatus, type: obj?.type ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


