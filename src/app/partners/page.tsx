import { cookies, headers } from 'next/headers';
import PartnersClient from './PartnersClient';

export default async function PartnersPage() {
  const cookieStore = await cookies();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  const res = await fetch(`${baseUrl}/api/partners`, { cache: 'no-store', headers: { cookie: cookieHeader } });
  const data = await res.json().catch(() => ({}));
  const partners = Array.isArray(data?.partners) ? data.partners : [];
  return <PartnersClient initial={partners} />;
}


