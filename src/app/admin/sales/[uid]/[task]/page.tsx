import { headers as nextHeaders, cookies as nextCookies } from 'next/headers';
import SaveButton from '@/components/admin/SaveButton';

async function getItem(uid: string, task: string) {
  const qs = `?uid=${encodeURIComponent(uid)}&task=${encodeURIComponent(task)}`;
  const hdrs = await nextHeaders();
  const proto = hdrs.get('x-forwarded-proto') || 'http';
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
  const base = `${proto}://${host}`;
  const cookie = (await nextCookies()).toString();
  const res = await fetch(`${base}/api/admin/data/sales${qs}`, { cache: 'no-store', headers: { cookie } as any });
  const d = await res.json();
  return d?.item || null;
}

export default async function AdminSaleEditor(props: { params: Promise<{ uid: string; task: string }> }) {
  const p = await props.params;
  const item = await getItem(p.uid, p.task);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Редактирование продажи</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <div className="space-y-6">
          <form action={`/admin/sales/${encodeURIComponent(p.uid)}/${encodeURIComponent(p.task)}/save`} method="post" className="space-y-3">
            <input type="hidden" name="uid" defaultValue={p.uid} />
            <input type="hidden" name="taskId" defaultValue={p.task} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">orgInn<input name="orgInn" defaultValue={item.orgInn||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">clientEmail<input name="clientEmail" defaultValue={item.clientEmail||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm col-span-2">description<input name="description" defaultValue={item.description||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">amountGrossRub<input name="amountGrossRub" defaultValue={String(item.amountGrossRub||'')} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">retainedCommissionRub<input name="retainedCommissionRub" defaultValue={String(item.retainedCommissionRub||'')} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">status
                <select name="status" defaultValue={item.status||''} className="w-full border rounded px-2 py-1">
                  {[item.status||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                  <option value="pending">pending</option>
                  <option value="paying">paying</option>
                  <option value="paid">paid</option>
                  <option value="transfered">transfered</option>
                  <option value="transferred">transferred</option>
                  <option value="expired">expired</option>
                  <option value="canceled">canceled</option>
                  <option value="cancelled">cancelled</option>
                  <option value="failed">failed</option>
                  <option value="refunded">refunded</option>
                  <option value="error">error</option>
                  <option value="">—</option>
                </select>
              </label>
              <label className="block text-sm">rootStatus
                <select name="rootStatus" defaultValue={(item.rootStatus||'')} className="w-full border rounded px-2 py-1">
                  {[item.rootStatus||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                  <option value="created">created</option>
                  <option value="assigned">assigned</option>
                  <option value="in_progress">in_progress</option>
                  <option value="completed">completed</option>
                  <option value="paid">paid</option>
                  <option value="cancelled">cancelled</option>
                  <option value="canceled">canceled</option>
                  <option value="">—</option>
                </select>
              </label>
              <label className="block text-sm">serviceEndDate<input name="serviceEndDate" defaultValue={item.serviceEndDate||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">vatRate
                <select name="vatRate" defaultValue={item.vatRate||''} className="w-full border rounded px-2 py-1">
                  {[item.vatRate||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                  <option value="none">none</option>
                  <option value="0">0</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="">—</option>
                </select>
              </label>
              <label className="block text-sm">invoiceIdPrepay<input name="invoiceIdPrepay" defaultValue={item.invoiceIdPrepay||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">invoiceIdOffset<input name="invoiceIdOffset" defaultValue={item.invoiceIdOffset||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">invoiceIdFull<input name="invoiceIdFull" defaultValue={item.invoiceIdFull||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm col-span-2">ofdUrl<input name="ofdUrl" defaultValue={item.ofdUrl||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm col-span-2">ofdFullUrl<input name="ofdFullUrl" defaultValue={item.ofdFullUrl||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">ofdPrepayId<input name="ofdPrepayId" defaultValue={item.ofdPrepayId||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">ofdFullId<input name="ofdFullId" defaultValue={item.ofdFullId||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">additionalCommissionOfdUrl<input name="additionalCommissionOfdUrl" defaultValue={item.additionalCommissionOfdUrl||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">npdReceiptUri<input name="npdReceiptUri" defaultValue={item.npdReceiptUri||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">hidden<input name="hidden" defaultValue={String(item.hidden||'')} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">rwTokenFp<input name="rwTokenFp" defaultValue={item.rwTokenFp||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">rwOrderId<input name="rwOrderId" defaultValue={String(item.rwOrderId||'')} className="w-full border rounded px-2 py-1" /></label>
            </div>
            <div className="flex gap-2">
              <SaveButton label="Сохранить" />
              <a className="px-3 py-2 border rounded" href="/admin?tab=sales">Назад</a>
            </div>
          </form>

          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Действия</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <a className="px-3 py-2 border rounded inline-block" href={`/api/ofd/sync?order=${encodeURIComponent(String(item.orderId))}`} target="_blank">Sync OFD</a>
                <div className="text-xs text-gray-600 mt-1">Опрос OFD по orderId: пытается найти чеки по присвоенным InvoiceId, подтягивает ReceiptId/URL (предоплата и полный), обновляет запись.</div>
              </div>
              <div>
                <a className="px-3 py-2 border rounded inline-block" href={`/api/debug/force-ofd/${encodeURIComponent(String(item.taskId))}?mode=prepay`} target="_blank">Создать предоплату</a>
                <div className="text-xs text-gray-600 mt-1">Принудительно создаёт чек предоплаты с использованием сохранённого InvoiceId A (invoiceIdPrepay). Результат сохраняется в ofdPrepayId/ofdUrl.</div>
              </div>
              <div>
                <a className="px-3 py-2 border rounded inline-block" href={`/api/debug/force-ofd/${encodeURIComponent(String(item.taskId))}?mode=full`} target="_blank">Создать полный расчёт</a>
                <div className="text-xs text-gray-600 mt-1">Принудительно создаёт чек полного расчёта. Используется назначенный InvoiceId C (invoiceIdFull) или логика полного расчёта; результат сохраняется в ofdFullId/ofdFullUrl.</div>
              </div>
              <div>
                <form action="/api/admin/actions/pay" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="taskId" defaultValue={p.task} /><button className="px-3 py-2 border rounded" type="submit">Pay RW</button></form>
                <div className="text-xs text-gray-600 mt-1">Фоново отправляет PATCH /tasks/{`{id}`}/pay в Rocketwork для данной продажи (userId/taskId).</div>
              </div>
              <div>
                <form action="/api/admin/actions/ofd/sync-by-id" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="invoiceId" defaultValue={item.invoiceIdPrepay||''} /><button className="px-3 py-2 border rounded" type="submit">Sync Inv A</button></form>
                <div className="text-xs text-gray-600 mt-1">Синхронизация по InvoiceId A (предоплата): запрашивает статус в OFD и, если найден чек, сохраняет ofdPrepayId/ofdUrl.</div>
              </div>
              <div>
                <form action="/api/admin/actions/ofd/sync-by-id" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="invoiceId" defaultValue={item.invoiceIdOffset||''} /><button className="px-3 py-2 border rounded" type="submit">Sync Inv B</button></form>
                <div className="text-xs text-gray-600 mt-1">Синхронизация по InvoiceId B (зачёт предоплаты): ищет чек полного расчёта по зачёту и сохраняет ofdFullId/ofdFullUrl.</div>
              </div>
              <div>
                <form action="/api/admin/actions/ofd/sync-by-id" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="invoiceId" defaultValue={item.invoiceIdFull||''} /><button className="px-3 py-2 border rounded" type="submit">Sync Inv C</button></form>
                <div className="text-xs text-gray-600 mt-1">Синхронизация по InvoiceId C (полный расчёт «день‑в‑день»): сохраняет ofdFullId/ofdFullUrl, если чек найден.</div>
              </div>
              <div>
                <form action="/api/admin/actions/ofd/sync-by-receipt" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="orderId" defaultValue={String(item.orderId)} /><input type="hidden" name="target" defaultValue="prepay" /><input type="hidden" name="receiptId" defaultValue={item.ofdPrepayId||''} /><button className="px-3 py-2 border rounded" type="submit">Sync RID A</button></form>
                <div className="text-xs text-gray-600 mt-1">Синхронизация по ReceiptId предоплаты: обновляет URL и фиксирует состояние чека предоплаты.</div>
              </div>
              <div>
                <form action="/api/admin/actions/ofd/sync-by-receipt" method="post"><input type="hidden" name="userId" defaultValue={p.uid} /><input type="hidden" name="orderId" defaultValue={String(item.orderId)} /><input type="hidden" name="target" defaultValue="full" /><input type="hidden" name="receiptId" defaultValue={item.ofdFullId||''} /><button className="px-3 py-2 border rounded" type="submit">Sync RID F</button></form>
                <div className="text-xs text-gray-600 mt-1">Синхронизация по ReceiptId полного расчёта: обновляет URL и статус полного чека.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


