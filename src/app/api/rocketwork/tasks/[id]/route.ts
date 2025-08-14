import { NextResponse } from 'next/server';
import { getDecryptedApiToken } from '@/server/secureStore';
import { promises as fs } from 'fs';
import path from 'path';
import { updateSaleFromStatus } from '@/server/taskStore';
import type { RocketworkTask } from '@/types/rocketwork';

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://app.rocketwork.ru/api/';

export async function GET(_: Request) {
  try {
    const cookie = _.headers.get('cookie') || '';
    const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
    const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || _.headers.get('x-user-id') || 'default';
    const token = await getDecryptedApiToken(userId);
    if (!token) return NextResponse.json({ error: 'API токен не задан' }, { status: 400 });

    const base = process.env.ROCKETWORK_API_BASE_URL || DEFAULT_BASE_URL;
    // поддерживаем специальный id last из локального стора для дебага
    const urlObj = new URL(_.url);
    const segs = urlObj.pathname.split('/');
    let taskId = decodeURIComponent(segs[segs.length - 1] || '');
    if (taskId === 'last') {
      try {
        const raw = await fs.readFile(path.join(process.cwd(), '.data', 'tasks.json'), 'utf8');
        const parsed = JSON.parse(raw) as { tasks?: { id: string | number }[] };
        const last = parsed.tasks && parsed.tasks.length > 0 ? parsed.tasks[parsed.tasks.length - 1].id : null;
        if (last != null) taskId = String(last);
      } catch {}
    }
    const url = new URL(`tasks/${encodeURIComponent(taskId)}`, base.endsWith('/') ? base : base + '/').toString();

    let res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      // disable any framework caches
      cache: 'no-store',
    });

    let text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    // лог статуса для отладки
    try {
      const dataDir = path.join(process.cwd(), '.data');
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, 'last_task_status.json'), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
    } catch {}

    if (!res.ok) {
      const maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      const message = (maybeObj?.error as string | undefined) || text || 'External API error';
      return NextResponse.json({ error: message }, { status: res.status });
    }

    let maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    let normalized: RocketworkTask = (maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask);

    // Attempt short polling for receipts if already paid/transferred and receipts missing
    let tries = 0;
    const hasAnyReceipt = (obj: RocketworkTask): boolean => {
      const purchase = (obj?.ofd_url || obj?.acquiring_order?.ofd_url) ?? undefined;
      const addComm = obj?.additional_commission_ofd_url ?? undefined;
      if (obj?.additional_commission_value) {
        return Boolean(purchase) && Boolean(addComm);
      }
      return Boolean(purchase);
    };
    while (['paid', 'transferred', 'transfered'].includes(String(normalized?.acquiring_order?.status || '').toLowerCase()) && tries < 5 && !hasAnyReceipt(normalized)) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
      normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
      tries += 1;
    }

    // If agent sale got transferred and root status is only completed, trigger pay
    try {
      const aoStatus = String(normalized?.acquiring_order?.status || '').toLowerCase();
      const rootStatus = String(normalized?.status || '').toLowerCase();
      const hasAgent = Boolean(normalized?.additional_commission_value);
      if (hasAgent && aoStatus === 'transfered' && rootStatus === 'completed') {
        const payUrl = new URL(`tasks/${encodeURIComponent(taskId)}/pay`, base.endsWith('/') ? base : base + '/').toString();
        await fetch(payUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        // After pay, poll specifically until NPD receipt appears
        let triesNpd = 0;
        while (!normalized?.receipt_uri && triesNpd < 5) {
          await new Promise((r) => setTimeout(r, 1200));
          res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
          text = await res.text();
          try { data = text ? JSON.parse(text) : null; } catch { data = text; }
          maybeObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
          normalized = ((maybeObj?.task as RocketworkTask) ?? (data as RocketworkTask));
          triesNpd += 1;
        }
      }
    } catch {}

    // Persist into sales store
    try {
      const ofdUrl = (normalized?.ofd_url as string | undefined)
        ?? (normalized?.acquiring_order?.ofd_url as string | undefined)
        ?? null;
      const addOfd = (normalized?.additional_commission_ofd_url as string | undefined)
        ?? null;
      const npdReceipt = (normalized?.receipt_uri as string | undefined) ?? null;
      await updateSaleFromStatus(userId, taskId, { status: normalized?.acquiring_order?.status, ofdUrl, additionalCommissionOfdUrl: addOfd, npdReceiptUri: npdReceipt });
    } catch {}

    // Также проставим заголовок, чтобы клиент не кешировал
    return new NextResponse(JSON.stringify(normalized), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


