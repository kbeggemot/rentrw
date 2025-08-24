import { readText, writeText } from './storage';
import path from 'path';

export type OfdAuditEntry = {
  ts: string;
  source: string;
  userId: string;
  orderId: number;
  taskId?: string | number | null;
  action: 'update_ofd_urls' | 'background_pay';
  patch: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function appendOfdAudit(entry: OfdAuditEntry): Promise<void> {
  if (process.env.OFD_AUDIT !== '1') return; // enable explicitly
  const line = JSON.stringify(entry);
  const dir = '.data';
  const main = path.join(dir, 'ofd_audit.log');
  const perOrder = path.join(dir, `ofd_audit_${entry.userId}_${String(entry.orderId)}.log`);
  try {
    const prev = (await readText(main)) || '';
    await writeText(main, prev + line + '\n');
  } catch {}
  try {
    const prev2 = (await readText(perOrder)) || '';
    await writeText(perOrder, prev2 + line + '\n');
  } catch {}
}


