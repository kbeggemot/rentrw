import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL('/auth', req.url));
  res.headers.set('Set-Cookie', 'session_user=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res;
}


