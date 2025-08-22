import { promises as fs } from 'fs';
import path from 'path';

export type OfdAuditEntry = {
  ts: string;
  source: string;
  userId: string;
  orderId: number;
  taskId?: string | number | null;
  action: 'update_ofd_urls';
  patch: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function appendOfdAudit(entry: OfdAuditEntry): Promise<void> {
  if (process.env.OFD_AUDIT !== '1') return; // enable explicitly
  const line = JSON.stringify(entry);
  const dir = path.join(process.cwd(), '.data');
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  const main = path.join(dir, 'ofd_audit.log');
  const perOrder = path.join(dir, `ofd_audit_${entry.userId}_${String(entry.orderId)}.log`);
  try { await fs.appendFile(main, line + '\n', 'utf8'); } catch {}
  try { await fs.appendFile(perOrder, line + '\n', 'utf8'); } catch {}
}


