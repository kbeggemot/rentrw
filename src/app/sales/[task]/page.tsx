import { headers } from 'next/headers';
import { findSaleByTaskId } from '@/server/taskStore';
import { listProductsForOrg } from '@/server/productsStore';
import InstantResendLink from '@/app/sales/InstantResendLink';

export const runtime = 'nodejs';

function makeAbs(h: Headers, path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.API_BASE_URL;
  if (base) return `${base.replace(/\/?$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const host = (h.get('x-forwarded-host') || h.get('host') || '').trim();
  const proto = (h.get('x-forwarded-proto') || 'http').trim();
  if (host) return `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`;
  // Fallback for local dev
  return `http://localhost:3000${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchSale(task: string) {
  const h = await headers();
  const cookie = h.get('cookie') || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  const userId = mc ? decodeURIComponent(mc[1]) : null;
  if (userId) {
    try { return await findSaleByTaskId(userId, task); } catch {}
  }
  // Fоллбэк через HTTP, если по какой-то причине не нашли userId
  try {
    const url = makeAbs(h as any, `/api/sales/by-task/${encodeURIComponent(task)}`);
    const res = await fetch(url, { cache: 'no-store', headers: { cookie } });
    const data = await res.json().catch(() => ({}));
    return res.ok ? (data?.sale || null) : null;
  } catch {
    return null;
  }
}

