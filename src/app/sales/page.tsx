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
    <div className="relative">
      {!inn ? (
        <div className="mb-3 p-3 border rounded text-sm bg-white dark:bg-gray-950">Выберите организацию и укажите токен в настройках, чтобы видеть продажи.</div>
      ) : null}
      <div className="absolute right-2 -top-12">
        {/* The actual button is rendered inside SalesClient to keep logic together; this placeholder keeps spacing */}
      </div>
      <SalesClient initial={initial} hasTokenInitial={inn ? hasToken : false} />
    </div>
  );
}


