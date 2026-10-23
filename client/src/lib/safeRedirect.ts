/* Where to go after signing in or signing up: the ?from= of this page, only if it is a path on
   this site (an open redirect otherwise), else My Learning. Shared by sign-in and sign-up — the
   public /explore pages send buyers through either and back to the course's checkout. */
export function safeRedirect(raw: string | null): string {
  if (!raw) return '/my-learning'
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return '/my-learning'
    return url.pathname.replace(/^\/+/, '/') + url.search + url.hash
  } catch {
    return '/my-learning'
  }
}

/** This page's own ?from=, made safe. */
export const returnTo = () => safeRedirect(new URLSearchParams(window.location.search).get('from'))
