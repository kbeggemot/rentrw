export const runtime = 'nodejs';

import Link from 'next/link';
import ProductsTable from './table';
import { headers } from 'next/headers';

async function makeAbs(path: string): Promise<string> {
  if (/^https?:\/\//i.test(path)) return path;
  const env = process.env.NEXT_PUBLIC_BASE_URL || process.env.API_BASE_URL;
  if (env) return `${env.replace(/\/?$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchProducts() {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const r = await fetch(await makeAbs('/api/products'), { cache: 'no-store', headers: { cookie } });
  try { const j = await r.json(); return j; } catch { return { items: [], categories: [] }; }
}

export default async function ProductsPage() {
  const data = await fetchProducts();
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mt-2 mb-4">
        <h1 className="text-2xl font-bold">Позиции витрины</h1>
        <Link href="/products/new" className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Создать</Link>
      </div>
      <ProductsTable initialItems={data?.items || []} />
    </div>
  );
}


