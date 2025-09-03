import { cookies } from 'next/headers';
import PartnersClient from './PartnersClient';
import { listPartners as listPartnersStore, listPartnersForOrg } from '@/server/partnerStore';
import { getTokenForOrg } from '@/server/orgStore';

export default async function PartnersPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_user')?.value || '';
  const inn = cookieStore.get('org_inn')?.value || '';
  const hasOrg = !!inn;
  let hasToken = false;
  if (userId) {
    if (hasOrg) {
      try { hasToken = !!(await getTokenForOrg(inn, userId)); } catch { hasToken = false; }
    } else {
      hasToken = false;
    }
  }
  const partners = (userId && hasToken) ? (inn ? await listPartnersForOrg(userId, inn) : await listPartnersStore(userId)) : [];
  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <header className="mb-4" />
      {!hasToken ? (
        <div className="mb-3 p-6 border rounded-lg text-sm bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800">
          <p className="text-gray-700 dark:text-gray-300 mb-3">Для начала работы укажите токен своей организации, полученный в Рокет Ворк.</p>
          <a href="/settings" className="inline-block"><span className="px-3 py-2 rounded-md bg-foreground text-white text-sm">Перейти в настройки</span></a>
        </div>
      ) : null}
      {hasToken ? <PartnersClient initial={partners} hasTokenInitial={true} /> : null}
    </div>
  );
}


