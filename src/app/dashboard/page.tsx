import { cookies } from 'next/headers';
import DashboardClient from './DashboardClient';
import { getDecryptedApiToken } from '@/server/secureStore';
import { getTokenForOrg } from '@/server/orgStore';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('session_user')?.value || '';
  const inn = cookieStore.get('org_inn')?.value || '';
  let token: string | null = null;
  if (userId) {
    if (inn) {
      try { token = await getTokenForOrg(inn, userId); } catch { token = null; }
    }
  }
  const hasToken = !!token;
  return (
    <>
      <h1 className="md:hidden sr-only">Касса</h1>
      <DashboardClient hasTokenInitial={hasToken} />
    </>
  );
}


