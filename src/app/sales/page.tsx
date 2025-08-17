import { cookies, headers } from 'next/headers';
import SalesClient from './SalesClient';

export default async function SalesPage() {
	const cookieStore = await cookies();
	const h = await headers();
	const proto = h.get('x-forwarded-proto') || 'http';
	const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
	const baseUrl = `${proto}://${host}`;
	const cookieHeader = cookieStore
		.getAll()
		.map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
		.join('; ');
	const res = await fetch(`${baseUrl}/api/sales`, { cache: 'no-store', headers: { cookie: cookieHeader } });
	const data = await res.json().catch(() => ({}));
	const initial = Array.isArray(data?.sales) ? data.sales : [];
	return (
		<>
			<h1 className="md:hidden sr-only">Продажи</h1>
			<SalesClient initial={initial} />
		</>
	);
}


