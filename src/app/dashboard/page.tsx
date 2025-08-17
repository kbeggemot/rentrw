import { cookies, headers } from 'next/headers';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const res = await fetch(`${baseUrl}/api/settings/token`, { cache: 'no-store', headers: { cookie: cookieHeader } });
  const data = await res.json().catch(() => ({}));
  const hasToken = !!data?.token;
  return (
    <>
      <h1 className="md:hidden sr-only">Касса</h1>
      <DashboardClient hasTokenInitial={hasToken} />
    </>
  );
}


