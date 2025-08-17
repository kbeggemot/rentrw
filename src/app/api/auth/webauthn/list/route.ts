import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { setWebauthnOptOut } from '@/server/userStore';

export const runtime = 'nodejs';

const CREDS_FILE = path.join(process.cwd(), '.data', 'webauthn_creds.json');

async function readAll(): Promise<Record<string, Array<{ id: string; counter: number }>>> {
	try {
		const raw = await fs.readFile(CREDS_FILE, 'utf8');
		return JSON.parse(raw || '{}') as Record<string, Array<{ id: string; counter: number }>>;
	} catch {
		return {} as Record<string, Array<{ id: string; counter: number }>>;
	}
}

async function writeAll(data: Record<string, Array<{ id: string; counter: number }>>): Promise<void> {
	await fs.mkdir(path.dirname(CREDS_FILE), { recursive: true });
	await fs.writeFile(CREDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function GET(req: Request) {
	const cookie = req.headers.get('cookie') || '';
	const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
	const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
	if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
	const all = await readAll();
	const items = (all[userId] || []).map((c) => ({ id: c.id, counter: c.counter }));
	return NextResponse.json({ items });
}

export async function DELETE(req: Request) {
	const cookie = req.headers.get('cookie') || '';
	const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
	const userId = (mc ? decodeURIComponent(mc[1]) : undefined) || req.headers.get('x-user-id') || '';
	if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
	const url = new URL(req.url);
	const id = url.searchParams.get('id') || '';
	if (!id) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
	const all = await readAll();
	const list = all[userId] || [];
	const next = list.filter((c) => c.id !== id);
	all[userId] = next;
	await writeAll(all);
	const res = NextResponse.json({ ok: true, removed: id, remain: next.length });
	if (next.length === 0) {
		res.headers.append('Set-Cookie', 'has_passkey=; Path=/; Max-Age=0; SameSite=Lax');
		try { await setWebauthnOptOut(userId, false); } catch {}
	}
	return res;
}
