import axios from 'axios'

/**
 * Main API client.
 * Base URL: /api/v1  (proxied to backend via next.config.ts rewrites)
 * Auth: httpOnly cookies set by the backend — `withCredentials: true`
 * makes the browser attach them automatically.
 */

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

/* ─── Response interceptor ───────────────────────── */
// On 401: attempt silent token refresh once, then retry.
// Only redirect to /login if refresh itself fails.
let isRefreshing  = false
let refreshQueue: Array<(ok: boolean) => void> = []

function drainQueue(ok: boolean) {
  refreshQueue.forEach(fn => fn(ok))
  refreshQueue = []
}

/* ── Refresh storm brake ──────────────────────────────────
   `isRefreshing` collapses only the 401s that arrive WHILE a refresh is in
   flight; waves arriving after one finishes each start another. When a 401
   is NOT an expiry — an endpoint this portal cannot satisfy, say — refresh
   succeeds, the retry 401s again, React Query retries, and the cycle repeats
   on every mount and refetch, rotating the refresh token each time. This is
   the failure that took out two admin sections; the same shape is possible
   here, so the same brake applies: at most MAX_REFRESHES per WINDOW_MS,
   after which a 401 is simply rejected.

   Capped rather than gated on the error code, because the codes cannot tell
   the two apart: access cookies carry maxAge = token lifetime, so a normal
   expiry deletes the cookie and the next call answers MISSING_TOKEN — the
   same code a misrouted endpoint gives. Refusing MISSING_TOKEN would break
   ordinary session renewal. */
const MAX_REFRESHES = 4
const WINDOW_MS     = 20_000
let refreshTimes: number[] = []

function refreshAllowed(): boolean {
  const now = Date.now()
  refreshTimes = refreshTimes.filter(t => now - t < WINDOW_MS)
  if (refreshTimes.length >= MAX_REFRESHES) return false
  refreshTimes.push(now)
  return true
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config

    /* An impersonation session that has been revoked or has run out cannot be
       refreshed — it has no refresh counterpart, and /auth/refresh renews the
       STUDENT's cookie, not this one. Retrying would loop on a dead token and,
       worse, the dead lms_imp_at shadows the admin's own lms_at on every
       request, so the browser looks signed out until it is cleared.
       Clearing it and reloading returns them to their real session. */
    const impersonationDead = ['IMPERSONATION_REVOKED', 'IMPERSONATION_EXPIRED', 'IMPERSONATION_INVALID']
      .includes(err.response?.data?.error?.code)
    if (impersonationDead && typeof window !== 'undefined') {
      void axios.post('/api/v1/auth/impersonation/exit', null, { withCredentials: true })
        .catch(() => {})
        .finally(() => { window.location.href = '/login?impersonation=ended' })
      return Promise.reject(err)
    }

    // Only intercept 401s that haven't already been retried
    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err)
    }

    if (typeof window === 'undefined') return Promise.reject(err)

    // Skip auth pages to avoid loops
    const path = window.location.pathname
    /* `/imp/enter` establishes a session rather than consuming one, so a 401
       there is the normal starting state, not an expired session. Redirecting
       would throw away the handoff code before it can be redeemed. */
    if (path === '/login' || path === '/register' || path.startsWith('/imp/')) {
      return Promise.reject(err)
    }

    original._retry = true

    if (isRefreshing) {
      // Queue this request until the in-flight refresh resolves
      return new Promise((resolve, reject) => {
        refreshQueue.push(ok => ok ? resolve(api(original)) : reject(err))
      })
    }

    if (!refreshAllowed()) return Promise.reject(err)

    isRefreshing = true
    try {
      /* Bounded like every other call. Without a timeout a refresh stalled on
         a poor connection never settled, and every request queued behind it
         (refreshQueue) waited with it — a page simply spun. */
      await axios.post('/api/v1/auth/refresh', null, { withCredentials: true, timeout: 15_000 })
      isRefreshing = false
      drainQueue(true)
      return api(original)
    } catch (refreshErr: any) {
      isRefreshing = false
      drainQueue(false)
      // Only a definitive auth rejection (401) means the session is really
      // gone. Rate limiting (429), timeouts, or network hiccups are
      // transient — don't force-logout an active user over those.
      if (refreshErr?.response?.status === 401) {
        /* session=expired tells the middleware this cookie is known-dead, so
           /login shows the form instead of bouncing to /my-learning. Without
           it a cookie that outlives its session makes those two redirects
           chase each other forever. */
        window.location.href = `/login?session=expired&from=${encodeURIComponent(path)}`
      }
      return Promise.reject(err)
    }
  },
)

/* ─── Typed helper — unwraps { success, data } envelope ── */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<{ success: true; data: T }>(url, { params })
  return res.data.data
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<{ success: true; data: T }>(url, body)
  return res.data.data
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<{ success: true; data: T }>(url, body)
  return res.data.data
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await api.delete<{ success: true; data: T }>(url)
  return res.data.data
}
