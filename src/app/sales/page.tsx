import SalesClient from './SalesClient';
import { cookies, headers } from 'next/headers';
import { listSales } from '@/server/taskStore';

export default async function SalesPage() {
  const c = await cookies();
  const h = await headers();
  const userId = c.get('session_user')?.value || h.get('x-user-id') || 'default';
  let initial: any[] = [];
  try { initial = await listSales(userId); } catch {}
  return (
    <div className="relative">
      <div className="absolute right-2 -top-12">
        {/* The actual button is rendered inside SalesClient to keep logic together; this placeholder keeps spacing */}
      </div>
      <SalesClient initial={initial} />
    </div>
  );
}


