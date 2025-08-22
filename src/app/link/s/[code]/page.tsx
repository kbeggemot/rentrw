"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PermanentSaleRedirect(props: any) {
  const code = typeof props?.params?.code === 'string' ? props.params.code : '';
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sale-page/${encodeURIComponent(code)}`, { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          const orderId = d?.orderId;
          if (!cancelled && orderId != null) {
            router.replace(`/link/success?order=${encodeURIComponent(String(orderId))}`);
            return;
          }
        }
      } catch {}
      if (!cancelled) router.replace(`/link/${encodeURIComponent(code)}`);
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-2">Оплата</h1>
      <div className="text-gray-600">Загрузка…</div>
    </div>
  );
}


