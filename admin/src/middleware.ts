import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Admin middleware — cookie-based auth guard.
 *
 * The backend sets an httpOnly `lms_admin_at` cookie on admin login.
 * This is separate from the client-portal `lms_at` cookie so both portals
 * can maintain independent sessions on the same browser simultaneously.
 * Middleware only checks presence (not validity — that's the API's job).
 * Protected pages → redirect to /login when cookie is absent.
 * /login → redirect to / when cookie is present (already signed in).
 */
/* Auth screens reachable without a session — a locked-out admin must be able
   to load these while signed out. */
const PUBLIC_PATHS = new Set(['/login', '/forgot-password', '/reset-password'])

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  /* Never touch API or Next internals — let route handlers deal with them */
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const hasToken = !!req.cookies.get('lms_admin_at')?.value

  /* Already logged-in users visiting /login → dashboard.

     ...unless the app itself sent them here because the API rejected their
     session. Presence is all this middleware can check; validity is the
     API's answer, and when the two disagree this redirect is one half of an
     endless bounce: /login sees a cookie and sends you to the dashboard, the
     dashboard 401s and sends you back. Every hop is a full document
     navigation, so the browser appears to reload itself forever and the
     sign-in form is unreachable without clearing cookies by hand.

     ?session=expired is the client saying "I already know this cookie is
     dead" — honour it and show the form. It grants no access on its own:
     every page behind it is still gated by the cookie check below and by
     the API on each request. */
  const sessionExpired = req.nextUrl.searchParams.get('session') === 'expired'

  if (pathname === '/login' && hasToken && !sessionExpired) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  /* Unauthenticated users visiting any protected route → login.
     Forward ?sso= so SSO auto-login works when Root ERP opens the
     root URL with ?sso=TOKEN (middleware would otherwise drop the param). */
  if (!PUBLIC_PATHS.has(pathname) && !hasToken) {
    const loginUrl = new URL('/login', req.url)
    const ssoParam = req.nextUrl.searchParams.get('sso')
    if (ssoParam) loginUrl.searchParams.set('sso', ssoParam)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
