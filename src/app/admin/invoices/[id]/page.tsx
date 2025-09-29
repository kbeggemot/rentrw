import FlashToast from '@/components/admin/FlashToast';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

async function getInvoice(id: string) {
  try {
    const raw = await readText('.data/invoices.json');
    const list = raw ? JSON.parse(raw) : [];
    const num = Number(String(id).replace(/\D/g, ''));
    if (!Array.isArray(list)) return null;
    const item = list.find((x: any) => Number(x.id) === num) || null;
    return item;
  } catch { return null; }
}

export default async function AdminInvoicePage(props: { params: Promise<{ id: string }> }) {
  const p = await props.params;
  const inv = await getInvoice(p.id);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <FlashToast />
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Счёт № {inv?.id || p.id}</h1>
        <a className="inline-flex items-center justify-center w-8 h-8 border rounded" href="/admin?tab=invoices" aria-label="Закрыть">×</a>
      </div>
      {!inv ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-base font-semibold mb-2">Общее</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><div className="text-gray-500">Создан</div><div>{inv.createdAt?new Date(inv.createdAt).toLocaleString('ru-RU',{ timeZone:'Europe/Moscow' }):'—'}</div></div>
              <div><div className="text-gray-500">Публичный код</div><div>{inv.code}</div></div>
              <div><div className="text-gray-500">Телефон исполнителя</div><div>{inv.phone||'—'}</div></div>
              <div><div className="text-gray-500">Email заказчика</div><div>{inv.email||'—'}</div></div>
            </div>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-base font-semibold mb-2">Исполнитель / Заказчик</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500">Исполнитель</div>
                <div>{inv.executorFio||'—'}{inv.executorInn?` / ИНН ${inv.executorInn}`:''}</div>
              </div>
              <div>
                <div className="text-gray-500">Заказчик</div>
                <div>{inv.orgName||'—'}{inv.orgInn?` / ИНН ${inv.orgInn}`:''}</div>
              </div>
            </div>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-base font-semibold mb-2">Услуга и сумма</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500">Описание</div>
                <div className="break-words">{inv.description||'—'}</div>
              </div>
              <div>
                <div className="text-gray-500">Сумма</div>
                <div>{inv.amount||'—'}</div>
              </div>
            </div>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-base font-semibold mb-2">Ссылки</div>
            <div className="flex flex-wrap gap-2 text-sm">
              <a className="inline-flex px-2 py-1 border rounded" href={`/invoice/${encodeURIComponent(String(inv.code||inv.id))}`} target="_blank">Публичная страница</a>
              <a className="inline-flex px-2 py-1 border rounded" href={`/api/invoice/${encodeURIComponent(String(inv.code||inv.id))}/pdf`} target="_blank">PDF</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
