import { headers } from 'next/headers';
import ManageLinkClient from './ManageLinkClient';

export const runtime = 'nodejs';

async function getLink(code: string) {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const protoRaw = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const base = `${protoRaw}://${host}`;
  const abs = new URL(`/api/links/${encodeURIComponent(code)}`, base).toString();
  let r: Response | null = null;
  try {
    r = await fetch(abs, { cache: 'no-store', headers: { cookie } });
  } catch {
    const env = (process.env.NEXT_PUBLIC_BASE_URL || process.env.API_BASE_URL || '').toString();
    if (env) {
      try { r = await fetch(new URL(`/api/links/${encodeURIComponent(code)}`, env.endsWith('/') ? env : env + '/').toString(), { cache: 'no-store', headers: { cookie } }); } catch {}
    }
    if (!r) {
      try { r = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: 'no-store', headers: { cookie } }); } catch {}
    }
  }
  if (!r) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return d;
}

async function getSales(code: string, page: number, userId?: string) {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const protoRaw = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const base = `${protoRaw}://${host}`;
  const hdrs: Record<string, string> = { cookie } as any;
  if (userId) hdrs['x-user-id'] = userId;
  const abs = new URL(`/api/sales?link=${encodeURIComponent(code)}&success=1`, base).toString();
  let r: Response | null = null;
  try { r = await fetch(abs, { cache: 'no-store', headers: hdrs }); } catch {
    const env = (process.env.NEXT_PUBLIC_BASE_URL || process.env.API_BASE_URL || '').toString();
    if (env) {
      try { r = await fetch(new URL(`/api/sales?link=${encodeURIComponent(code)}&success=1`, env.endsWith('/') ? env : env + '/').toString(), { cache: 'no-store', headers: hdrs }); } catch {}
    }
    if (!r) {
      try { r = await fetch(`/api/sales?link=${encodeURIComponent(code)}&success=1`, { cache: 'no-store', headers: hdrs }); } catch {}
    }
  }
  if (!r) return { items: [], total: 0 } as { items: any[]; total: number };
  const d = await r.json().catch(() => ({}));
  const all = r.ok && Array.isArray(d?.sales) ? d.sales : [];
  const start = (page - 1) * 20;
  return { items: all.slice(start, start + 20), total: all.length } as { items: any[]; total: number };
}

export default async function ManageLinkPage(props: { params: Promise<{ code: string }> }) {
  const p = await props.params;
  const code = String(p.code || '');
  const link = await getLink(code);
  const { items, total } = await getSales(code, 1, link?.userId);
  const tg = `https://t.me/yplaru_bot/link?startapp=${encodeURIComponent(code)}`;
  const url = `https://ypla.ru/link/${encodeURIComponent(code)}`;
  if (!link) {
    return (
      <div className="max-w-3xl mx-auto pt-0 pb-4">
        <div className="flex items-center justify-end mb-3">
          <a href="/link" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
          <div className="text-sm text-gray-600 dark:text-gray-300">Ссылка не найдена</div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-semibold">Мгновенная оплата</div>
        <a href="/link" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
      </div>
      <ManageLinkClient code={code} link={link} items={items} total={total} url={url} tg={tg} />
    </div>
  );
}


