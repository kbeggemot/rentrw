import { NextResponse } from 'next/server';
import { listPartners, upsertPartner } from '@/server/partnerStore';
import { updateSaleFromStatus } from '@/server/taskStore';
import { promises as fs } from 'fs';
import path from 'path';
import { updateWithdrawal } from '@/server/withdrawalStore';
// duplicated import removed

export const runtime = 'nodejs';

// Helper: safe getter
function pick<T = unknown>(obj: any, path: string, fallback?: T): T | undefined {
  try {
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return (cur === undefined ? fallback : cur) as T | undefined;
  } catch {
    return fallback;
  }
}

function buildFio(rec: any): string | null {
  const last = String(rec?.last_name || '').trim();
  const first = String(rec?.first_name || '').trim();
  const second = String(rec?.second_name || '').trim();
  const fio = [last, first, second].filter(Boolean).join(' ').trim();
  return fio.length > 0 ? fio : null;
}

export async function POST(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const segs = urlObj.pathname.split('/');
    const userId = decodeURIComponent(segs[segs.length - 1] || '');
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 400 });

    const raw = await req.text();
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

    // Debug: append incoming postback to file
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), userId, body }, null, 2) + '\n';
      await fs.appendFile(path.join(dataDir, 'postbacks.log'), line, 'utf8');
    } catch {}

    const subscription: string = String(body?.subscription || '').toLowerCase();
    const event: string = String(body?.event || '').toLowerCase();
    const data: any = body?.data ?? body;

    if (!subscription) return NextResponse.json({ ok: true });

    if (subscription === 'tasks') {
      // Attempt to extract task id and details
      const taskId = pick<number | string>(data, 'task_id')
        ?? pick<number | string>(data, 'id')
        ?? pick<number | string>(data, 'task.id');

      if (typeof taskId === 'undefined') return NextResponse.json({ ok: true });

      // Normalize status by event name when obvious
      let status: string | undefined;
      if (/task\.paid/.test(event)) status = 'paid';
      else if (/task\.paying/.test(event)) status = 'paying';
      else if (/task\.transfered?/.test(event)) status = 'transfered';
      else if (/task\.pending/.test(event)) status = 'pending';

      // Extract known URLs from payload when present (try multiple shapes)
      const ofdUrl = pick<string>(data, 'acquiring_order.ofd_url')
        ?? pick<string>(data, 'task.acquiring_order.ofd_url')
        ?? pick<string>(data, 'ofd_url')
        ?? pick<string>(data, 'acquiring_order.ofd_receipt_url')
        ?? pick<string>(data, 'ofd_receipt_url');
      const additionalCommissionOfdUrl = pick<string>(data, 'additional_commission_ofd_url')
        ?? pick<string>(data, 'task.additional_commission_ofd_url');
      const npdReceiptUri = pick<string>(data, 'receipt_uri')
        ?? pick<string>(data, 'task.receipt_uri');

      // Fallback statuses from payload when event name is generic
      const aoStatusRaw = pick<string>(data, 'acquiring_order.status')
        ?? pick<string>(data, 'task.acquiring_order.status');
      const rootStatusRaw = pick<string>(data, 'status')
        ?? pick<string>(data, 'task.status');

      await updateSaleFromStatus(userId, taskId, {
        status: status || aoStatusRaw,
        ofdUrl: ofdUrl || undefined,
        additionalCommissionOfdUrl: additionalCommissionOfdUrl || undefined,
        npdReceiptUri: npdReceiptUri || undefined,
      });
      // If paid/transfered — write a local marker so UI can hide QR instantly
      try {
        const fin = String((status || aoStatusRaw || '') as string).toLowerCase();
        if (fin === 'paid' || fin === 'transfered' || fin === 'transferred') {
          const dataDir = path.join(process.cwd(), '.data');
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(path.join(dataDir, `task_paid_${userId}_${String(taskId)}.json`), JSON.stringify({ userId, taskId, status: fin, ts: new Date().toISOString() }), 'utf8');
        }
      } catch {}
      // If this is a Withdrawal and it became paid, write a marker file for UI
      try {
        const kind = String(pick<string>(data, 'type') || pick<string>(data, 'task.type') || '').toLowerCase();
        const aoStatus = String(aoStatusRaw || '').toLowerCase();
        const rootStatus = String(rootStatusRaw || '').toLowerCase();
        if (kind === 'withdrawal') {
          // Persist store for history
          try { await updateWithdrawal(userId, taskId, { status: (rootStatusRaw || status || aoStatus) }); } catch {}
        }
        if (kind === 'withdrawal' && (status === 'paid' || aoStatus === 'paid' || rootStatus === 'paid')) {
          const dataDir = path.join(process.cwd(), '.data');
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(path.join(dataDir, `withdrawal_${userId}_${String(taskId)}.json`), JSON.stringify({ userId, taskId, paidAt: new Date().toISOString() }), 'utf8');
          try { await updateWithdrawal(userId, taskId, { status: 'paid', paidAt: new Date().toISOString() }); } catch {}
        }
      } catch {}
      return NextResponse.json({ ok: true });
    }

    if (subscription === 'executors') {
      // Update partner info based on executor payload
      const executor = data?.executor ?? data;
      const phone: string | undefined = String(executor?.phone || executor?.id || '').trim();
      if (!phone) return NextResponse.json({ ok: true });
      const status: string | null = (executor?.selfemployed_status ?? null) as string | null;
      const fio = buildFio(executor);
      const inn: string | null = (executor?.inn as string | undefined) ?? null;

      // Merge with existing data, ignoring nulls
      const current = (await listPartners(userId)).find((p) => p.phone === phone) ?? {
        phone,
        fio: null,
        status: null,
        inn: null,
        updatedAt: new Date().toISOString(),
      };
      const next = {
        phone,
        fio: fio ?? current.fio,
        status: status ?? current.status,
        inn: inn ?? current.inn,
        updatedAt: new Date().toISOString(),
      };
      await upsertPartner(userId, next);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}








