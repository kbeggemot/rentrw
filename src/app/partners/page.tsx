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
    <>
      <h1 className="md:hidden sr-only">Партнёры</h1>
      <PartnersClient initial={partners} hasTokenInitial={hasToken} />
    </>
  );
}


