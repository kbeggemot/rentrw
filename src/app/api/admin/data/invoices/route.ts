import { NextResponse } from 'next/server';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  return /(?:^|;\s*)admin_user=([^;]+)/.test(cookie);
}

type Invoice = {
  id: number;
  code: string;
  createdAt: string;
  phone: string;
  orgInn: string;
  orgName: string;
  email?: string | null;
  description: string;
  amount: string;
  executorFio?: string | null;
  executorInn?: string | null;
};

async function readInvoices(): Promise<Invoice[]> {
  try {
    const raw = await readText('.data/invoices.json');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const items = await readInvoices();
  const sorted = [...items].sort((a: any, b: any) => {
    const at = Date.parse(a?.createdAt || 0);
    const bt = Date.parse(b?.createdAt || 0);
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at; // newest first
  });
  return NextResponse.json({ items: sorted });
}


