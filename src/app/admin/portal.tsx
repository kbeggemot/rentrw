"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type AdminUser = { username: string; role: 'superadmin' | 'admin'; createdAt: string; updatedAt: string };

export default function AdminPortal() {
  const [logged, setLogged] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (msg: string, kind: 'success' | 'error' | 'info' = 'info') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2200); };
  const [role, setRole] = useState<'superadmin' | 'admin' | null>(null);

  // Simple presence check: if fetching users is unauthorized -> not logged
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/users', { cache: 'no-store' });
        if (r.status === 401) { setLogged(false); return; }
        setLogged(true);
        try { const d = await r.json(); if (d?.role === 'superadmin' || d?.role === 'admin') setRole(d.role); } catch {}
      } catch { setLogged(false); }
    })();
  }, []);

  if (logged === false) {
    return <AdminLogin onLogged={() => setLogged(true)} />;
  }
  if (logged === null) return null;
  return <AdminDashboard showToast={showToast} role={role} />;
}

function AdminLogin({ onLogged }: { onLogged: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('localadmin');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="max-w-sm mx-auto mt-16 border rounded-lg p-4 bg-white dark:bg-gray-950">
      <h1 className="text-xl font-bold mb-3">Админ-панель</h1>
      <div className="space-y-3">
        <Input label="Логин" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button loading={loading} onClick={async () => {
          setLoading(true); setMsg(null);
          try {
            const r = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            if (!r.ok) throw new Error('INVALID');
            onLogged();
          } catch { setMsg('Неверный логин или пароль'); }
          finally { setLoading(false); }
        }}>Войти</Button>
        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}
      </div>
    </div>
  );
}

// Deprecated: moved to LkUsersPanel as LkUserOptions

function AdminDashboard({ showToast, role }: { showToast: (m: string, k?: any) => void; role: 'superadmin' | 'admin' | null }) {
  const [tab, setTab] = useState<'users' | 'sales' | 'links' | 'partners' | 'orgs' | 'logs' | 'files' | 'lk_users'>(() => {
    try { const u = new URL(window.location.href); const t = (u.searchParams.get('tab')||'') as any; if (t) return t; } catch {}
    return 'sales';
  });
  const [loading, setLoading] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant={tab==='sales'?'secondary':'ghost'} onClick={() => setTab('sales')}>Продажи</Button>
        <Button variant={tab==='partners'?'secondary':'ghost'} onClick={() => setTab('partners')}>Партнёры</Button>
        <Button variant={tab==='links'?'secondary':'ghost'} onClick={() => setTab('links')}>Ссылки</Button>
        <Button variant={tab==='orgs'?'secondary':'ghost'} onClick={() => setTab('orgs')}>Организации</Button>
        <Button variant={tab==='logs'?'secondary':'ghost'} onClick={() => setTab('logs')}>Логи</Button>
        <Button variant={tab==='files'?'secondary':'ghost'} onClick={() => setTab('files')}>Файлы</Button>
        <div className="ml-auto" />
        <Button variant={tab==='users'?'secondary':'ghost'} onClick={() => setTab('users')}>Юзеры</Button>
        <Button variant={tab==='lk_users'?'secondary':'ghost'} onClick={() => setTab('lk_users')}>Пользователи ЛК</Button>
        <form onSubmit={(e)=>{e.preventDefault();}}>
          <Button variant="ghost" onClick={async ()=>{ await fetch('/api/admin/session', { method:'DELETE' }); window.location.reload(); }}>Выйти</Button>
        </form>
      </div>
      {tab === 'users' ? <UsersPanel showToast={showToast} /> : null}
      {tab === 'lk_users' ? <LkUsersPanel /> : null}
      {tab === 'sales' ? <SalesPanel showToast={showToast} role={role} /> : null}
      {tab === 'links' ? <LinksPanel showToast={showToast} role={role} /> : null}
      {tab === 'partners' ? <PartnersPanel showToast={showToast} role={role} /> : null}
      {tab === 'orgs' ? <OrgsPanel showToast={showToast} role={role} /> : null}
      {tab === 'logs' ? <LogsPanel /> : null}
      {tab === 'files' ? <FilesPanel /> : null}
    </div>
  );
}

