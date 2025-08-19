import { NextResponse } from 'next/server';
import { getUserPayoutRequisites, updateUserPayoutRequisites, getUserOrgInn } from '@/server/userStore';
import { getDecryptedApiToken } from '@/server/secureStore';
import { writeText } from '@/server/storage';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const reqs = await getUserPayoutRequisites(userId);
    return NextResponse.json({ bik: reqs.bik, account: reqs.account, orgName: reqs.orgName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const bik: string | undefined = body?.bik;
    const account: string | undefined = body?.account;
    if (typeof bik === 'undefined' && typeof account === 'undefined') {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
    }
    await updateUserPayoutRequisites(userId, { bik, account });
    // Create/update executor in RW after saving requisites and wait for confirmation
    try {
      const inn = await getUserOrgInn(userId);
      const token = await getDecryptedApiToken(userId);
      if (inn && token) {
        const base = process.env.ROCKETWORK_API_BASE_URL || 'https://app.rocketwork.ru/api/';
        const url = new URL('executors', base.endsWith('/') ? base : base + '/').toString();
        // As per RW docs, create/update executor. Some installs expect { type, inn }, others may accept { type: 'Withdrawal', executor: { inn } }.
        const payload = { type: 'Withdrawal', inn } as Record<string, unknown>;
        const rw = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
        const txt = await rw.text();
        try {
          await writeText('.data/rw_executors_last.json', JSON.stringify({ ts: new Date().toISOString(), attempt: 1, userId, url, payload, status: rw.status, text: txt }, null, 2));
        } catch {}
        if (!rw.ok) {
          // Try fallback shape if first attempt failed
          try {
            const payload2 = { type: 'Withdrawal', executor: { inn } } as Record<string, unknown>;
            const rw2 = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload2), cache: 'no-store' });
            if (!rw2.ok) {
              const txt2 = await rw2.text();
              try {
                await writeText('.data/rw_executors_last.json', JSON.stringify({ ts: new Date().toISOString(), attempt: 2, userId, url, payload: payload2, status: rw2.status, text: txt2 }, null, 2));
              } catch {}
              let err2: any = null; try { err2 = txt2 ? JSON.parse(txt2) : null; } catch {}
              const message2 = (err2?.error as string | undefined) || txt2 || 'EXECUTOR_CREATE_FAILED';
              return NextResponse.json({ error: 'EXECUTOR_CREATE_FAILED', details: message2 }, { status: 502 });
            }
            // success on attempt 2
            try {
              await writeText('.data/rw_executors_last.json', JSON.stringify({ ts: new Date().toISOString(), attempt: 2, userId, url, payload: payload2, status: rw2.status, text: 'OK' }, null, 2));
            } catch {}
          } catch {
            let err: any = null; try { err = txt ? JSON.parse(txt) : null; } catch {}
            const message = (err?.error as string | undefined) || txt || 'EXECUTOR_CREATE_FAILED';
            return NextResponse.json({ error: 'EXECUTOR_CREATE_FAILED', details: message }, { status: 502 });
          }
        }
        // success on attempt 1
        try {
          await writeText('.data/rw_executors_last.json', JSON.stringify({ ts: new Date().toISOString(), attempt: 1, userId, url, payload, status: rw.status, text: 'OK' }, null, 2));
        } catch {}
      }
    } catch {
      return NextResponse.json({ error: 'EXECUTOR_CREATE_FAILED' }, { status: 502 });
    }
    const reqs = await getUserPayoutRequisites(userId);
    return NextResponse.json({ bik: reqs.bik, account: reqs.account, orgName: reqs.orgName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


