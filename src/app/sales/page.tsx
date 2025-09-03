import SalesClient from './SalesClient';
import { cookies, headers } from 'next/headers';
import { listSales, listSalesForOrg } from '@/server/taskStore';
import { getTokenForOrg } from '@/server/orgStore';

export default async function SalesPage() {
  const c = await cookies();
  const h = await headers();
  const userId = c.get('session_user')?.value || h.get('x-user-id') || 'default';
  const inn = c.get('org_inn')?.value || null;
  let hasToken = false;
  if (inn && userId) {
    try { hasToken = !!(await getTokenForOrg(inn, userId)); } catch { hasToken = false; }
  }
  let initial: any[] = [];
  try {
    if (hasToken) {
      const all = await listSales(userId);
      initial = inn ? all.filter((s: any) => String((s as any).orgInn || 'неизвестно') === inn || (s as any).orgInn == null || String((s as any).orgInn) === 'неизвестно') : all;
    }
  } catch {}
  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <header className="mb-4" />
      {(!inn || !hasToken) ? (
        <div className="mb-3 p-6 border rounded-lg text-sm bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800">
          <p className="text-gray-700 dark:text-gray-300 mb-3">Для начала работы укажите токен своей организации, полученный в Рокет Ворк.</p>
          <a href="/settings" className="inline-block"><span className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Перейти в настройки</span></a>
        </div>
      ) : null}
      {(inn && hasToken) ? <SalesClient initial={initial} hasTokenInitial={true} /> : null}
    </div>
  );
}


