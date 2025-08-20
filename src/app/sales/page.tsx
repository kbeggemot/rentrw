import { cookies } from 'next/headers';
import SalesClient from './SalesClient';
import { listSales } from '@/server/taskStore';

export default async function SalesPage() {
	const cookieStore = await cookies();
	const userId = cookieStore.get('session_user')?.value || '';
	const initial = userId ? await listSales(userId) : [];
	return (
		<>
			<h1 className="md:hidden sr-only">Продажи</h1>
			<SalesClient initial={initial} />
		</>
	);
}


