import { NextResponse } from 'next/server';
import { fermaGetAuthTokenCached, fermaGetReceiptStatus, buildReceiptViewUrl } from '@/server/ofdFerma';
import { getInvoiceIdString } from '@/server/orderStore';
import { listSales } from '@/server/taskStore';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request, ctx: { params: { order: string } }) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const orderId = Number(ctx.params.order);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'BAD_ORDER' }, { status: 400 });

    const sales = await listSales(userId);
    const sale = sales.find((s) => Number(s.orderId) === orderId) || null;

    const baseUrl = process.env.FERMA_BASE_URL || 'https://ferma.ofd.ru/';
    const token = await fermaGetAuthTokenCached(process.env.FERMA_LOGIN || '', process.env.FERMA_PASSWORD || '', { baseUrl });

    const attempts: any[] = [];

    async function tryStatus(kind: string, id: string) {
      try {
        const st = await fermaGetReceiptStatus(id, { baseUrl, authToken: token });
        let link: string | undefined;
        try {
          const obj = st.rawText ? JSON.parse(st.rawText) : {};
          const direct = obj?.Data?.Device?.OfdReceiptUrl as string | undefined;
          const fn = obj?.Data?.Fn || obj?.Fn; const fd = obj?.Data?.Fd || obj?.Fd; const fp = obj?.Data?.Fp || obj?.Fp;
          link = direct && direct.length > 0 ? direct : (fn && fd != null && fp != null ? buildReceiptViewUrl(fn, fd, fp) : undefined);
        } catch {}
        attempts.push({ kind, id, status: st.rawStatus, hasLink: !!link, sample: st.rawText?.slice(0, 400) || null });
        return link;
      } catch (e) {
        attempts.push({ kind, id, error: e instanceof Error ? e.message : String(e) });
        return undefined;
      }
    }

    // 1) По ofdFullId / ofdPrepayId, если сохранены в сторе
    let link: string | undefined;
    if (sale && (sale as any).ofdFullId) link = await tryStatus('ofdFullId', String((sale as any).ofdFullId));
    if (!link && sale && (sale as any).ofdPrepayId) link = await tryStatus('ofdPrepayId', String((sale as any).ofdPrepayId));

    // 2) По InvoiceId (prefix-<orderId>)
    if (!link) {
      const invoiceId = await getInvoiceIdString(orderId);
      link = await tryStatus('invoiceId', invoiceId);
    }

    // 3) По «голому» orderId на случай нестандартной настройки
    if (!link) link = await tryStatus('orderId_raw', String(orderId));

    return NextResponse.json({ ok: true, orderId, sale: sale || null, linkFound: !!link, link: link || null, attempts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ERROR';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


