import { NextResponse } from 'next/server';
import { updateSaleMeta } from '@/server/taskStore';
import { appendAdminEntityLog } from '@/server/adminAudit';

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
    const body = await req.json().catch(() => ({} as any));
    const taskId = body?.taskId;
    if (typeof taskId === 'undefined') return NextResponse.json({ error: 'NO_TASK' }, { status: 400 });
    const payerTgId = typeof body?.payerTgId === 'string' && body.payerTgId.trim().length > 0 ? String(body.payerTgId).trim() : null;
    const linkCode = typeof body?.linkCode === 'string' && body.linkCode.trim().length > 0 ? String(body.linkCode).trim() : null;
    const payerTgFirstName = typeof body?.payerTgFirstName === 'string' && body.payerTgFirstName.trim().length > 0 ? String(body.payerTgFirstName).trim() : undefined as any;
    const payerTgLastName = typeof body?.payerTgLastName === 'string' && body.payerTgLastName.trim().length > 0 ? String(body.payerTgLastName).trim() : undefined as any;
    const payerTgUsername = typeof body?.payerTgUsername === 'string' && body.payerTgUsername.trim().length > 0 ? String(body.payerTgUsername).trim() : undefined as any;
    await updateSaleMeta(userId, taskId, { payerTgId, linkCode, payerTgFirstName, payerTgLastName, payerTgUsername });
    try { await appendAdminEntityLog('sale', [String(userId), String(taskId)], { source: 'system', message: 'meta/update', data: { payerTgId, linkCode, ua: req.headers.get('user-agent') || null } }); } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


