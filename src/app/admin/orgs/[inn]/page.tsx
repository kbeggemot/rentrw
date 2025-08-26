import SaveButton from '@/components/admin/SaveButton';
import FlashToast from '@/components/admin/FlashToast';
import { readText } from '@/server/storage';

async function getItem(inn: string) {
  try {
    const raw = await readText('.data/orgs.json');
    const d = raw ? JSON.parse(raw) : { orgs: {} };
    const byKey = d?.orgs && typeof d.orgs === 'object' ? d.orgs : {};
    const key = String(inn).replace(/\D/g,'');
    return byKey[key] || null;
  } catch { return null; }
}

export default async function AdminOrgEditor(props: { params: Promise<{ inn: string }> }) {
  const p = await props.params;
  const item = await getItem(p.inn);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <FlashToast />
      <h1 className="text-xl font-bold mb-3">Редактирование организации</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <form action={`/admin/orgs/${encodeURIComponent(p.inn)}/save`} method="post" className="space-y-3">
          <input type="hidden" name="inn" defaultValue={p.inn} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm col-span-2">Название<input name="name" defaultValue={item.name||''} className="w-full border rounded px-2 py-1" /></label>
          </div>
          <div className="flex gap-2">
            <SaveButton label="Сохранить" />
            <a className="px-3 py-2 border rounded" href="/admin?tab=orgs">Назад</a>
          </div>
        </form>
      )}
    </div>
  );
}


