export const runtime = 'edge';

async function fetchInvoice(id: string) {
  try {
    const url = new URL(`/api/invoice?limit=1&cursor=0`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {}
}

export default function InvoicePublicPage(props: { params: Promise<{ id?: string }> }) {
  const React = (global as any).React as typeof import('react');
  const code = (React.use(props.params as any) as any)?.id as string | undefined;
  const [invoice, setInvoice] = React.useState<any | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/invoice', { cache: 'no-store' });
        const d = await r.json().catch(()=>({}));
        const items = Array.isArray(d?.items) ? d.items : [];
        const found = items.find((it: any) => String(it.code || it.id) === String(code));
        if (!cancelled) {
          if (found) setInvoice(found); else setNotFound(true);
        }
      } catch { if (!cancelled) setNotFound(true); }
    })();
    return () => { cancelled = true; };
  }, [code]);
  return (
    <div className="max-w-xl mx-auto pt-4 md:pt-6">
      <head>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <h1 className="text-2xl font-bold mb-3">{invoice ? `Счёт № ${invoice.id}` : 'Счёт'}</h1>
      {invoice ? (
        <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
          <div>Исполнитель: {(invoice.executorFio || '—')} / {(invoice.executorInn || '—')}</div>
          <div>Заказчик: {invoice.orgName} / {invoice.orgInn}</div>
          <div>
            <div className="font-medium">Описание услуги:</div>
            <div>{invoice.description}</div>
          </div>
          <div>Сумма: {invoice.amount} ₽</div>

          <div className="pt-2">
            <div className="font-semibold mb-1">Условия оплаты</div>
            <div className="space-y-2">
              <p>
                Это счёт в пользу самозанятого. Оплатите его на номинальный счёт оператора платформы «Рокет Ворк» по реквизитам ниже. После зачисления средств оператор перечислит выплату исполнителю на реквизиты, указанные им в Рокет Ворке.
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
            </div>
          </div>

          <div className="pt-2">
            <div className="font-semibold mb-1">Реквизиты для оплаты</div>
            <div className="space-y-1">
              <div><span className="text-gray-600">Номер счета</span><br/>40702810620028000001</div>
              <div><span className="text-gray-600">Сокращенное наименование</span><br/>ООО «РОКЕТ ВОРК»</div>
              <div><span className="text-gray-600">Корреспондентский счет</span><br/>30101810800000000388</div>
              <div><span className="text-gray-600">ИНН</span><br/>7720496561</div>
              <div><span className="text-gray-600">БИК</span><br/>044525388</div>
              <div><span className="text-gray-600">КПП</span><br/>770101001</div>
              <div className="mt-2">
                <div className="text-gray-600">Назначение платежа</div>
                <div>
                  {`Перечисление собственных денежных средств "${invoice.orgName}", ИНН "${invoice.orgInn}" по Соглашению об использовании электронного сервиса "Рокет Ворк" для оплаты по счёту #${invoice.id}. Без НДС`}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : notFound ? (
        <div className="text-sm text-gray-600">Счёт не найден</div>
      ) : (
        <div className="text-sm text-gray-600">Загрузка…</div>
      )}
    </div>
  );
}


