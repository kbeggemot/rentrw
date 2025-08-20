import { cookies } from 'next/headers';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const res = await fetch('/api/settings/token', { cache: 'no-store', headers: { cookie: cookieHeader } });
  const data = await res.json().catch(() => ({}));
  const hasToken = !!data?.token;
  return (
    <>
      <h1 className="md:hidden sr-only">Касса</h1>
      <DashboardClient hasTokenInitial={hasToken} />
    </>
  );
}