function UsersPanel({ showToast }: { showToast: (m: string, k?: any) => void }) {
  const [list, setList] = useState<AdminUser[]>([]);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [role, setRole] = useState<'admin'|'superadmin'>('admin');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { const r = await fetch('/api/admin/users', { cache: 'no-store' }); const d = await r.json(); setList(d?.users || []); };
  useEffect(()=>{ void load(); },[]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <Input label="Логин" value={u} onChange={(e)=>setU(e.target.value)} />
        <Input label="Пароль" type="password" value={p} onChange={(e)=>setP(e.target.value)} />
        <select className="border rounded px-2 h-9" value={role} onChange={(e)=>setRole(e.target.value as any)}>
          <option value="admin">admin</option>
          <option value="superadmin">superadmin</option>
        </select>
        <Button onClick={async()=>{ const r=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,role})}); if(r.ok){showToast('Добавлено','success'); setU(''); setP(''); load();} else showToast('Ошибка','error'); }}>Добавить</Button>
      </div>
      <div className="border rounded">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">Логин</th><th className="text-left px-2 py-1">Роль</th><th className="text-left px-2 py-1">Действия</th></tr></thead>
          <tbody>
            {list.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.username,x.role].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((x)=> (
              <tr key={x.username} className="border-t"><td className="px-2 py-1">{x.username}</td><td className="px-2 py-1">{x.role}</td><td className="px-2 py-1">
                <Button variant="ghost" onClick={async()=>{ const np=prompt('Новый пароль для '+x.username); if(!np) return; const r=await fetch('/api/admin/users',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:x.username,password:np})}); if(r.ok){showToast('Пароль обновлён','success');} else showToast('Ошибка','error'); }}>Сменить пароль</Button>
                <Button variant="ghost" onClick={async()=>{ if(!confirm('Удалить '+x.username+'?')) return; const r=await fetch('/api/admin/users?username='+encodeURIComponent(x.username),{method:'DELETE'}); if(r.ok){showToast('Удалено','success'); load();} else showToast('Ошибка','error'); }}>Удалить</Button>
              </td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2">
        <input className="border rounded px-2 h-9 text-sm" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
        <Pager total={list.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.username,x.role].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
      </div>
    </div>
  );
}

