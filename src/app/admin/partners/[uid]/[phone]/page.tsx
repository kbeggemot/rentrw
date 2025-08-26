import SaveButton from '@/components/admin/SaveButton';
import { readText } from '@/server/storage';

export const runtime = 'nodejs';
import FlashToast from '@/components/admin/FlashToast';

async function getItem(uid: string, phone: string) {
  try {
    const raw = await readText('.data/partners.json');
    const d = raw ? JSON.parse(raw) : { users: {} };
    const list = Array.isArray(d?.users?.[uid]) ? d.users[uid] : [];
    const norm = (x: string) => x.replace(/\D/g, '');
    const item = list.find((x: any) => norm(String(x.phone||'')) === norm(phone)) || null;
    if (!item) return null;
    // gather organizations by orgInn and user org memberships
    let orgs: Array<{ inn: string; name: string | null }> = [];
    try {
      const rawOrgs = await readText('.data/orgs.json');
      const orgStore = rawOrgs ? JSON.parse(rawOrgs) : { orgs: {} };
      const map = (orgStore?.orgs && typeof orgStore.orgs === 'object') ? (orgStore.orgs as Record<string, any>) : {};
      const addOrg = (inn: string | undefined | null) => {
        const key = String(inn||'').replace(/\D/g,'');
        if (!key) return;
        const rec = map[key];
        orgs.push({ inn: key, name: rec?.name ?? null });
      };
      addOrg((item as any).orgInn);
      // include all orgs where this user is a member (uid)
      for (const [inn, rec] of Object.entries(map)) {
        if (Array.isArray((rec as any)?.members) && (rec as any).members.includes(uid)) {
          const key = String(inn).replace(/\D/g,'');
          if (!orgs.some(o => o.inn === key)) orgs.push({ inn: key, name: (rec as any)?.name ?? null });
        }
      }
    } catch {}
    orgs = orgs.filter(Boolean);
    // list users linked to this partner (same uid) – in this dataset partner belongs to account uid
    const users: Array<{ id: string; phone: string }> = [{ id: uid, phone }];
    return { ...item, __orgs: orgs, __users: users };
  } catch { return null; }
}

export default async function AdminPartnerEditor(props: { params: Promise<{ uid: string; phone: string }> }) {
  const p = await props.params;
  const item = await getItem(p.uid, p.phone);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <FlashToast />
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Редактирование партнёра</h1>
        <a className="inline-flex items-center justify-center w-8 h-8 border rounded" href="/admin?tab=partners" aria-label="Закрыть">×</a>
      </div>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <>
        <form action={`/admin/partners/${encodeURIComponent(p.uid)}/${encodeURIComponent(p.phone)}/save`} method="post" className="space-y-3">
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
            <SaveButton label="Сохранить" />
            <a className="px-3 py-2 border rounded" href="/admin?tab=partners">Назад</a>
          </div>
        </form>
        {/* Related lists */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2">Организации</h3>
            {Array.isArray((item as any).__orgs) && (item as any).__orgs.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {(item as any).__orgs.map((o: any)=> (
                  <li key={o.inn}><a className="text-blue-600" href={`/admin/orgs/${encodeURIComponent(String(o.inn))}`}>{o.inn}{o.name?` — ${o.name}`:''}</a></li>
                ))}
              </ul>
            ) : (<div className="text-sm text-gray-500">Нет данных</div>)}
          </div>
          <div>
            <h3 className="font-semibold mb-2">Пользователи</h3>
            {Array.isArray((item as any).__users) && (item as any).__users.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {(item as any).__users.map((u: any)=> (
                  <li key={u.id}><a className="text-blue-600" href={`/admin/lk-users/${encodeURIComponent(String(u.id))}`}>{u.id}</a> — {u.phone}</li>
                ))}
              </ul>
            ) : (<div className="text-sm text-gray-500">Нет данных</div>)}
          </div>
        </div>
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


