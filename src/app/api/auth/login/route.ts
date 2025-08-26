import { NextResponse } from 'next/server';
import { findUserByPhoneLoose, verifyPassword } from '@/server/userStore';
import { listUserOrganizations } from '@/server/orgStore';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phoneRaw: string | undefined = body?.phone;
    const passwordRaw: string | undefined = body?.password;
    const phone = (phoneRaw ?? '').trim();
    const password = (passwordRaw ?? '').trim();
    if (!phone || !password) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const user = await findUserByPhoneLoose(phone);
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const ok = verifyPassword(password, user.passSalt, user.passHash);
    if (!ok) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const res = NextResponse.json({ ok: true, user: { id: user.id, phone: user.phone, email: user.email } });
    res.headers.set('Set-Cookie', `session_user=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`);

    // Корректно устанавливаем org_inn: сохраняем, если cookie принадлежит этому пользователю; иначе выбираем первую доступную
    try {
      const cookie = req.headers.get('cookie') || '';
      const m = /(?:^|;\s*)org_inn=([^;]+)/.exec(cookie);
      const current = m ? decodeURIComponent(m[1]) : null;
      const orgs = await listUserOrganizations(user.id);
      const innList = new Set(orgs.map((o) => o.inn));
      if (current && innList.has(current)) {
        // оставить как есть — не трогаем org_inn
      } else if (orgs.length > 0) {
        res.headers.append('Set-Cookie', `org_inn=${encodeURIComponent(orgs[0].inn)}; Path=/; SameSite=Lax; Max-Age=31536000`);
      } else {
        // у пользователя нет организаций — сбрасываем org_inn
        res.headers.append('Set-Cookie', `org_inn=; Path=/; Max-Age=0; SameSite=Lax`);
      }
    } catch {
      // на случай ошибки не ломаем логин
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


