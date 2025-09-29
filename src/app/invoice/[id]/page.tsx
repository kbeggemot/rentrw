export const runtime = 'nodejs';
import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function InvoicePublicPage(props: { params: Promise<{ id?: string }> }) {
  const p = await props.params;
  const code = typeof p?.id === 'string' ? p.id : '';
  let invoice: any | null = null;
  try {
    const { readText } = await import('@/server/storage');
    const raw = await readText('.data/invoices.json');
    const list = raw ? JSON.parse(raw) : [];
    invoice = Array.isArray(list) ? list.find((it: any) => String(it?.code || it?.id) === String(code)) || null : null;
  } catch {
    invoice = null;
  }
  // Fallback: if старые счета не хранят ФИО/ИНН — попробуем подтянуть их по телефону из РВ (одноразово на сервере)
  let fallbackFio: string | null = null;
  let fallbackInn: string | null = null;
  if (invoice && (!invoice.executorFio || !invoice.executorInn) && invoice.phone) {
    try {
      const HARD_ORG_INN = '7729542170';
      const { listActiveTokensForOrg } = await import('@/server/orgStore');
      const tokenList = await listActiveTokensForOrg(HARD_ORG_INN);
      const token = Array.isArray(tokenList) && tokenList.length > 0 ? tokenList[0] : null;
      if (token) {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const url = new URL(`executors/${encodeURIComponent(String(invoice.phone).replace(/\D/g,''))}`, base.endsWith('/') ? base : base + '/').toString();
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
        const txt = await r.text();
        let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
        const ex = (data && typeof data === 'object' && data.executor) ? data.executor : data;
        const fio = ex ? [ex.last_name, ex.first_name, ex.second_name].filter(Boolean).join(' ').trim() : null;
        const inn = ex?.inn || (data?.inn ?? null) || null;
        fallbackFio = fio || null;
        fallbackInn = inn || null;
      }
    } catch {}
  }
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 pb-8 md:pb-10">
      <h1 className="text-2xl font-bold mb-3">{invoice ? `Счёт № ${invoice?.id}` : 'Счёт'}</h1>
      {invoice ? (
        <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
          <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="mb-1"><span className="font-semibold">Исполнитель:</span> {(invoice.executorFio || fallbackFio || '—')} / {(invoice.executorInn || fallbackInn || '—')}</div>
            <div className="mb-1"><span className="font-semibold">Заказчик:</span> {invoice.orgName} / {invoice.orgInn}</div>
            <div className="mb-1"><span className="font-semibold">Описание услуги:</span> <span className="whitespace-pre-line align-top inline-block">{invoice.description}</span></div>
            <div><span className="font-semibold">Сумма:</span> {invoice.amount} ₽</div>
          </div>

          <div className="pt-2 rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="font-semibold mb-2">Реквизиты для оплаты</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-gray-600">Номер счета</div>
                <div>40702810620028000001</div>
              </div>
              <div>
                <div className="text-gray-600">Сокращенное наименование</div>
                <div>ООО «РОКЕТ ВОРК»</div>
              </div>
              <div>
                <div className="text-gray-600">Корреспондентский счет</div>
                <div>30101810800000000388</div>
              </div>
              <div>
                <div className="text-gray-600">ИНН</div>
                <div>7720496561</div>
              </div>
              <div>
                <div className="text-gray-600">БИК</div>
                <div>044525388</div>
              </div>
              <div>
                <div className="text-gray-600">КПП</div>
                <div>770101001</div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-gray-600">Назначение платежа</div>
                <div>
                  {`Перечисление собственных денежных средств ${invoice.orgName}, ИНН ${invoice.orgInn} по Соглашению об использовании электронного сервиса "Рокет Ворк" для оплаты по счёту #${invoice.id}. Без НДС`}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <a className="text-blue-600 hover:underline" href={`/api/invoice/${encodeURIComponent(String(code))}/pdf`} target="_blank" rel="noreferrer">Скачать в PDF</a>
            </div>
          </div>

          <div className="pt-2 rounded border border-gray-200 dark:border-gray-800 p-4">
            <div className="font-semibold mb-1">Условия оплаты</div>
            <div className="space-y-2">
              <p>
                Это счёт в пользу самозанятого. Оплатите его на номинальный счёт оператора платформы «Рокет Ворк» по реквизитам ниже. После зачисления средств оператор перечислит выплату исполнителю на указанные им реквизиты в Рокет Ворке и сформирует чек НПД.
              </p>
              <p>
                Оплачивайте только с расчётного счёта вашей организации, строго соблюдая назначение платежа, указанное в счёте.
              </p>
              <p>
                Оплачивая, вы присоединяетесь к <a className="text-blue-600 hover:underline" href="https://files.rocketwork.ru/roketwork/Соглашение_Рокет_Ворк.pdf" target="_blank" rel="noreferrer">Соглашению об использовании электронного сервиса «Рокет Ворк»</a>.
              </p>
              <p>
                Комиссия составит 3% и будет удержена с исполнителя, если у вас с Рокет Ворком не согласованы индивидуальные условия обслуживания.
              </p>
              <p>
                Рокет Ворк оставляет за собой право без объяснения причин вернуть платёж отправителю без удержания комиссии.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-600">Счёт не найден</div>
      )}
    </div>
  );
}