// Toggle for LK user: show all org data regardless of owner
function LkUserOptions({ userId }: { userId: string }) {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/data/users/options?id=' + encodeURIComponent(userId), { cache: 'no-store' });
        const d = await r.json();
        setValue(Boolean(d?.showAll));
      } catch { setValue(false); }
    })();
  }, [userId]);
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!value} onChange={async (e) => { setValue(e.target.checked); try { await fetch('/api/admin/data/users/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: userId, showAll: e.target.checked }) }); } catch {} }} />
      <span>Показывать все данные (по орг.)</span>
    </label>
  );
}

function LkUsersPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { const r = await fetch('/api/admin/data/users', { cache: 'no-store' }); const d = await r.json(); setItems(Array.isArray(d?.items)?d.items:[]); };
  useEffect(()=>{ void load(); },[]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={load}>Обновить</Button>
        <input className="border rounded px-2 h-9 text-sm ml-auto" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">id</th><th className="text-left px-2 py-1">phone</th><th className="text-left px-2 py-1">email</th><th className="text-left px-2 py-1">orgInn</th><th className="text-left px-2 py-1">Организации</th><th className="text-left px-2 py-1">Опции</th></tr></thead>
          <tbody>
            {items.filter((u)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[u.id,u.phone,u.email,u.orgInn,(u.orgs||[]).map((o:any)=>o.inn+' '+(o.name||'')).join(' ')].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((u)=> (
              <tr key={u.id} className="border-t">
                <td className="px-2 py-1">{u.id}</td>
                <td className="px-2 py-1">{u.phone}</td>
                <td className="px-2 py-1">{u.email||'—'}</td>
                <td className="px-2 py-1">{u.orgInn||'—'}</td>
                <td className="px-2 py-1">
                  {(u.orgs||[]).length === 0 ? '—' : (
                    <div className="flex flex-wrap gap-1">
                      {(u.orgs||[]).map((o:any)=> (<a key={o.inn} className="inline-block px-2 py-1 border rounded" href={`/admin/orgs/${encodeURIComponent(String(o.inn))}`}>{o.inn}{o.name?` — ${o.name}`:''}</a>))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1"><LkUserOptions userId={u.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={items.filter((u)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[u.id,u.phone,u.email,u.orgInn,(u.orgs||[]).map((o:any)=>o.inn+' '+(o.name||'')).join(' ')].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
    </div>
  );
}

function SalesPanel({ showToast, role }: { showToast: (m: string, k?: any) => void; role: 'superadmin' | 'admin' | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { 
    const [rSales, rOrgs] = await Promise.all([
      fetch('/api/admin/data/sales', { cache: 'no-store' }),
      fetch('/api/admin/data/orgs', { cache: 'no-store' }),
    ]);
    const d = await rSales.json();
    const orgs = await rOrgs.json().catch(()=>({items:[]}));
    const orgMap = new Map<string, string>();
    (Array.isArray(orgs?.items)?orgs.items:[]).forEach((o:any)=>{ if(o?.inn) orgMap.set(String(o.inn), o?.name||''); });
    const arr: any[] = Array.isArray(d?.items)?d.items:[];
    arr.sort((a: any, b: any) => {
      const at = Date.parse((a?.createdAtRw || a?.createdAt || a?.updatedAt || 0) as any);
      const bt = Date.parse((b?.createdAtRw || b?.createdAt || b?.updatedAt || 0) as any);
      if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return bt - at; // latest first
    });
    // attach orgName for display
    arr.forEach((s:any)=>{ const inn=String(s.orgInn||''); if(inn && orgMap.has(inn)) (s as any).__orgName = orgMap.get(inn); });
    setItems(arr); 
  };
  useEffect(()=>{ void load(); },[]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Button variant="secondary" onClick={load}>Обновить</Button>
        <details className="relative">
          <summary className="list-none cursor-pointer inline-flex items-center h-9 px-3 rounded border bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 select-none">Массовые действия</summary>
          <div className="absolute z-50 mt-1 w-56 border rounded bg-white dark:bg-gray-950 shadow">
            <button className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async()=>{ await fetch('/api/sales?refresh=1',{cache:'no-store'}); await load(); showToast('Опрос RW запущен','info'); }}>Опросить RW</button>
            {role==='superadmin' ? (
              <>
                <button className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async()=>{ await fetch('/api/admin/actions/repair',{method:'POST'}); showToast('Repair запущен','info'); }}>Repair</button>
                <button className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900" onClick={async()=>{ await fetch('/api/admin/actions/schedule',{method:'POST'}); showToast('Schedule запущен','info'); }}>Schedule</button>
              </>
            ) : null}
          </div>
        </details>
        <div className="ml-auto flex items-center gap-2">
          <input className="border rounded px-2 h-9 text-sm" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
        </div>
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">createdAt</th><th className="text-left px-2 py-1">orderId</th><th className="text-left px-2 py-1">taskId</th><th className="text-left px-2 py-1">orgInn</th><th className="text-left px-2 py-1">orgName</th><th className="text-left px-2 py-1">email</th><th className="text-left px-2 py-1">amount</th><th className="text-left px-2 py-1">тип</th><th className="text-left px-2 py-1">endDate</th><th className="text-left px-2 py-1">status</th><th className="text-left px-2 py-1">ofdUrl</th><th className="text-left px-2 py-1">ofdFullUrl</th><th className="text-left px-2 py-1">npd</th><th className="text-left px-2 py-1">Действия</th></tr></thead>
          <tbody>
            {items.filter((s)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[s.orderId,s.taskId,s.orgInn,(s.__orgName||''),s.clientEmail,s.status,s.serviceEndDate,(s.createdAtRw||s.createdAt)].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((s)=> (
              <tr key={String(s.taskId)} className="border-t">
                <td className="px-2 py-1">{(s.createdAtRw||s.createdAt)?new Date(s.createdAtRw||s.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</td>
                <td className="px-2 py-1">{s.orderId}</td>
                <td className="px-2 py-1">{s.taskId}</td>
                <td className="px-2 py-1">{s.orgInn || '—'}</td>
                <td className="px-2 py-1">{s.__orgName || '—'}</td>
                <td className="px-2 py-1">{s.clientEmail || '—'}</td>
                <td className="px-2 py-1">{typeof s.amountGrossRub==='number'?s.amountGrossRub.toFixed(2):'-'}</td>
                <td className="px-2 py-1">{typeof s.isAgent === 'boolean' ? (s.isAgent ? 'агентская' : 'прямая') : '—'}</td>
                <td className="px-2 py-1">{s.serviceEndDate?new Date(`${s.serviceEndDate}T00:00:00Z`).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}):'—'}</td>
                <td className="px-2 py-1">{s.status || '—'}</td>
                <td className="px-2 py-1">{s.ofdUrl ? <a className="text-blue-600" href={s.ofdUrl} target="_blank">чек</a> : '—'}</td>
                <td className="px-2 py-1">{s.ofdFullUrl ? <a className="text-blue-600" href={s.ofdFullUrl} target="_blank">чек</a> : '—'}</td>
                <td className="px-2 py-1">{s.npdReceiptUri ? <a className="text-blue-600" href={s.npdReceiptUri} target="_blank">чек</a> : '—'}</td>
                <td className="px-2 py-1">
                  <a className="inline-block px-2 py-1" href={`/admin/sales/${encodeURIComponent(String(s.userId||'default'))}/${encodeURIComponent(String(s.taskId))}`}>Открыть</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={items.filter((s)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[s.orderId,s.taskId,s.orgInn,s.clientEmail,s.status,s.serviceEndDate,(s.createdAtRw||s.createdAt)].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
    </div>
  );
}

function LinksPanel({ showToast, role }: { showToast: (m: string, k?: any) => void; role: 'superadmin' | 'admin' | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { const r = await fetch('/api/admin/data/links', { cache: 'no-store' }); const d = await r.json(); setItems(Array.isArray(d?.items)?d.items:[]); };
  useEffect(()=>{ void load(); },[]);
  const commitLink = async (row: any, field: string, value: any) => {
    if (role !== 'superadmin') return;
    const r = await fetch('/api/admin/data/links', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: row.code, patch: { [field]: value } }) });
    if (r.ok) { await load(); } else { alert('Ошибка сохранения'); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={load}>Обновить</Button>
        <input className="border rounded px-2 h-9 text-sm ml-auto" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">createdAt</th><th className="text-left px-2 py-1">code</th><th className="text-left px-2 py-1">orgInn</th><th className="text-left px-2 py-1">amount</th><th className="text-left px-2 py-1">vat</th><th className="text-left px-2 py-1">method</th><th className="text-left px-2 py-1">Действия</th></tr></thead>
          <tbody>
            {items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.code,x.orgInn,x.vatRate,x.method,x.amountRub,x.title,x.description].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((x)=> (
              <tr key={x.code} className="border-t">
                <td className="px-2 py-1">{x.createdAt?new Date(x.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</td>
                <td className="px-2 py-1">{x.code}</td>
                <td className="px-2 py-1">{x.orgInn||'—'}</td>
                <td className="px-2 py-1">{typeof x.amountRub==='number'?x.amountRub.toFixed(2):'-'}</td>
                <td className="px-2 py-1">{x.vatRate||'—'}</td>
                <td className="px-2 py-1">{x.method||'—'}</td>
                <td className="px-2 py-1"><a className="inline-block px-2 py-1" href={`/admin/links/${encodeURIComponent(String(x.code))}`}>Открыть</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.code,x.orgInn,x.vatRate,x.method,x.amountRub,x.title,x.description].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
    </div>
  );
}

function PartnersPanel({ showToast, role }: { showToast: (m: string, k?: any) => void; role: 'superadmin' | 'admin' | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { const r = await fetch('/api/admin/data/partners', { cache: 'no-store' }); const d = await r.json(); setItems(Array.isArray(d?.items)?d.items:[]); };
  useEffect(()=>{ void load(); },[]);
  const commitPartner = async (row: any, field: string, value: any) => {
    if (role !== 'superadmin') return;
    const r = await fetch('/api/admin/data/partners', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: row.userId, phone: row.phone, patch: { [field]: value } }) });
    if (r.ok) { await load(); } else { alert('Ошибка сохранения'); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={load}>Обновить</Button>
        <input className="border rounded px-2 h-9 text-sm ml-auto" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">createdAt</th><th className="text-left px-2 py-1">phone</th><th className="text-left px-2 py-1">fio</th><th className="text-left px-2 py-1">status</th><th className="text-left px-2 py-1">inn</th><th className="text-left px-2 py-1">orgInn</th><th className="text-left px-2 py-1">Действия</th></tr></thead>
          <tbody>
            {items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.phone,x.fio,x.status,x.inn,x.orgInn].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((x)=> (
              <tr key={x.userId+':'+x.phone} className="border-t">
                <td className="px-2 py-1">{x.createdAt?new Date(x.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</td>
                <td className="px-2 py-1">{x.phone}</td>
                <td className="px-2 py-1">{x.fio||'—'}</td>
                <td className="px-2 py-1">{x.status||'—'}</td>
                <td className="px-2 py-1">{x.inn||'—'}</td>
                <td className="px-2 py-1">{x.orgInn||'—'}</td>
                <td className="px-2 py-1">
                  <a className="inline-block px-2 py-1" href={`/admin/partners/${encodeURIComponent(String(x.userId))}/${encodeURIComponent(String(x.phone))}`}>Открыть</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.phone,x.fio,x.status,x.inn,x.orgInn].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
    </div>
  );
}

function OrgsPanel({ showToast, role }: { showToast: (m: string, k?: any) => void; role: 'superadmin' | 'admin' | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const load = async () => { const r = await fetch('/api/admin/data/orgs', { cache: 'no-store' }); const d = await r.json(); setItems(Array.isArray(d?.items)?d.items:[]); };
  useEffect(()=>{ void load(); },[]);
  const commitOrg = async (row: any, field: string, value: any) => {
    if (role !== 'superadmin') return;
    const r = await fetch('/api/admin/data/orgs', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ inn: row.inn, patch: { [field]: value } }) });
    if (r.ok) { await load(); } else { alert('Ошибка сохранения'); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={load}>Обновить</Button>
        <input className="border rounded px-2 h-9 text-sm ml-auto" placeholder="Фильтр..." value={q} onChange={(e)=>{ setQ(e.target.value); setPage(1); }} />
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left px-2 py-1">createdAt</th><th className="text-left px-2 py-1">ИНН</th><th className="text-left px-2 py-1">Название</th><th className="text-left px-2 py-1">Действия</th></tr></thead>
          <tbody>
            {items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.inn,x.name].join(' ').toLowerCase(); return hay.includes(v); }).slice((page-1)*100, page*100).map((x)=> (
              <tr key={x.inn} className="border-t">
                <td className="px-2 py-1">{x.createdAt?new Date(x.createdAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—'}</td>
                <td className="px-2 py-1">{x.inn}</td>
                <td className="px-2 py-1">{x.name||'—'}</td>
                <td className="px-2 py-1"><a className="inline-block px-2 py-1" href={`/admin/orgs/${encodeURIComponent(String(x.inn))}`}>Открыть</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={items.filter((x)=>{ const v=q.trim().toLowerCase(); if(!v) return true; const hay=[x.inn,x.name].join(' ').toLowerCase(); return hay.includes(v); }).length} page={page} setPage={setPage} />
    </div>
  );
}

function LogsPanel() {
  const [entries, setEntries] = useState<string>('');
  useEffect(()=>{ (async()=>{ try { const r = await fetch('/api/admin/logs?type=ofd', { cache: 'no-store' }); const t = await r.text(); setEntries(t || ''); } catch {} })(); },[]);
  return (
    <div>
      <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">OFD Audit (если включён OFD_AUDIT=1)</div>
      <textarea className="w-full h-96 border rounded p-2 font-mono text-xs" readOnly value={entries} />
    </div>
  );
}

function FilesPanel() {
  const [list, setList] = useState<string[]>([]);
  const [name, setName] = useState<string>('');
  const [content, setContent] = useState<string>('');
  useEffect(()=>{ (async()=>{ try{ const r=await fetch('/api/admin/files',{cache:'no-store'}); const d=await r.json(); setList(Array.isArray(d?.files)?d.files:[]);}catch{}})(); },[]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div>
          <div className="text-sm text-gray-600 mb-1">Файлы в .data</div>
          <select className="border rounded px-2 h-9" value={name} onChange={async (e)=>{ const v=e.target.value; setName(v); if(v){ const r=await fetch(`/api/admin/files?name=${encodeURIComponent(v)}`,{cache:'no-store'}); const t=await r.text(); setContent(t);} else setContent(''); }}>
            <option value="">— выбрать файл —</option>
            {list.map((f)=> (<option key={f} value={f}>{f}</option>))}
          </select>
        </div>
      </div>
      <textarea className="w-full h-96 border rounded p-2 font-mono text-xs" readOnly value={content} />
    </div>
  );
}

function Pager({ total, page, setPage }: { total: number; page: number; setPage: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 100));
  return (
    <div className="flex items-center justify-end gap-2 mt-2 text-sm">
      <div className="text-gray-600">{total} записей</div>
      <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page<=1} onClick={()=>setPage(page-1)}>Назад</button>
      <div className="px-2">{page}/{pages}</div>
      <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={page>=pages} onClick={()=>setPage(page+1)}>Вперёд</button>
    </div>
  );
}


