import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Redirect logged-in users away from / and /auth to /dashboard
// Protect app routes: require session_user cookie for dashboard and settings
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = req.cookies.get('session_user')?.value;

  // If user is logged in and tries to open home or /auth → redirect to /dashboard
  if (user && (pathname === '/' || pathname === '/auth')) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }

  const protectedPaths = ['/dashboard', '/settings', '/sales'];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/auth', '/dashboard/:path*', '/settings/:path*', '/sales/:path*'],
};


