"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PublicSuccessPage(props: any) {
  const code = typeof props?.params?.code === "string" ? props.params.code : "";
  const [orgName, setOrgName] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/links/${encodeURIComponent(code)}`, { cache: "force-cache" });
        const d = await r.json();
        if (!cancelled && r.ok) {
          setOrgName((d?.orgName as string | undefined) ?? null);
          setTitle((d?.title as string | undefined) ?? null);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Оплата успешно завершена</h1>
      <div className="text-sm text-gray-600 mb-4">
        Спасибо! Платёж по ссылке {title ? `«${title}»` : `№ ${code}`} в пользу {orgName || "организации"} выполнен.
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm mb-4">
        Мы сформируем чеки автоматически. Вы можете посмотреть их на странице ссылки.
      </div>

      <div className="flex flex-col gap-3">
        <Link href={`/link/${encodeURIComponent(code)}?paid=1`} className="inline-flex items-center justify-center rounded-lg bg-black text-white px-4 h-9 text-sm">
          Показать чеки и детали платежа
        </Link>
        <Link href="/" className="inline-flex items-center justify-center rounded-lg border px-4 h-9 text-sm">
          На главную
        </Link>
      </div>
    </div>
  );
}


