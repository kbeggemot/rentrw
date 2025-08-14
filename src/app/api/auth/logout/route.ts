import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.redirect(new URL('/auth', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'));
  res.headers.set('Set-Cookie', 'session_user=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res;
}


