import FlashToast from '@/components/admin/FlashToast';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

async function getData(taskId: string, userId?: string) {
  try {
    const raw = await readText('.data/withdrawals.json');
    const d = raw ? JSON.parse(raw) : { items: [] } as any;
    const arr: any[] = Array.isArray(d?.items) ? d.items : [];
    let rec = arr.find((x)=> String(x.taskId)===String(taskId) && (!userId || String(x.userId)===String(userId)) ) || arr.find((x)=> String(x.taskId)===String(taskId));
    const log = await readText(`.data/withdrawal_${String(rec?.userId||userId||'')}_${String(taskId)}.log`).catch(()=>null as any);
    return { rec, log: log || '' };
  } catch { return { rec: null, log: '' }; }
}

export default async function AdminWithdrawalPage(props: { params: Promise<{ id: string }>, searchParams?: Promise<{ user?: string }> }) {
  const p = await props.params;
  const sp = props.searchParams ? await props.searchParams : {} as any;
  const data = await getData(p.id, sp.user);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <FlashToast />
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Вывод</h1>
        <a className="inline-flex items-center justify-center w-8 h-8 border rounded" href="/admin?tab=withdrawals" aria-label="Закрыть">×</a>
      </div>
      {!data.rec ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <>
          <div className="space-y-2 text-sm">
            <div>taskId: <b>{String(data.rec.taskId)}</b></div>
            <div>userId: <b>{data.rec.userId}</b></div>
            <div>amount: <b>{typeof data.rec.amountRub==='number'?data.rec.amountRub.toFixed(2):'—'}</b></div>
            <div>status: <b>{data.rec.status || '—'}</b></div>
            <div>createdAt: <b>{data.rec.createdAt?new Date(data.rec.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</b></div>
            <div>paidAt: <b>{data.rec.paidAt?new Date(data.rec.paidAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</b></div>
          </div>
          <div className="mt-3">
            <form action="/api/admin/actions/withdrawal/refresh" method="post" className="inline-flex items-center gap-2">
              <input type="hidden" name="taskId" defaultValue={String(data.rec.taskId)} />
              <input type="hidden" name="userId" defaultValue={String(data.rec.userId)} />
              <input type="hidden" name="back" defaultValue={`/admin/withdrawals/${encodeURIComponent(String(data.rec.taskId))}?user=${encodeURIComponent(String(data.rec.userId))}`} />
              <button className="px-3 py-2 border rounded" type="submit">Обновить статус</button>
            </form>
          </div>
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Логи</h2>
            <pre className="w-full border rounded p-2 text-xs whitespace-pre-wrap bg-gray-50 dark:bg-gray-950">{data.log || 'Пока нет событий'}</pre>
          </div>
        </>
      )}
    </div>
  );
}


