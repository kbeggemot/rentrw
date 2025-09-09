import { NextResponse } from 'next/server';
import { readUserIndex } from '@/server/salesIndex';
import { readText } from '@/server/storage';
import { getSelectedOrgInn } from '@/server/orgContext';

export const runtime = 'nodejs';

function getUserIdMeta(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

type Row = { taskId: string | number; orderId?: string | number; createdAt: string; updatedAt?: string; status?: string | null; inn: string };

async function readOrgIndex(inn: string): Promise<Row[]> {
  try {
    const raw = await readText(`.data/sales/${inn.replace(/\D/g, '')}/index.json`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdMeta(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const url = new URL(req.url);
    const onlySuccess = url.searchParams.get('success') === '1';
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');
    const limit = (() => { const n = Number(limitRaw); return Number.isFinite(n) && n > 0 ? Math.min(200, Math.max(1, Math.floor(n))) : 0; })();
    const offset = (() => { const n = Number(offsetRaw); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; })();

    const inn = getSelectedOrgInn(req);
    let rows: Row[] = [];
    if (inn) rows = await readOrgIndex(inn);
    if (!rows || rows.length === 0) rows = await readUserIndex(userId) as unknown as Row[];
    rows = Array.isArray(rows) ? rows.slice() : [];
    if (onlySuccess) rows = rows.filter((r) => { const st = String((r as any)?.status || '').toLowerCase(); return st === 'paid' || st === 'transfered' || st === 'transferred'; });
    rows.sort((a: any, b: any) => {
      const at = Date.parse((a?.createdAt || 0) as any);
      const bt = Date.parse((b?.createdAt || 0) as any);
      if (bt !== at) return bt - at;
      return String(b.taskId || '').localeCompare(String(a.taskId || ''));
    });
    const total = rows.length;
    const prev = (offset > 0 && offset - 1 < rows.length) ? rows[offset - 1] : null;
    const prevCursor = prev ? `${prev.createdAt}|${prev.taskId}` : null;
    const pageItems = limit > 0 ? rows.slice(offset, offset + limit) : [];
    const minimal = pageItems.map((r) => ({ taskId: r.taskId, createdAt: r.createdAt, status: (r as any)?.status ?? null, inn: r.inn }));
    return NextResponse.json({ total, prevCursor, items: minimal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse as NextResponseMetaPost } from 'next/server';
import { updateSaleMeta } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';

// Note: one route file, single runtime export supported. Reuse the same runtime for both methods.

function getUserIdPost(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function POST(req: Request) {
  try {
    const userId = getUserIdPost(req);
    if (!userId) return NextResponseMetaPost.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => ({} as any));
    const taskId = body?.taskId;
    if (typeof taskId === 'undefined') return NextResponseMetaPost.json({ error: 'NO_TASK' }, { status: 400 });
    const payerTgId = typeof body?.payerTgId === 'string' && body.payerTgId.trim().length > 0 ? String(body.payerTgId).trim() : null;
    const linkCode = typeof body?.linkCode === 'string' && body.linkCode.trim().length > 0 ? String(body.linkCode).trim() : null;
    const payerTgFirstName = typeof body?.payerTgFirstName === 'string' && body.payerTgFirstName.trim().length > 0 ? String(body.payerTgFirstName).trim() : undefined as any;
    const payerTgLastName = typeof body?.payerTgLastName === 'string' && body.payerTgLastName.trim().length > 0 ? String(body.payerTgLastName).trim() : undefined as any;
    const payerTgUsername = typeof body?.payerTgUsername === 'string' && body.payerTgUsername.trim().length > 0 ? String(body.payerTgUsername).trim() : undefined as any;
    await updateSaleMeta(userId, taskId, { payerTgId, linkCode, payerTgFirstName, payerTgLastName, payerTgUsername });
    try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'meta/update', data: { payerTgId, linkCode, ua: req.headers.get('user-agent') || null } }); } catch {}
    return NextResponseMetaPost.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponseMetaPost.json({ error: message }, { status: 500 });
  }
}


