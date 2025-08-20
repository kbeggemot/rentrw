import { cookies } from 'next/headers';
import PartnersClient from './PartnersClient';

export default async function PartnersPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const res = await fetch('/api/partners', { cache: 'no-store', headers: { cookie: cookieHeader } });
  const data = await res.json().catch(() => ({}));
  const partners = Array.isArray(data?.partners) ? data.partners : [];
  return (
    <>
      <h1 className="md:hidden sr-only">Партнёры</h1>
      <PartnersClient initial={partners} />
    </>
  );
}


