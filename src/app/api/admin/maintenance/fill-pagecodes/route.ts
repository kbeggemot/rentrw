import { NextResponse } from 'next/server';
import { appendAdminEntityLog } from '@/server/adminAudit';
import { getAdminByUsername } from '@/server/adminStore';
import { getSelectedOrgInn } from '@/server/orgContext';
import { listAllSalesForOrg, setSalePageCode } from '@/server/taskStore';
import { getOrCreateSalePageCode } from '@/server/salePageStore';
import { readText, writeText } from '@/server/storage';

export const runtime = 'nodejs';

async function requireSuperadmin(req: Request): Promise<string | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  const username = m ? decodeURIComponent(m[1]) : null;
  if (!username) return null;
  try {
    const user = await getAdminByUsername(username);
    if (!user || user.role !== 'superadmin') return null;
    return username;
  } catch { return null; }
}

const STATUS_FILE = '.data/maintenance/fill_pagecodes_status.json';
async function writeStatus(partial: any) {
  try {
    const prevRaw = await readText(STATUS_FILE).catch(() => null);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    const next = { ...prev, ...partial };
    await writeText(STATUS_FILE, JSON.stringify(next, null, 2));
  } catch {}
}

function normalizeOrderIdLike(value: string | number): number | null {
  const m = String(value).match(/(\d+)/g);
  const last = m && m.length > 0 ? Number(m[m.length - 1]) : NaN;
  return Number.isFinite(last) ? last : null;
}

async function runFill(orgInn: string): Promise<{ processed: number; errors: number }> {
  await writeStatus({ running: true, processed: 0, errors: 0, startedAt: new Date().toISOString() });
  let processed = 0, errors = 0;
  try {
    const sales = await listAllSalesForOrg(orgInn);
    // финальные статусы
    const finals = sales.filter((s) => {
      const st = String((s as any)?.status || '').toLowerCase();
      return st === 'paid' || st === 'transfered' || st === 'transferred';
    });
    const chunk = 64;
    for (let i = 0; i < finals.length; i += chunk) {
      const slice = finals.slice(i, i + chunk);
      const results = await Promise.allSettled(slice.map(async (s) => {
        try {
          const orderNum = normalizeOrderIdLike(s.orderId);
          if (!orderNum) return false;
          const code = await getOrCreateSalePageCode(s.userId, orderNum);
          await setSalePageCode(s.userId, s.taskId, code || null);
          return true;
        } catch { return false; }
      }));
      for (const r of results) { if (r.status === 'fulfilled' && r.value) processed += 1; else errors += 1; }
      await writeStatus({ running: true, processed, errors });
    }
  } catch { /* ignore */ }
  await writeStatus({ running: false, processed, errors, finishedAt: new Date().toISOString() });
  return { processed, errors };
}

async function handle(req: Request) {
  const username = await requireSuperadmin(req);
  if (!username) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const url = new URL(req.url);
  const asyncMode = url.searchParams.get('async') === '1' || url.searchParams.get('mode') === 'async';
  const inn = (getSelectedOrgInn(req) || '').replace(/\D/g, '');
  if (!inn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
  if (asyncMode) {
    setTimeout(() => { void runFill(inn); }, 0);
    try { await appendAdminEntityLog('sale', ['fill-pagecodes'], { source: 'manual', message: 'start', data: { inn, by: username } }); } catch {}
    return NextResponse.json({ ok: true, started: true }, { status: 202 });
  }
  const { processed, errors } = await runFill(inn);
  try { await appendAdminEntityLog('sale', ['fill-pagecodes'], { source: 'manual', message: 'done', data: { inn, processed, errors, by: username } }); } catch {}
  return NextResponse.json({ ok: true, processed, errors });
}

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }


