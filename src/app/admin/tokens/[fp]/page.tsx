import { readText } from '@/server/storage';

export const runtime = 'nodejs';

async function loadData(fp: string) {
  try {
    const raw = await readText('.data/orgs.json');
    const data = raw ? JSON.parse(raw) : { orgs: {} } as any;
    const orgs: any = data?.orgs || {};
    for (const [inn, org] of Object.entries(orgs)) {
      const tok = (org as any)?.tokens?.find((t: any) => t.fingerprint === fp);
      if (tok) {
        const users = Array.isArray(tok.holderUserIds) ? tok.holderUserIds : [];
        return { inn: String(inn).replace(/\D/g,''), name: (org as any)?.name ?? null, token: { fingerprint: tok.fingerprint, masked: tok.masked, createdAt: tok.createdAt, updatedAt: tok.updatedAt }, users };
      }
    }
  } catch {}
  return null;
}

export default async function TokenPage(props: { params: Promise<{ fp: string }> }) {
  const p = await props.params;
  const item = await loadData(p.fp);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Токен</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="text-sm">fingerprint: <span className="font-mono">{item.token.fingerprint}</span></div>
            <div className="text-sm">masked: <span className="font-mono">{item.token.masked}</span></div>
            <div className="text-sm">Организация: <a className="text-blue-600" href={`/admin/orgs/${encodeURIComponent(String(item.inn))}`}>{item.inn}{item.name?` — ${item.name}`:''}</a></div>
            <div className="text-sm">Пользователи:</div>
            <ul className="list-disc pl-5 text-sm">
              {item.users.length === 0 ? <li>—</li> : item.users.map((u: string) => (
                <li key={u}>
                  <a className="text-blue-600" href={`/admin/lk-users/${encodeURIComponent(String(u))}`}>{u}</a>
                  <form action="/api/admin/data/tokens/unlink" method="post" className="inline ml-2">
                    <input type="hidden" name="inn" defaultValue={item.inn} />
                    <input type="hidden" name="fingerprint" defaultValue={item.token.fingerprint} />
                    <input type="hidden" name="userId" defaultValue={u} />
                    <input type="hidden" name="back" defaultValue={`/admin/tokens/${encodeURIComponent(String(item.token.fingerprint))}`} />
                    <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" name="confirm" value="yes" required /> <span>подтверждаю</span></label>
                    <button className="text-red-600 underline ml-2" type="submit">Отвязать</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4"><a className="px-3 py-2 border rounded" href="/admin?tab=tokens">Назад</a></div>
        </>
      )}
    </div>
  );
}


