/* ─────────────────────────────────────────────────────────────
   Where to go after signing in.

   The page that sent you to /login, carried as ?from= — so a mentor who taps
   the WhatsApp "Start class" button while signed out lands in that class
   after logging in, not on the dashboard.

   Only ever one of this site's own pages. Anything else — another site, a
   protocol-relative "//host", a backslash trick, or /login itself (a loop)
   — falls back to the dashboard. That is what keeps ?from= from becoming an
   open redirect.
───────────────────────────────────────────────────────────── */
const BASE = 'http://admin.invalid'

export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  try {
    const u = new URL(raw, BASE)
    if (u.origin !== BASE || u.pathname === '/login') return '/'
    return u.pathname + u.search + u.hash
  } catch {
    return '/'
  }
}

/** The ?from= value for the page you are on — none for the dashboard, which is where sign-in lands anyway. */
export function returnParamFor(pathname: string, search = ''): string | null {
  const path = pathname + search
  return safeReturnPath(path) === '/' ? null : path
}
