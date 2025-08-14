import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/auth' } });
  res.headers.set('Set-Cookie', 'session_user=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res;
}


