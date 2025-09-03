import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';
import { sendInstantDeliveryIfReady } from '@/server/instantDelivery';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const fd = await req.formData().catch(() => null);
    const userId = (fd?.get('userId') || url.searchParams.get('userId') || '').toString();
    const taskIdRaw = (fd?.get('taskId') || url.searchParams.get('taskId') || '').toString();
    if (!userId || !taskIdRaw) return NextResponse.json({ error: 'MISSING' }, { status: 400 });
    const raw = await readText('.data/tasks.json');
    const data = raw ? JSON.parse(raw) : { tasks: [], sales: [] };
    const list = Array.isArray(data.sales) ? data.sales : [];
    const sale = list.find((s: any) => s.userId === userId && String(s.taskId) === String(taskIdRaw))
      || list.find((s: any) => String(s.taskId) === String(taskIdRaw));
    if (!sale) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await sendInstantDeliveryIfReady(userId, sale);
    // Flash + redirect back to admin UI if form
    const accept = req.headers.get('accept') || '';
    if (!accept.includes('application/json')) {
      const back = `/admin/sales/${encodeURIComponent(userId)}/${encodeURIComponent(String(taskIdRaw))}`;
      const res = NextResponse.redirect(new URL(back, req.url), 303);
      try { res.headers.set('Set-Cookie', `flash=OK; Path=/; Max-Age=5; SameSite=Lax`); } catch {}
      return res;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


