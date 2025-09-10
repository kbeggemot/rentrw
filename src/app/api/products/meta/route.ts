import { NextResponse } from 'next/server';
import { getSelectedOrgInn } from '@/server/orgContext';
import { listProductsForOrg } from '@/server/productsStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const inn = getSelectedOrgInn(req);
    if (!inn) return NextResponse.json({ total: 0 });
    const all = await listProductsForOrg(inn);
    return NextResponse.json({ total: all.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


