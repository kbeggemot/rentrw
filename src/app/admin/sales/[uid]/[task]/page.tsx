import SaveButton from '@/components/admin/SaveButton';
import FlashToast from '@/components/admin/FlashToast';
import { readText } from '@/server/storage';
import { readAdminEntityLog } from '@/server/adminAudit';
import { findOrgByFingerprint } from '@/server/orgStore';

async function getItem(uid: string, task: string) {
  try {
    const raw = await readText('.data/tasks.json');
    if (!raw) return null;
    let data: any = null; try { data = JSON.parse(raw); } catch { data = {}; }
    const list = Array.isArray(data?.sales) ? data.sales : [];
    const one = list.find((x: any) => String(x.userId) === uid && (x.taskId == (task as any)))
      || list.find((x: any) => (x.taskId == (task as any)))
      || null;
    return one;
  } catch { return null; }
}

export default async function AdminSaleEditor(props: { params: Promise<{ uid: string; task: string }> }) {
  const p = await props.params;
  const item = await getItem(p.uid, p.task);
  const log = await readAdminEntityLog('sale', [String(p.uid), String(p.task)]);
  let suggestedInn: string | null = null;
  try {
    const fp = (item as any)?.rwTokenFp;
    if (fp) {
      const org = await findOrgByFingerprint(fp);
      suggestedInn = org?.inn ?? null;
    }
  } catch {}
  const orgInnDefault = ((item as any)?.orgInn && String((item as any).orgInn) !== 'неизвестно') ? (item as any).orgInn : (suggestedInn || '');
  const usedSuggested = (!((item as any)?.orgInn) || String((item as any).orgInn) === 'неизвестно') && !!suggestedInn;
  return (
    <div className="max-w-3xl mx-auto p-4">
      <FlashToast />
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Редактирование продажи</h1>
        <a className="inline-flex items-center justify-center w-8 h-8 border rounded" href="/admin?tab=sales" aria-label="Закрыть">×</a>
      </div>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <div className="space-y-6">
          {/* Сводка по продаже */}
          <div className="border rounded p-3 bg-white dark:bg-gray-950">
            <h2 className="text-lg font-semibold mb-2">Сводка</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-gray-600">taskId (RW)</div>
                <div className="font-mono">{String((item as any).taskId)}</div>
              </div>
              <div>
                <div className="text-gray-600">orderId</div>
                <div className="font-mono">{String((item as any).orderId)}</div>
              </div>
              <div>
                <div className="text-gray-600">Тип продажи</div>
                <div>{(item as any).isAgent ? 'агентская' : 'прямая'}</div>
              </div>
              <div>
                <div className="text-gray-600">Способ оплаты</div>
                <div>{(() => { const it:any=item; const m=String((it as any)?.method||'').toLowerCase(); const ao=(it as any)?.acquiring_order; const hint=(it as any)?.acqMethod; const byAo=ao && typeof (ao as any)?.type==='string' ? String((ao as any).type).toUpperCase() : ''; const txt = (m==='card'||m==='cards')?'карта':(m==='qr'||byAo==='QR'?'СБП':(hint==='card'?'карта':(hint==='qr'?'СБП':''))); return txt||'—'; })()}</div>
              </div>
              <div>
                <div className="text-gray-600">Канал</div>
                <div>{(() => { const it:any=item; if (it.linkCode) return 'по ссылке'; if (it.payerTgId) return 'через Telegram'; if (String(it.source||'')==='ui') return 'с дашборда'; return 'внешняя'; })()}</div>
              </div>
              {(item as any).rwOrderId ? (
                <div>
                  <div className="text-gray-600">rwOrderId</div>
                  <div className="font-mono">{String((item as any).rwOrderId)}</div>
                </div>
              ) : null}
              {(item as any).agentDescription ? (
                <div className="sm:col-span-2">
                  <div className="text-gray-600">Описание агента</div>
                  <div className="break-words">{String((item as any).agentDescription)}</div>
                </div>
              ) : null}
              {(item as any).isAgent ? (
                <div>
                  <div className="text-gray-600">Удержанная комиссия, ₽</div>
                  <div>{typeof (item as any).retainedCommissionRub==='number' ? new Intl.NumberFormat('ru-RU',{ minimumFractionDigits:2, maximumFractionDigits:2 }).format((item as any).retainedCommissionRub) : '—'}</div>
                </div>
              ) : null}
              {((item as any).partnerPhone || (item as any).partnerFio) ? (
                <div className="sm:col-span-2">
                  <div className="text-gray-600">Партнёр (агент)</div>
                  {(() => {
                    const fio = String((item as any).partnerFio || '').trim();
                    const phoneRaw = String((item as any).partnerPhone || '').trim();
                    const phoneDigits = phoneRaw.replace(/\D/g, '');
                    const label = [fio || null, phoneRaw || null].filter(Boolean).join(' · ');
                    const href = `/admin/partners/${encodeURIComponent(String(p.uid))}/${encodeURIComponent(phoneDigits || phoneRaw)}`;
                    return (
                      <a className="text-blue-600 break-words" href={href}>{label || '—'}</a>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          </div>

          {/* Данные о позициях */}
          {Array.isArray((item as any).itemsSnapshot) && (item as any).itemsSnapshot.length > 0 ? (
            <div className="border rounded p-3 bg-white dark:bg-gray-950">
              <h2 className="text-lg font-semibold mb-2">Позиции</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr><th className="text-left px-2 py-1">Название</th><th className="text-left px-2 py-1">Кол-во</th><th className="text-left px-2 py-1">Цена</th><th className="text-left px-2 py-1">НДС</th></tr></thead>
                  <tbody>
                    {(item as any).itemsSnapshot.map((it:any, idx:number)=> (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1 break-words">{String(it?.title||'')}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{Number(it?.qty||0)}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{new Intl.NumberFormat('ru-RU',{ minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(it?.price||0))}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{String(it?.vat||'—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Данные покупателя (Telegram) */}
          {((item as any).payerTgId || (item as any).payerTgUsername || (item as any).payerTgFirstName || (item as any).payerTgLastName) ? (
            <div className="border rounded p-3 bg-white dark:bg-gray-950">
              <h2 className="text-lg font-semibold mb-2">Покупатель (Telegram)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div><div className="text-gray-600">tg_id</div><div className="font-mono">{String((item as any).payerTgId||'—')}</div></div>
                <div><div className="text-gray-600">username</div><div className="font-mono">{(item as any).payerTgUsername? ('@'+String((item as any).payerTgUsername)):'—'}</div></div>
                <div><div className="text-gray-600">first_name</div><div>{String((item as any).payerTgFirstName||'—')}</div></div>
                <div><div className="text-gray-600">last_name</div><div>{String((item as any).payerTgLastName||'—')}</div></div>
              </div>
            </div>
          ) : null}

          {/* Подписанный документ */}
          {((item as any).termsDocHash || (item as any).termsAcceptedAt) ? (
            <div className="border rounded p-3 bg-white dark:bg-gray-950">
              <h2 className="text-lg font-semibold mb-2">Подписанный документ</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div><div className="text-gray-600">Название</div><div>{String((item as any).termsDocName||'—')}</div></div>
                <div><div className="text-gray-600">Хэш</div><div className="font-mono break-all">{String((item as any).termsDocHash||'—')}</div></div>
                <div>
                  <div className="text-gray-600">Открыть</div>
                  <div>
                    {((item as any).termsDocHash) ? (
                      <a className="px-3 py-2 border rounded inline-block" href={`/api/docs/${encodeURIComponent(String((item as any).termsDocHash))}`} target="_blank" rel="noreferrer">Открыть документ</a>
                    ) : '—'}
                  </div>
                </div>
                <div className="sm:col-span-2"><div className="text-gray-600">Принято (МСК)</div><div>{(item as any).termsAcceptedAt ? new Date((item as any).termsAcceptedAt).toLocaleString('ru-RU',{ timeZone:'Europe/Moscow' }) : '—'}</div></div>
              </div>
            </div>
          ) : null}

          {/* Мгновенная выдача */}
          <div className="border rounded p-3 bg-white dark:bg-gray-950">
            <h2 className="text-lg font-semibold mb-2">Мгновенная выдача</h2>
            <div className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><div className="text-gray-600">Статус</div><div>{(item as any).instantEmailStatus || '—'}</div></div>
              <div><div className="text-gray-600">Ошибка</div><div className="break-words">{(item as any).instantEmailError || '—'}</div></div>
            </div>
          </div>

          <form action={`/admin/sales/${encodeURIComponent(p.uid)}/${encodeURIComponent(p.task)}/save`} method="post" className="space-y-3">
            <input type="hidden" name="uid" defaultValue={p.uid} />
            <input type="hidden" name="taskId" defaultValue={p.task} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">orgInn<input name="orgInn" defaultValue={orgInnDefault} className="w-full border rounded px-2 py-1" />{usedSuggested ? (<div className="text-xs text-gray-500 mt-1">Подставлено по rwTokenFp</div>) : null}</label>
              <label className="block text-sm">clientEmail<input name="clientEmail" defaultValue={item.clientEmail||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm col-span-2">description<input name="description" defaultValue={item.description||''} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">amountGrossRub<input name="amountGrossRub" defaultValue={String(item.amountGrossRub||'').replace('.', ',')} className="w-full border rounded px-2 py-1" /></label>
              <label className="block text-sm">retainedCommissionRub<input name="retainedCommissionRub" defaultValue={String(item.retainedCommissionRub||'').replace('.', ',')} className="w-full border rounded px-2 py-1" /></label>
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
                <form action="/api/admin/actions/instant-resend" method="post">
                  <input type="hidden" name="userId" defaultValue={p.uid} />
                  <input type="hidden" name="taskId" defaultValue={p.task} />
                  <button className="px-3 py-2 border rounded inline-block" type="submit">Переотправить письмо выдачи</button>
                </form>
                <div className="text-xs text-gray-600 mt-1">Принудительно сформировать и отправить письмо «мгновенная выдача», если есть результат и чеки. Статус сохранится в продаже.</div>
              </div>
              <div>
                <a className="px-3 py-2 border rounded inline-block" href={`/api/rocketwork/tasks/${encodeURIComponent(String(item.taskId))}?force=1`} target="_blank">Sync RW</a>
                <div className="text-xs text-gray-600 mt-1">Запросить статус задачи и наличные чеки (ОФД/НПД) из RW; обновляет продажу локально.</div>
              </div>
              <div>
                <a className="px-3 py-2 border rounded inline-block" href={`/api/ofd/sync?order=${encodeURIComponent(String(item.orderId))}&force=1`} target="_blank">Sync OFD</a>
                <div className="text-xs text-gray-600 mt-1">Опрос OFD по orderId: пытается найти чеки по присвоенным InvoiceId, подтягивает ReceiptId/URL (предоплата и полный), обновляет запись.</div>
              </div>
              <div>
                <form action={`/api/admin/actions/ofd/repair-one?user=${encodeURIComponent(p.uid)}&order=${encodeURIComponent(String(item.orderId).match(/(\d+)/g)?.slice(-1)[0] || String(item.orderId))}`} method="post">
                  <button className="px-3 py-2 border rounded inline-block" type="submit">Repair OFD (этот заказ)</button>
                </form>
                <div className="text-xs text-gray-600 mt-1">Принудительный repair только для этой продажи: достроит ссылки по имеющимся ReceiptId и создаст чек при необходимости.</div>
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
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Логи</h2>
            <pre className="w-full border rounded p-2 text-xs whitespace-pre-wrap bg-gray-50 dark:bg-gray-950">{log || 'Пока нет событий'}</pre>
          </div>
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Мгновенная выдача — попытки</h2>
            <div className="text-xs text-gray-600 mb-2">Статус последней попытки: {(item as any).instantEmailStatus || '—'}</div>
            <EmailAttempts uid={p.uid} taskId={p.task} />
          </div>
        </div>
      )}
    </div>
  );
}

async function EmailAttempts({ uid, taskId }: { uid: string; taskId: string | number }) {
  const raw = await readAdminEntityLog('sale', [String(uid), String(taskId)]);
  const lines = (raw || '').trim().length ? raw.trim().split('\n') : [];
  const attempts = lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e: any) => e && (e.message === 'instant_email:sent' || e.message === 'instant_email:failed')) as Array<{ ts: string; message: string; data?: any }>;
  if (attempts.length === 0) {
    return <div className="text-xs text-gray-600">Пока попыток нет</div>;
  }
  return (
    <div className="text-xs">
      <div className="border rounded">
        <div className="grid grid-cols-[12rem_1fr_1fr] gap-2 p-2 border-b bg-gray-50">
          <div>Время (МСК)</div>
          <div>Статус</div>
          <div>Детали</div>
        </div>
        {attempts.reverse().map((a, i) => (
          <div key={i} className="grid grid-cols-[12rem_1fr_1fr] gap-2 p-2 border-b last:border-b-0">
            <div>{new Date(a.ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</div>
            <div>{a.message === 'instant_email:sent' ? 'Отправлено' : 'Ошибка'}</div>
            <div className="truncate">{a.message === 'instant_email:sent' ? (a as any)?.data?.to || '' : (a as any)?.data?.error || ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


