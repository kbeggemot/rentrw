import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Protect app routes: require session_user cookie for dashboard and settings
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const protectedPaths = ['/dashboard', '/settings', '/sales'];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const user = req.cookies.get('session_user')?.value;
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/sales/:path*'],
};


