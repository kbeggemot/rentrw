import SaveButton from '@/components/admin/SaveButton';

async function getItem(uid: string, phone: string) {
  try {
    const res = await fetch(`/api/admin/data/partners`, { cache: 'no-store' });
    const d = await res.json();
    const list = Array.isArray(d?.items) ? d.items : [];
    const norm = (x: string) => x.replace(/\D/g, '');
    return list.find((x: any) => String(x.userId) === uid && norm(String(x.phone||'')) === norm(phone)) || null;
  } catch { return null; }
}

export default async function AdminPartnerEditor(props: { params: Promise<{ uid: string; phone: string }> }) {
  const p = await props.params;
  const item = await getItem(p.uid, p.phone);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Редактирование партнёра</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <>
        <form id="partner-edit-form" action={`/admin/partners/${encodeURIComponent(p.uid)}/${encodeURIComponent(p.phone)}/save`} method="post" className="space-y-3">
          <input type="hidden" name="uid" defaultValue={p.uid} />
          <input type="hidden" name="phone" defaultValue={p.phone} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">fio<input name="fio" defaultValue={item.fio||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">status
              <select name="status" defaultValue={item.status||''} className="w-full border rounded px-2 py-1">
                {[item.status||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                <option value="validated">validated</option>
                <option value="pending">pending</option>
                <option value="blocked">blocked</option>
                <option value="unknown">unknown</option>
                <option value="">—</option>
              </select>
            </label>
            <label className="block text-sm">inn<input name="inn" defaultValue={item.inn||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">orgInn<input name="orgInn" defaultValue={item.orgInn||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">hidden
              <select name="hidden" defaultValue={String(item.hidden||'')} className="w-full border rounded px-2 py-1">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <SaveButton formId="partner-edit-form">Сохранить</SaveButton>
            <a className="px-3 py-2 border rounded" href="/admin?tab=partners">Назад</a>
          </div>
        </form>
        <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Действия</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <form action="/api/admin/actions/partners/check" method="post">
                  <input type="hidden" name="userId" defaultValue={p.uid} />
                  <input type="hidden" name="phone" defaultValue={p.phone} />
                  <button className="px-3 py-2 border rounded" type="submit">Проверить в RW</button>
                </form>
                <div className="text-xs text-gray-600 mt-1">Запрос статуса партнёра в Rocketwork и обновление ФИО/ИНН/статуса.</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


