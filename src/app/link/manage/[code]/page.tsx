import { headers } from 'next/headers';
import ManageLinkClient from './ManageLinkClient';

export const runtime = 'nodejs';

async function getLink(code: string) {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'http';
  const base = `${proto}://${host}`;
  const r = await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, base).toString(), { cache: 'no-store', headers: { cookie } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return d;
}

async function getSales(code: string, page: number) {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'http';
  const base = `${proto}://${host}`;
  const r = await fetch(new URL(`/api/sales?link=${encodeURIComponent(code)}&success=1`, base).toString(), { cache: 'no-store', headers: { cookie } });
  const d = await r.json().catch(() => ({}));
  const all = r.ok && Array.isArray(d?.sales) ? d.sales : [];
  const start = (page - 1) * 20;
  return { items: all.slice(start, start + 20), total: all.length } as { items: any[]; total: number };
}

export default async function ManageLinkPage(props: { params: Promise<{ code: string }> }) {
  const p = await props.params;
  const code = String(p.code || '');
  const link = await getLink(code);
  const { items, total } = await getSales(code, 1);
  const tg = `https://t.me/yplaru_bot/link?startapp=${encodeURIComponent(code)}`;
  const url = `https://ypla.ru/link/${encodeURIComponent(code)}`;
  if (!link) {
    return (
      <div className="max-w-3xl mx-auto pt-0 pb-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
          <div className="text-sm text-gray-600 dark:text-gray-300">Ссылка не найдена</div>
        </div>
      </div>
    );
  }
  return (<ManageLinkClient code={code} link={link} items={items} total={total} url={url} tg={tg} />);
}


