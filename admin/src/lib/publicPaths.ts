/* Admin routes reachable WITHOUT a session — a locked-out or not-yet-
   authenticated admin must be able to load these.

   Single source of truth, imported by:
     - middleware.ts        — redirects an unauthenticated visitor away from
                               anything NOT in this set.
     - lib/axios.ts          — the 401 interceptor must never hard-redirect
                               AWAY from one of these pages; that is exactly
                               how the reset-password page used to self-
                               destruct (see git history / M-14).
     - app/providers.tsx      — TimezoneScope must not fire an unconditional
                               "who am I" call on a page nobody is signed
                               into yet — a 401 there is expected, not a sign
                               the interceptor should act on.

   /sso belongs here for the same reason as /login etc: somebody arriving
   from the Root portal has no session yet, by definition — the one route
   whose entire job is to establish a session cannot itself require one. */
export const PUBLIC_PATHS = new Set(['/login', '/forgot-password', '/reset-password', '/sso'])
