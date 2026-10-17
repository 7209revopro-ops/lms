/* ─────────────────────────────────────────────────────────────
   Website links → app screens.

   Two kinds of link reach the app as website paths:
     · a Universal / App Link — the WhatsApp or email Join button, opened on a
       phone with the app installed (https://lms.deltainstitutions.com/j/…);
     · a notification's `link`, written for the website (/messages?c=…,
       /live-classes/:id/watch, /courses/:slug, …) and carried by its push.
   Both go through appPathFor, so a link means the same screen either way.
   Pure: no React, no router.
───────────────────────────────────────────────────────────── */

const SCHEME = 'deltalms:'
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** The path + query of a URL or a bare path. `deltalms://j/abc` → `/j/abc`. */
export function pathOf(urlOrPath: string): { path: string; query: URLSearchParams } | null {
  const raw = urlOrPath.trim()
  if (!raw) return null
  try {
    if (raw.startsWith('/')) {
      const u = new URL(raw, 'https://x.invalid')
      return { path: u.pathname, query: u.searchParams }
    }
    const u = new URL(raw)
    if (u.protocol === SCHEME) {
      /* A custom scheme parses its first segment as the host. */
      const path = `/${u.host}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/{2,}/g, '/')
      return { path: path === '/' ? '/' : path.replace(/\/$/, ''), query: u.searchParams }
    }
    if (u.protocol === 'https:' || u.protocol === 'http:') return { path: u.pathname.replace(/(.)\/$/, '$1'), query: u.searchParams }
    return null
  } catch {
    return null
  }
}

/**
 * The app route for a website link, or null when the app has no screen for it
 * (the caller chooses: Home for an opened link, the notification list for a
 * tapped notification). Never returns a path the app cannot route.
 */
export function appPathFor(urlOrPath: string): string | null {
  const p = pathOf(urlOrPath)
  if (!p) return null
  const seg = p.path.split('/').filter(Boolean)
  const [a, b] = seg
  const enc = encodeURIComponent

  switch (a) {
    case undefined: return '/'
    case 'j': {
      if (!b || !ID.test(b)) return null
      const m = p.query.get('m')
      return `/j/${enc(b)}${m ? `?m=${enc(m)}` : ''}`
    }
    case 's': return b && ID.test(b) ? `/s/${enc(b)}` : null
    case 'messages': {
      const conv = p.query.get('c')
      return conv && ID.test(conv) ? `/messages?c=${enc(conv)}` : '/messages'
    }
    case 'class-bookings': return '/schedule'
    case 'my-bookings': return '/bookings'
    case 'live-classes':
      /* /live-classes/:id and /live-classes/:id/watch — the class screen has the
         Join / Watch button for either. */
      return b && ID.test(b) ? `/class/${enc(b)}` : '/schedule'
    case 'courses':
      return b && ID.test(b) ? `/learning/${enc(b)}` : '/learning'
    /* Q&A notifications link /learn/<course ID>/lesson/… — an id, not the slug
       the course screen takes, and Q&A is not in the app: the course list. */
    case 'learn':
    case 'my-learning': return '/learning'
    case 'assignments': return '/learning/assignments'
    case 'notifications': return '/notifications'
    default: return null
  }
}
