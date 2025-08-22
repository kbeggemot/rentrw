import { NextResponse } from 'next/server';
import { listSales } from '@/server/taskStore';
import { getInvoiceIdString } from '@/server/orderStore';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
	const cookie = req.headers.get('cookie') || '';
	const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
	if (m) return decodeURIComponent(m[1]);
	const hdr = req.headers.get('x-user-id');
	return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
	try {
		const userId = getUserId(req);
		if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
		const url = new URL(req.url);
		const segs = url.pathname.split('/');
		const idStr = decodeURIComponent(segs[segs.length - 1] || '');
		const taskId = idStr;
		const sales = await listSales(userId);
		const sale = sales.find((s) => String(s.taskId) === String(taskId)) || null;
		if (!sale) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
		const { getInvoiceIdForPrepay, getInvoiceIdForOffset, getInvoiceIdForFull } = await import('@/server/orderStore');
		const invoiceIdPrepay = await getInvoiceIdForPrepay(Number(sale.orderId));
		const invoiceIdOffset = await getInvoiceIdForOffset(Number(sale.orderId));
		const invoiceIdFull = await getInvoiceIdForFull(Number(sale.orderId));
		return NextResponse.json({ sale: { ...sale, invoiceIdPrepay, invoiceIdOffset, invoiceIdFull } }, { status: 200 });
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'Server error';
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}


