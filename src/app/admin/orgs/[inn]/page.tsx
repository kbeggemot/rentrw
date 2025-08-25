import SaveButton from '@/components/admin/SaveButton';

async function getItem(inn: string) {
  try {
    const res = await fetch(`/api/admin/data/orgs`, { cache: 'no-store' });
    const d = await res.json();
    const list = Array.isArray(d?.items) ? d.items : [];
    const key = String(inn).replace(/\D/g,'');
    return list.find((x: any) => String(x.inn).replace(/\D/g,'') === key) || null;
  } catch { return null; }
}

export default async function AdminOrgEditor(props: { params: Promise<{ inn: string }> }) {
  const p = await props.params;
  const item = await getItem(p.inn);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Редактирование организации</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <form id="org-edit-form" action={`/admin/orgs/${encodeURIComponent(p.inn)}/save`} method="post" className="space-y-3">
          <input type="hidden" name="inn" defaultValue={p.inn} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm col-span-2">Название<input name="name" defaultValue={item.name||''} className="w-full border rounded px-2 py-1" /></label>
          </div>
          <div className="flex gap-2">
            <SaveButton formId="org-edit-form">Сохранить</SaveButton>
            <a className="px-3 py-2 border rounded" href="/admin?tab=orgs">Назад</a>
          </div>
        </form>
      )}
    </div>
  );
}


