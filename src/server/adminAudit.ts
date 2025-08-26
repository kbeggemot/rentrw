import { readText, writeText } from './storage';

export type AdminEntityKind = 'sale' | 'partner' | 'link' | 'org' | 'token' | 'lk_user';

function sanitize(value: string): string { return (value || '').replace(/\s+/g, '').replace(/[^a-zA-Z0-9_\-\.]/g, ''); }

function buildLogPath(kind: AdminEntityKind, parts: string[]): string {
  const key = parts.map((p) => sanitize(String(p))).join('_');
  return `.data/admin_${kind}_${key}.log`;
}

export async function appendAdminEntityLog(
  kind: AdminEntityKind,
  parts: string[],
  entry: { actor?: string | null; source?: 'manual' | 'webhook' | 'system' | 'unknown'; message: string; data?: unknown }
): Promise<void> {
  const ts = new Date().toISOString();
  const rec = { ts, kind, keys: parts, actor: entry.actor ?? null, source: entry.source ?? 'unknown', message: entry.message, data: entry.data } as Record<string, unknown>;
  try {
    const path = buildLogPath(kind, parts);
    const prev = (await readText(path)) || '';
    await writeText(path, prev + JSON.stringify(rec) + '\n');
  } catch {}
}

export async function readAdminEntityLog(kind: AdminEntityKind, parts: string[]): Promise<string> {
  try {
    const path = buildLogPath(kind, parts);
    const raw = await readText(path);
    return raw || '';
  } catch { return ''; }
}


