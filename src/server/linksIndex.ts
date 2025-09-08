import path from 'path';
import { readText, writeText } from './storage';

const LINKS_INDEX_ROOT = '.data/links_index';
const BY_CODE_DIR = path.join(LINKS_INDEX_ROOT, 'by_code');

export type LinkByCodeMapping = { userId: string; orgInn?: string | null; code: string };

function byCodePath(code: string): string {
  return path.join(BY_CODE_DIR, `${String(code)}.json`).replace(/\\/g, '/');
}

export async function upsertLinkByCode(code: string, mapping: LinkByCodeMapping): Promise<void> {
  try { await writeText(byCodePath(code), JSON.stringify(mapping, null, 2)); } catch {}
}

export async function deleteLinkByCode(code: string): Promise<void> {
  try { await writeText(byCodePath(code), ''); } catch {}
}

export async function readLinkByCode(code: string): Promise<LinkByCodeMapping | null> {
  try {
    const raw = await readText(byCodePath(code));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.userId === 'string') return { userId: d.userId, orgInn: d.orgInn ?? null, code };
    return null;
  } catch { return null; }
}


