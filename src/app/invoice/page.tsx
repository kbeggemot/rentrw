export const runtime = 'edge';

export default function InvoiceLandingPage() {
  return (
    <div className="max-w-xl mx-auto mt-6 md:mt-8 px-4 md:px-0 pb-10 md:pb-12">
      <h1 className="text-2xl md:text-3xl font-bold mb-2">Счета</h1>
      <h2 className="text-lg md:text-xl font-semibold mb-4 text-gray-800 dark:text-gray-100">Выставляйте счёт и принимайте оплату — чек и налоги оформим автоматически</h2>
      <div className="space-y-4 text-sm md:text-base text-gray-700 dark:text-gray-200">
        <p>
          <strong>YPLA + Рокет Ворк</strong> помогают самозанятым получать деньги от компаний прозрачно и безопасно.<br />
          Вы создаёте счёт и отправляете ссылку — <strong>заказчик платит, не видя ваших платёжных данных.</strong><br />
          Оплата проходит через <strong>номинальный счёт,</strong> комиссия сервиса — <strong>1,5%</strong> по РФ, и до <strong>6% + 25 USD/EUR</strong> для зарубежных оплат.<br />
          <strong>Доход автоматически регистрируется как НПД, чек формируется и отправляется заказчику, а налог мы перечисляем за вас по вашему поручению.</strong>
        </p>

        <div>
          <h2 className="text-lg font-semibold mb-2">Почему это удобно</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Без раскрытия реквизитов: ваши карта и счёт не видны заказчику.</li>
            <li>Автонастройка НПД: регистрируем доход, формируем чек, перечисляем налог за вас — ничего считать не нужно.</li>
            <li>Законно и прозрачно: все операции фиксируются, чек у заказчика и в ФНС.</li>
            <li>Просто и быстро: счёт и ссылка — за пару минут.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Как это работает</h2>
          <ol className="list-decimal pl-6 space-y-1">
            <li>Регистрируетесь в Рокет Ворке как самозанятый.</li>
            <li>В YPLA создаёте счёт и отправляете ссылку.</li>
            <li>Заказчик оплачивает через безопасную форму (номинальный счёт).</li>
            <li>Чек и регистрация дохода по НПД — автоматически, налог перечислим за вас, деньги поступают вам (за вычетом комиссии и налога).</li>
          </ol>
        </div>

        <p>
          Готовы начать? Зарегистрируйтесь в Рокет Ворке и создайте первый счёт в YPLA — это займёт несколько минут.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <a href="https://trk.mail.ru/c/ss6nd8" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center h-10 px-4 rounded border border-gray-300 dark:border-gray-700 text-sm">Зарегистрироваться в Рокет Ворке</a>
          <a href="/invoice/new" className="inline-flex items-center justify-center h-10 px-4 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm">Создать счёт</a>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
          Требуется регистрация в Рокет Ворке. Комиссия — 1,5% от суммы оплаты по РФ, и до 6% + 25 USD/EUR для зарубежных оплат. Платёж проводится через номинальный счёт. Автоуплата НПД производится по вашему поручению; ставки НПД 6% применяются согласно законодательству и удерживается перед выплатой.
        </p>
      </div>
    </div>
  );
}


