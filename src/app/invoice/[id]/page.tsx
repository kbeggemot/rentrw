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
    <div className="max-w-xl mx-auto mt-6 md:mt-8 px-4 md:px-0 pb-10 md:pb-12">
      <h1 className="text-2xl font-bold mb-3">{invoice ? (invoice.payerType === 'foreign' ? `Invoice № ${invoice.id}` : `Счёт № ${invoice.id}`) : 'Счёт'}</h1>
      {invoice ? (
        <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
          {invoice.payerType === 'foreign' ? (
            <>
              <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
                <div className="mb-1"><span className="font-semibold">Top-up Amount:</span> {invoice.invoice_amount || invoice.amount} {invoice.currency || '—'}</div>
                <div><span className="font-semibold">Contractor will receive:</span> {invoice.total_amount_rub ? `${invoice.total_amount_rub.toFixed(2)} ₽` : '—'}</div>
              </div>
            </>
          ) : (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-4">
              <div className="mb-1"><span className="font-semibold">Исполнитель:</span> {(invoice.executorFio || fallbackFio || '—')} / {(invoice.executorInn || fallbackInn || '—')}</div>
              <div className="mb-1"><span className="font-semibold">Заказчик:</span> {invoice.orgName} / {invoice.orgInn}</div>
              <div className="mb-1"><span className="font-semibold">Описание услуги:</span> <span className="whitespace-pre-line align-top inline-block">{invoice.description}</span></div>
              <div><span className="font-semibold">Сумма:</span> {invoice.amount} ₽</div>
            </div>
          )}

          {invoice.payerType === 'foreign' ? (
            <div className="pt-2 rounded border border-gray-200 dark:border-gray-800 p-4">
              <div className="font-semibold mb-2">Payment Details</div>
              <div className="space-y-1 text-sm">
                <div><span className="font-semibold">Sky Rock LLP</span></div>
                <div>CITY OF ALMATY, ALMALI DISTRICT, ST. NURMAKOVA, 65, Apt. 10, 050026, Republic of Kazakhstan, BIN 240940015346</div>
                <div><span className="font-semibold">Bank Name:</span> PKO Bank Polski S.A.</div>
                <div><span className="font-semibold">Beneficiary name:</span> Payholding International sp. z o.o. sp. K.</div>
                <div><span className="font-semibold">Beneficiary address:</span> ul. Laciarska 4B, 50-104 Wroclaw Poland</div>
                <div><span className="font-semibold">Bank SWIFT:</span> BPKOPLPW</div>
                <div><span className="font-semibold">Account or IBAN:</span> PL34 1020 1068 0000 1102 0354 4665</div>
              </div>
              <div className="mt-3">
                <div className="font-semibold mb-1">Payment Reference</div>
                <div>NODABANK Sky Rock LLP Payment under Agreement No. {invoice.id} for {invoice.description}. VAT not applicable.</div>
              </div>
              <div className="mt-3">
                <a className="text-blue-600 hover:underline" href={`/api/invoice/${encodeURIComponent(String(code))}/pdf`} target="_blank" rel="noreferrer">{invoice.payerType === 'foreign' ? 'Download in PDF' : 'Скачать в PDF'}</a>
              </div>
            </div>
          ) : (
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
          )}

          {invoice.payerType === 'foreign' ? (
            <div className="pt-2 rounded border border-gray-200 dark:border-gray-800 p-4">
              <div className="font-semibold mb-1">Payment Terms</div>
              <div className="space-y-2">
                <p>This invoice is issued for the payment of services provided by a foreign contractor. Kindly remit payment to the account of the agent, a partner of the "Rocket Work" platform, using the details provided below.</p>
                <p>Upon receipt of funds, the operator will convert the foreign currency amount into rubles and transfer the payment to the contractor's details as registered in the "Rocket Work" service.</p>
                <p><strong>Please be advised that your contractor is registered under the self-employed tax status. We will remit the applicable taxes on their behalf.</strong></p>
                <p>Payments must be made exclusively from your organization's corporate bank account, strictly adhering to the payment reference specified in this invoice.</p>
                <p>By executing this payment, you agree to be bound by the terms of the "Rocket Work" Electronic Service User Agreement.</p>
                <p>A service fee of 6% plus a fixed charge of 25 {invoice.currency || 'USD/EUR'} will be applied and deducted from the contractor's payment, unless individual service terms have been mutually agreed upon with "Rocket Work".</p>
                <p>"Rocket Work" reserves the right to return the payment to the sender at its sole discretion, without providing a reason and without deducting any fees.</p>
              </div>
            </div>
          ) : (
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
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-600">Счёт не найден</div>
      )}
    </div>
  );
}


