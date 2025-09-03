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
  // SSR token check for banner
  const h = await headers();
  const tokenHeader = await fetch(await makeAbs('/api/settings/token'), { cache: 'no-store', headers: { cookie: h.get('cookie') || '' } });
  let hasToken = false; try { const d = await tokenHeader.json(); hasToken = Boolean(d?.token); } catch {}
  const data = await fetchProducts();
  return (
    <div className="pt-0 pb-4">
      <div className="flex items-center justify-between mb-4" style={{minHeight: '40px'}}>
        <h1 className="hidden md:block text-2xl font-bold">Позиции витрины</h1>
        <Link href="/products/new" className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Создать</Link>
      </div>
      {!hasToken ? (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm mb-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">Для начала работы укажите токен своей организации, полученный в Рокет Ворк.</p>
          <a href="/settings" className="inline-block"><span className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Перейти в настройки</span></a>
        </div>
      ) : null}
      {hasToken ? (<ProductsTable initialItems={data?.items || []} />) : null}
    </div>
  );
}


