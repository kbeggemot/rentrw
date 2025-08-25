import { headers as nextHeaders, cookies as nextCookies } from 'next/headers';
import SaveButton from '@/components/admin/SaveButton';

async function getItem(code: string) {
  const hdrs = await nextHeaders();
  const proto = hdrs.get('x-forwarded-proto') || 'http';
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host') || 'localhost:3000';
  const base = `${proto}://${host}`;
  const cookie = (await nextCookies()).toString();
  const res = await fetch(`${base}/api/admin/data/links`, { cache: 'no-store', headers: { cookie } as any });
  const d = await res.json();
  const list = Array.isArray(d?.items) ? d.items : [];
  return list.find((x: any) => String(x.code) === code) || null;
}

export default async function AdminLinkEditor(props: { params: Promise<{ code: string }> }) {
  const p = await props.params;
  const item = await getItem(p.code);
  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">Редактирование ссылки</h1>
      {!item ? (
        <div className="text-sm text-gray-600">Запись не найдена</div>
      ) : (
        <form action={`/admin/links/${encodeURIComponent(p.code)}/save`} method="post" className="space-y-3">
          <input type="hidden" name="code" defaultValue={p.code} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">orgInn<input name="orgInn" defaultValue={item.orgInn||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">title<input name="title" defaultValue={item.title||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm col-span-2">description<input name="description" defaultValue={item.description||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">sumMode
              <select name="sumMode" defaultValue={item.sumMode||''} className="w-full border rounded px-2 py-1">
                {[item.sumMode||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                <option value="custom">custom</option>
                <option value="fixed">fixed</option>
              </select>
            </label>
            <label className="block text-sm">amountRub<input name="amountRub" defaultValue={String(item.amountRub||'')} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">vatRate
              <select name="vatRate" defaultValue={item.vatRate||''} className="w-full border rounded px-2 py-1">
                {[item.vatRate||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                <option value="none">none</option>
                <option value="0">0</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="">—</option>
              </select>
            </label>
            <label className="block text-sm">isAgent
              <select name="isAgent" defaultValue={String(item.isAgent||'')} className="w-full border rounded px-2 py-1">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label className="block text-sm">commissionType
              <select name="commissionType" defaultValue={item.commissionType||''} className="w-full border rounded px-2 py-1">
                {[item.commissionType||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                <option value="percent">percent</option>
                <option value="fixed">fixed</option>
                <option value="">—</option>
              </select>
            </label>
            <label className="block text-sm">commissionValue<input name="commissionValue" defaultValue={String(item.commissionValue||'')} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">partnerPhone<input name="partnerPhone" defaultValue={item.partnerPhone||''} className="w-full border rounded px-2 py-1" /></label>
            <label className="block text-sm">method
              <select name="method" defaultValue={item.method||''} className="w-full border rounded px-2 py-1">
                {[item.method||''].filter(Boolean).map(v=>String(v)).map(v=>(<option key={'cur-'+v} value={v}>{v}</option>))}
                <option value="any">any</option>
                <option value="qr">qr</option>
                <option value="card">card</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <SaveButton label="Сохранить" />
            <a className="px-3 py-2 border rounded" href="/admin?tab=links">Назад</a>
          </div>
        </form>
      )}
    </div>
  );
}


