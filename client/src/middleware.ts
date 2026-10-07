import { NextRequest, NextResponse } from 'next/server'

const ACCESS_COOKIE = 'lms_at'
const IMPERSONATION_COOKIE = 'lms_imp_at'
/* Guest-only: signed-in users get bounced away from these */
const GUEST_ONLY = ['/login', '/register']
/* Public: anyone can visit. Used for password reset / email
   verification flows that need to work whether or not the user
   is signed in (links arrive via email). */
/* `/imp/enter` redeems an impersonation handoff code. It must be reachable
   with no session: the super admin arriving from the admin portal has no
   client cookie yet, and bouncing them to /login would discard the code. */
const PUBLIC = ['/forgot-password', '/reset-password', '/verify-email', '/imp/enter', '/continue', '/j']

/* A live client-portal impersonation rides its own cookie, so a super admin
   arriving with only that one is authenticated as far as routing is concerned.
   The API still decides whether the session means anything. */
function isAuthenticated(req: NextRequest): boolean {
  return !!req.cookies.get(ACCESS_COOKIE)?.value
      || !!req.cookies.get(IMPERSONATION_COOKIE)?.value
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const authed = isAuthenticated(req)

  // Never touch API routes
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Public routes — let everyone through, no redirects either way
  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  /* The app itself sent us here because the API rejected the session. This
     middleware can only see that a cookie EXISTS; the API decides whether it
     still means anything. When they disagree the bounce below is one half of
     an endless loop — /login sees a cookie and redirects to /my-learning,
     which 401s and redirects back — and every hop is a full navigation, so
     the page appears to reload itself and the sign-in form is unreachable.

     The marker grants nothing on its own: every protected route is still
     gated by the cookie check below and by the API on every request. */
  const sessionExpired = req.nextUrl.searchParams.get('session') === 'expired'

  // Guest-only routes → bounce to My Learning if already signed in
  const isGuestOnly = GUEST_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isGuestOnly && authed && !sessionExpired) {
    const url = req.nextUrl.clone()
    url.pathname = '/my-learning'
    return NextResponse.redirect(url)
  }

  // Everything else requires auth
  if (!isGuestOnly && !authed) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