export default async function SaleDetailsPage(props: { params: Promise<{ task: string }> }) {
  const p = await props.params;
  const sale = await fetchSale(p.task);
  // Preload products for VAT resolution if we have orgInn
  let productsForVat: Array<{ id: string; title: string; vat: any }> = [];
  try {
    const inn = sale && (sale as any).orgInn ? String((sale as any).orgInn).replace(/\D/g, '') : '';
    if (inn) {
      productsForVat = await listProductsForOrg(inn);
    }
  } catch {}

  return (
    <div className="max-w-3xl mx-auto pt-0 pb-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Продажа № {p.task}</h1>
        <a href="/sales" className="p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Закрыть">✕</a>
      </div>

      {!sale ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3">
            <div className="grid grid-cols-[12rem_1fr] gap-y-2 text-sm">
              <div className="text-gray-500">Тип</div>
              <div>{sale.isAgent ? 'Агентская' : 'Прямая'}</div>
              {sale.isAgent ? (
                <>
                  <div className="text-gray-500">Партнёр</div>
                  <div>{(sale as any).partnerFio ? `${(sale as any).partnerFio}${(sale as any).partnerPhone ? ` — ${(sale as any).partnerPhone}` : ''}` : ((sale as any).partnerPhone || '—')}</div>
                </>
              ) : null}
              <div className="text-gray-500">Сумма, ₽</div>
              <div>{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(sale.amountGrossRub || 0))}</div>
              <div className="text-gray-500">Комиссия, ₽</div>
              <div>{sale.isAgent ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(sale.retainedCommissionRub || 0)) : '-'}</div>
              <div className="text-gray-500">Статус оплаты</div>
              <div>{sale.status ?? '-'}</div>
              <div className="text-gray-500">Общий статус</div>
              <div>{(sale as any).rootStatus ?? '-'}</div>
              <div className="text-gray-500">Дата продажи</div>
              <div>{sale.createdAtRw ? new Date(sale.createdAtRw).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-'}</div>
              <div className="text-gray-500">Дата оплаты</div>
              <div>{(sale as any).paidAt ? new Date((sale as any).paidAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'}</div>
              <div className="text-gray-500">Дата окончания оказания услуги</div>
              <div>{sale.serviceEndDate ? new Date(sale.serviceEndDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '-'}</div>
              <div className="text-gray-500">Почта покупателя</div>
              <div>{sale.clientEmail || '-'}</div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-sm">
            <div className="font-semibold mb-2">Чеки</div>
            <div className="grid grid-cols-[12rem_1fr] gap-y-2">
              <div className="text-gray-500">Предоплата</div>
              <div>{sale.ofdUrl ? (<a className="text-black dark:text-white font-semibold hover:underline" href={sale.ofdUrl} target="_blank" rel="noreferrer">Открыть</a>) : '—'}</div>
              <div className="text-gray-500">Полный расчёт</div>
              <div>{sale.ofdFullUrl ? (<a className="text-black dark:text-white font-semibold hover:underline" href={sale.ofdFullUrl} target="_blank" rel="noreferrer">Открыть</a>) : '—'}</div>
              <div className="text-gray-500">Комиссия</div>
              <div>{sale.additionalCommissionOfdUrl ? (<a className="text-black dark:text-white font-semibold hover:underline" href={sale.additionalCommissionOfdUrl} target="_blank" rel="noreferrer">Открыть</a>) : '—'}</div>
              <div className="text-gray-500">НПД</div>
              <div>{sale.npdReceiptUri ? (<a className="text-black dark:text-white font-semibold hover:underline" href={sale.npdReceiptUri} target="_blank" rel="noreferrer">Открыть</a>) : '—'}</div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-sm">
            <div className="font-semibold mb-2">Позиции</div>
            {(() => {
              const rows: Array<{ title: string; qty: number; price: number; vat: string }> = (() => {
                const snapshot = Array.isArray(sale.itemsSnapshot) ? sale.itemsSnapshot : null;
                if (snapshot && snapshot.length > 0) {
                  const saleVat = String(((sale as any).vatRate ?? 'none'));
                  const fmtVat = (code: string | null | undefined) => {
                    const c = String(code ?? '').trim();
                    if (c === 'none') return 'Без НДС';
                    return /^\d+$/.test(c) ? `${c}%` : '—';
                  };
                  return snapshot.map((it: any) => {
                    const title = String(it?.title || '');
                    const id = (it as any)?.id != null ? String((it as any).id) : null;
                    // Prefer VAT captured at sale time in snapshot; fallback to product VAT, else to saleVat
                    const snapVat = (['none','0','5','7','10','20'].includes(String((it as any)?.vat)) ? String((it as any).vat) : undefined) as any;
                    const prod = productsForVat.find((p) => (id && String(p.id) === id) || (p.title && title && String(p.title).toLowerCase() === title.toLowerCase())) as any || null;
                    const vatCode = (sale as any).isAgent ? 'none' : (snapVat || (prod?.vat as any) || saleVat);
                    return {
                      title,
                      qty: Number(it?.qty || 1),
                      price: Number(it?.price || 0),
                      vat: fmtVat(vatCode as any),
                    };
                  });
                }
                const title = String((sale as any).description || 'Свободная услуга');
                const gross = Number((sale as any).amountGrossRub || 0);
                const retained = Number((sale as any).retainedCommissionRub || 0);
                const price = (sale as any).isAgent ? Math.max(0, gross - retained) : gross;
                const vr = String(((sale as any).vatRate ?? 'none'));
                const vat = vr === 'none' ? 'Без НДС' : (/^\d+$/.test(vr) ? `${vr}%` : '—');
                return [{ title, qty: 1, price, vat }];
              })();
              return rows && rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left p-2">Наименование</th>
                        <th className="text-left p-2">Кол-во</th>
                        <th className="text-left p-2">Цена</th>
                        <th className="text-left p-2">НДС</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="p-2">{r.title}</td>
                          <td className="p-2">{r.qty}</td>
                          <td className="p-2">{new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(r.price || 0))}</td>
                          <td className="p-2">{r.vat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-gray-500">—</div>
              );
            })()}
          </div>

          {(() => {
            const items = Array.isArray((sale as any).itemsSnapshot) ? (sale as any).itemsSnapshot : [];
            const hasInstant = items.some((it: any) => typeof it?.instantResult === 'string' ? it.instantResult.trim().length > 0 : false);
            return (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-sm">
                <div className="font-semibold mb-2">Мгновенная выдача</div>
                <div className="grid grid-cols-[12rem_1fr] gap-y-2">
                  <div className="text-gray-500">Включена</div>
                  <div>{hasInstant ? 'Да' : 'Нет'}</div>
                  {hasInstant ? (
                    <>
                      <div className="text-gray-500">Статус письма</div>
                      <div>
                        {(() => {
                          const st = String((sale as any).instantEmailStatus || '').toLowerCase();
                          const map: Record<string, string> = { pending: 'в очереди', sent: 'отправлено', failed: 'ошибка' };
                          const text = map[st] || '—';
                          const dt = (sale as any)?.updatedAt || (sale as any)?.createdAt;
                          const when = dt ? `${new Date(dt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })} в ${new Date(dt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}` : '';
                          return (<>{`${text}${when ? ' ' + when : ''}`} {hasInstant ? (<InstantResendLink userId={(sale as any).userId} taskId={sale.taskId} />) : null}</>);
                        })()}
                      </div>
                      {(sale as any).instantEmailError ? (<><div className="text-gray-500">Ошибка</div><div>{(sale as any).instantEmailError}</div></>) : null}
                      <div className="text-gray-500">Почта покупателя</div>
                      <div>{sale.clientEmail || '—'}</div>
                      <div className="text-gray-500"> </div>
                      <div>
                        <details>
                          <summary className="inline-flex items-center justify-start rounded border px-3 h-9 cursor-pointer select-none bg-white text-black border-gray-300 hover:bg-gray-50 dark:bg-gray-950 dark:text-white dark:border-gray-800 [list-style:none] mt-2 w-fit">
                            Показать результаты
                          </summary>
                          <div className="mt-2 rounded border border-gray-200 dark:border-gray-800 p-2">
                            <div className="grid grid-cols-[12rem_1fr] gap-y-2">
                              {items
                                .filter((it:any)=> (typeof it?.instantResult === 'string' && it.instantResult.trim().length>0))
                                .map((it:any, idx:number)=> (
                                  <div className="contents" key={idx}>
                                    <div className="text-gray-500">{it.title || 'Позиция'}</div>
                                    <div className="whitespace-pre-wrap">{it.instantResult}</div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        </details>
                      </div>
                    </>
                  ) : null}
                </div>
                {/* кнопка переотправки убрана, замена рядом со статусом */}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}


