import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // Fallback for environments where POST is unstable at ingress.
  // Logout via GET is acceptable as a temporary mitigation.
  const res = await POST();
  try { res.headers.set('Cache-Control', 'no-store'); } catch {}
  return res;
}

export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/auth' } });
  res.headers.set('Set-Cookie', 'session_user=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res;
}


