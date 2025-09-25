export const runtime = 'edge';

async function fetchInvoice(id: string) {
  try {
    const url = new URL(`/api/invoice?limit=1&cursor=0`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {}
}

export default function InvoicePublicPage(props: { params: Promise<{ id?: string }> }) {
  const id = (global as any).React?.use?.(props.params)?.id ?? undefined;
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-3">Счёт № {id}</h1>
      <div className="text-sm text-gray-600">Страница будет доступна позже.</div>
    </div>
  );
}


