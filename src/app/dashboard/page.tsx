import { cookies } from 'next/headers';
import DashboardClient from './DashboardClient';
import { getDecryptedApiToken } from '@/server/secureStore';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_user')?.value || '';
  const token = userId ? await getDecryptedApiToken(userId) : null;
  const hasToken = !!token;
  return (
    <>
      <h1 className="md:hidden sr-only">Касса</h1>
      <DashboardClient hasTokenInitial={hasToken} />
    </>
  );
}


