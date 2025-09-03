import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Redirect logged-in users away from / and /auth to /dashboard
// Protect app routes: require session_user cookie for dashboard and settings
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = req.cookies.get('session_user')?.value;
  const admin = req.cookies.get('admin_user')?.value;

  // If user is logged in and tries to open home or /auth → redirect to /dashboard
  if (user && (pathname === '/' || pathname === '/auth')) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }

  const protectedPaths = ['/dashboard', '/settings', '/sales', '/partners', '/link', '/products'];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  // Public link pages that must be accessible without auth
  const isPublicLink = (
    pathname === '/link/success' ||
    /^\/link\/s\/[^/]+$/.test(pathname) ||
    // /link/{code}, но исключаем зарезервированные сегменты: new, s, success
    /^\/link\/(?!new$|s$|success$)[^/]+$/.test(pathname)
  );
  if (!isProtected) {
    // Protect admin area with separate cookie
    if (pathname.startsWith('/admin')) {
      if (!admin) {
        const url = req.nextUrl.clone();
        url.pathname = '/admin';
        return NextResponse.next();
      }
    }
    return NextResponse.next();
  }

  // Allow public link pages without auth
  if (pathname.startsWith('/link') && isPublicLink) {
    return NextResponse.next();
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/auth', '/dashboard/:path*', '/settings/:path*', '/sales/:path*', '/partners/:path*', '/link/:path*', '/products/:path*', '/admin/:path*'],
};


