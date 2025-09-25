export const runtime = 'edge';

async function fetchInvoice(id: string) {
  try {
    const url = new URL(`/api/invoice?limit=1&cursor=0`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {}
}

export default function InvoicePublicPage(props: { params: Promise<{ id?: string }> }) {
  const React = (global as any).React as typeof import('react');
  const code = React.use((props.params as any))?.id as string | undefined;
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
        <div className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
          <div>Исполнитель: {(invoice.executorFio || '—')} / {(invoice.executorInn || '—')}</div>
          <div>Заказчик: {invoice.orgName} / {invoice.orgInn}</div>
          <div>
            <div className="font-medium">Описание услуги:</div>
            <div>{invoice.description}</div>
          </div>
          <div>Сумма: {invoice.amount} ₽</div>
        </div>
      ) : notFound ? (
        <div className="text-sm text-gray-600">Счёт не найден</div>
      ) : (
        <div className="text-sm text-gray-600">Загрузка…</div>
      )}
    </div>
  );
}


