// Server-rendered page; use plain HTML button to avoid client component imports here
import { readText } from '@/server/storage';

export const runtime = 'nodejs';

async function getUser(id: string) {
  try {
    const raw = await readText('.data/users.json');
    const d = raw ? JSON.parse(raw) : { users: [] };
    const arr: any[] = Array.isArray(d?.users) ? d.users : [];
    const u = arr.find((x) => String(x.id) === String(id));
    // Build list of organizations by scanning orgs.json for membership (org.members includes userId)
    const orgs: Array<{ inn: string; name: string | null }> = [];
    const tokens: Array<{ inn: string; name: string | null; fingerprint: string; masked: string }>=[];
    try {
      const rawOrgs = await readText('.data/orgs.json');
      const orgStore = rawOrgs ? JSON.parse(rawOrgs) : { orgs: {} };
      const map = (orgStore?.orgs && typeof orgStore.orgs === 'object') ? (orgStore.orgs as Record<string, any>) : {};
      const userId = String(u.id);
      for (const [inn, rec] of Object.entries(map)) {
        if (Array.isArray(rec?.members) && rec.members.includes(userId)) {
          const key = String(inn).replace(/\D/g, '');
          orgs.push({ inn: key, name: rec?.name ?? null });
          // collect tokens held by this user in this org
          const toks = Array.isArray(rec?.tokens) ? rec.tokens : [];
          for (const t of toks) {
            if (Array.isArray(t?.holderUserIds) && t.holderUserIds.includes(userId)) {
              tokens.push({ inn: key, name: rec?.name ?? null, fingerprint: t.fingerprint, masked: t.masked });
            }
          }
        }
      }
      // Also include payoutOrgInn if present
      const payoutInn = (u as any)?.payoutOrgInn ? String((u as any).payoutOrgInn).replace(/\D/g, '') : null;
      if (payoutInn && !orgs.some((o) => o.inn === payoutInn)) {
        const rec = map[payoutInn];
        orgs.push({ inn: payoutInn, name: rec?.name ?? null });
      }
    } catch {}
    return u ? { id: u.id, phone: u.phone, email: u.email ?? null, emailVerified: !!(u as any).emailVerified, orgInn: u.payoutOrgInn ?? null, showAll: !!u.showAllDataForOrg, orgs, tokens } : null;
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
            <label className="block text-sm col-span-2">email<input name="email" defaultValue={item.email||''} className="w-full border rounded px-2 py-1" /></label>
            {/* orgInn убран из карточки, чтобы не вводить в заблуждение */}
            <label className="block text-sm col-span-2">Показывать все данные (по орг.)
              <select name="showAll" defaultValue={item.showAll? 'true':'false'} className="w-full border rounded px-2 py-1">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label className="block text-sm">emailVerified
              <select name="emailVerified" defaultValue={(item as any).emailVerified ? 'true':'false'} className="w-full border rounded px-2 py-1 bg-gray-50">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label className="block text-sm">Новый телефон<input name="phone" placeholder="79001234567" className="w-full border rounded px-2 py-1" /></label>
            {Array.isArray((item as any).orgs) && (item as any).orgs.length > 0 ? (
              <div className="col-span-2">
                <div className="text-sm mb-1">Организации пользователя</div>
                <ul className="list-disc pl-5 text-sm">
                  {(item as any).orgs.map((o: any) => (
                    <li key={o.inn}><a className="text-blue-600" href={`/admin/orgs/${encodeURIComponent(String(o.inn))}`}>{o.inn}{o.name?` — ${o.name}`:''}</a></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {Array.isArray((item as any).tokens) && (item as any).tokens.length > 0 ? (
              <div className="col-span-2">
                <div className="text-sm mt-2 mb-1">Токены пользователя</div>
                <ul className="list-disc pl-5 text-sm">
                  {(item as any).tokens.map((t: any) => (
                    <li key={t.fingerprint+':'+t.inn}>
                      {t.masked} — <a className="text-blue-600" href={`/admin/tokens/${encodeURIComponent(String(t.fingerprint))}`}>{t.fingerprint.slice(0,10)}…</a> — {t.inn}{t.name?` — ${t.name}`:''}
                      <form action="/api/admin/data/tokens/unlink" method="post" className="inline ml-2">
                        <input type="hidden" name="inn" defaultValue={t.inn} />
                        <input type="hidden" name="fingerprint" defaultValue={t.fingerprint} />
                        <input type="hidden" name="userId" defaultValue={item.id} />
                        <input type="hidden" name="back" defaultValue={`/admin/lk-users/${encodeURIComponent(String(item.id))}`} />
                        <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" name="confirm" value="yes" required /> <span>подтверждаю</span></label>
                        <button className="text-red-600 underline ml-2" type="submit">Отвязать</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <input type="hidden" name="_method" value="PATCH" />
            <input type="hidden" name="back" value={`/admin/lk-users/${encodeURIComponent(String(item.id))}`} />
            <button className="px-3 py-2 bg-gray-900 text-white rounded" type="submit">Сохранить</button>
            <a className="px-3 py-2 border rounded" href="/admin?tab=lk_users">Назад</a>
          </div>
        </form>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Опасная зона</h2>
          <form action={`/api/admin/actions/reset-password`} method="post" className="space-y-3 mb-4">
            <input type="hidden" name="id" defaultValue={p.id} />
            <input type="hidden" name="back" value={`/admin/lk-users/${encodeURIComponent(String(item.id))}`} />
            <button className="px-3 py-2 border rounded disabled:opacity-50" type="submit" disabled={!item.email}>Отправить письмо для сброса пароля</button>
            {!item.email ? <div className="text-xs text-gray-500">У пользователя не задан email</div> : null}
          </form>
          <form action={`/api/admin/data/users`} method="post" className="space-y-3 mb-4">
            <input type="hidden" name="id" defaultValue={p.id} />
            <input type="hidden" name="_method" defaultValue="REVOKE_WEBAUTHN" />
            <input type="hidden" name="back" value={`/admin/lk-users/${encodeURIComponent(String(item.id))}`} />
            <button className="px-3 py-2 border rounded text-red-600" type="submit">Отозвать биометрические токены</button>
          </form>
          <form action={`/api/admin/data/users`} method="post" className="space-y-3">
            <input type="hidden" name="id" defaultValue={p.id} />
            <input type="hidden" name="_method" defaultValue="DELETE" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" value="yes" required />
              <span>Подтверждаю удаление пользователя</span>
            </label>
            <button className="px-3 py-2 border rounded text-red-600" type="submit">Удалить пользователя</button>
          </form>
        </div>
        </>
      )}
    </div>
  );
}


