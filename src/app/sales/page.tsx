import SalesClient from './SalesClient';
import { cookies, headers } from 'next/headers';
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
  // Больше не выполняем тяжёлую SSR-загрузку — отрисуем мгновенно, а данные подтянем на клиенте по индексу
  const initial: any[] = [];
  return (
    <div className={(inn && hasToken) ? "mx-auto w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl pt-0 pb-4" : "max-w-3xl mx-auto pt-0 pb-4"}>
      <header className="mb-4">
        <h1 className="hidden md:block text-2xl font-bold">Продажи</h1>
      </header>
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


