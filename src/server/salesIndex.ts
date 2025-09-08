import path from 'path';
import { readText, writeText } from './storage';

const SALES_INDEX_ROOT = '.data/sales_index';
const BY_USER_DIR = path.join(SALES_INDEX_ROOT, 'by_user');
const BY_ORDER_DIR = path.join(SALES_INDEX_ROOT, 'by_order');

export type SaleIndexRow = {
  inn: string; // digits-only
  userId: string;
  taskId: string | number;
  orderId: string | number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  status?: string | null;
};

function byUserIndexPath(userId: string): string {
  return path.join(BY_USER_DIR, `${userId}.json`).replace(/\\/g, '/');
}

function byOrderIndexPath(orderKey: string | number): string {
  return path.join(BY_ORDER_DIR, `${String(orderKey)}.json`).replace(/\\/g, '/');
}

export async function readUserIndex(userId: string): Promise<SaleIndexRow[]> {
  try {
    const raw = await readText(byUserIndexPath(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function upsertUserIndex(row: SaleIndexRow): Promise<void> {
  try {
    const p = byUserIndexPath(row.userId);
    const raw = await readText(p);
    let arr: SaleIndexRow[] = [];
    try { arr = raw ? JSON.parse(raw) : []; } catch { arr = []; }
    const idx = arr.findIndex((r) => String(r.taskId) === String(row.taskId));
    if (idx === -1) arr.push(row); else arr[idx] = row;
    arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    await writeText(p, JSON.stringify(arr, null, 2));
  } catch {}
}

export async function upsertOrderIndex(orderKey: string | number, mapping: { inn: string; userId: string; taskId: string | number }): Promise<void> {
  try {
    await writeText(byOrderIndexPath(orderKey), JSON.stringify(mapping, null, 2));
  } catch {}
}

export async function readOrderIndexMapping(orderKey: string | number): Promise<{ inn: string; userId: string; taskId: string | number } | null> {
  try {
    const raw = await readText(byOrderIndexPath(orderKey));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.inn === 'string' && typeof d.userId === 'string' && typeof d.taskId !== 'undefined') return d as any;
    return null;
  } catch {
    return null;
  }
}


