import SaveButton from '@/components/admin/SaveButton';
import { readText } from '@/server/storage';

async function getUser(id: string) {
  try {
    const raw = await readText('.data/users.json');
    const d = raw ? JSON.parse(raw) : { users: [] };
    const arr: any[] = Array.isArray(d?.users) ? d.users : [];
    const u = arr.find((x) => String(x.id) === String(id));
    return u ? { id: u.id, phone: u.phone, email: u.email ?? null, orgInn: u.payoutOrgInn ?? null, showAll: !!u.showAllDataForOrg } : null;
  } catch { return null; }
}

export default async function AdminLkUserPage(props: { params: Promise<{ id: string }> }) {
  const p = await props.params;
  const item = await getUser(p.id);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Пользователь ЛК</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <>
        <form action={`/api/admin/data/users/options`} method="post" className="space-y-3">
          <input type="hidden" name="id" defaultValue={p.id} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">id<input name="_id" defaultValue={item.id||''} readOnly className="w-full border rounded px-2 py-1 bg-gray-50" /></label>
            <label className="block text-sm">phone<input name="_phone" defaultValue={item.phone||''} readOnly className="w-full border rounded px-2 py-1 bg-gray-50" /></label>
            <label className="block text-sm col-span-2">email<input name="_email" defaultValue={item.email||''} readOnly className="w-full border rounded px-2 py-1 bg-gray-50" /></label>
            <label className="block text-sm">orgInn<input name="_orgInn" defaultValue={item.orgInn||''} readOnly className="w-full border rounded px-2 py-1 bg-gray-50" /></label>
            <label className="block text-sm col-span-2">Показывать все данные (по орг.)
              <select name="showAll" defaultValue={item.showAll? 'true':'false'} className="w-full border rounded px-2 py-1">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <SaveButton label="Сохранить" />
            <a className="px-3 py-2 border rounded" href="/admin?tab=lk_users">Назад</a>
          </div>
        </form>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Опасная зона</h2>
          <form action={`/api/admin/data/users`} method="post" onSubmit={(e)=>{ if(!confirm('Удалить пользователя?')) e.preventDefault(); }}>
            <input type="hidden" name="id" defaultValue={p.id} />
            <input type="hidden" name="_method" defaultValue="DELETE" />
            <button className="px-3 py-2 border rounded text-red-600" type="submit">Удалить пользователя</button>
          </form>
        </div>
        </>
      )}
    </div>
  );
}


