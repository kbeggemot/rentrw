import { cookies } from 'next/headers';
import PartnersClient from './PartnersClient';
import { listPartners as listPartnersStore } from '@/server/partnerStore';

export default async function PartnersPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_user')?.value || '';
  const partners = userId ? await listPartnersStore(userId) : [];
  return (
    <>
      <h1 className="md:hidden sr-only">Партнёры</h1>
      <PartnersClient initial={partners} />
    </>
  );
}


