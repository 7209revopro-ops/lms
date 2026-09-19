import axios from 'axios'
import { useImpersonationStore } from '@/store/impersonation.store'
import { useOrgStore } from '@/store/org.store'

/**
 * Admin API client.
 * Base URL: /api/v1  — proxied to the backend via next.config.ts rewrites.
 * This keeps all requests same-origin so httpOnly cookies work without any
 * CORS or SameSite friction.
 */
export const api = axios.create({
  baseURL:         '/api/v1',
  withCredentials: true,
  timeout:         15_000,
  headers: { 'Content-Type': 'application/json' },
})

/* ── Request interceptor — inject impersonation token ── */
api.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = useImpersonationStore.getState().token
    if (token) {
      config.headers = config.headers ?? {}
      config.headers['Authorization'] = `Bearer ${token}`
    }
    const orgId = useOrgStore.getState().activeOrgId
    /* The org switcher, UNLESS the caller already named an academy for this
       one request. A super admin filling in a cross-academy class has to read
       another academy's courses without moving the whole panel into it, and
       the backend already restricts this header's effect to super admins. */
    if (orgId && !config.headers?.['X-Organization-Id']) {
      config.headers = config.headers ?? {}
      config.headers['X-Organization-Id'] = orgId
    }
  }
  return config
})

/* ── Response interceptor — 401 → try refresh → retry → login ── */
let isRefreshing  = false
let refreshQueue: Array<(ok: boolean) => void> = []

function drainQueue(ok: boolean) {
  refreshQueue.forEach(fn => fn(ok))
  refreshQueue = []
}

/* ── Refresh storm brake ──────────────────────────────────
   `isRefreshing` only collapses 401s that arrive WHILE a refresh is in
   flight. It does nothing about waves that arrive after one finishes — and
   a screen whose 401 is not an expiry produces exactly that: refresh
   succeeds, the retry 401s again, React Query retries, and the whole cycle
   starts over on every mount, refetch and page change.

   That is what happened to Learning Paths and Audit Logs: their routes were
   guarded by the client-cookie middleware, so the admin panel could never
   satisfy them and a refresh could never help. Each visit fired several
   pointless refreshes, every one rotating the refresh token.

   The guards are fixed, but the interceptor should not be able to storm in
   the first place — the next misrouted endpoint must degrade to a plain
   failed request, not a token rotation loop. So: at most MAX_REFRESHES in
   any WINDOW_MS. Beyond that the 401 is simply rejected.

   A cap rather than a check on the error code, because the codes cannot
   distinguish the two cases. Access cookies carry maxAge = token lifetime,
   so an ordinary expiry DELETES the cookie and the next call answers
   MISSING_TOKEN — the very same code the misrouted endpoints returned.
   Refusing to refresh on MISSING_TOKEN would have broken normal session
   renewal for everybody. The cap is generous enough that no genuine flow
   reaches it (one expiry collapses to a single refresh via the flag above)
   and tight enough that a loop dies immediately. */
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

/* Land on the sign-in form and STAY there. Without the marker the admin
   middleware sees a cookie that has not been cleared yet, treats /login as
   "already signed in" and redirects to the dashboard, which 401s and comes
   straight back — a hard-navigation loop with no way out but clearing
   cookies by hand. The backend now clears cookies on a definitive refresh
   failure, which fixes the usual path; this marker also covers the ones it
   cannot, such as a refresh that fails with 429 or never answers. */
export const EXPIRED_PARAM = 'session=expired'

function toLogin() {
  if (window.location.pathname === '/login') return
  window.location.href = `/login?${EXPIRED_PARAM}`
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config

    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err)
    }

    if (typeof window === 'undefined') return Promise.reject(err)
    if (window.location.pathname === '/login') return Promise.reject(err)

    /* An expired IMPERSONATION token cannot be refreshed: /admin/auth/refresh
       renews the admin's own cookie, and the request would just be retried
       with the same dead Bearer. Before M-02 this was invisible because the
       token lived as long as a session; with short-lived tokens it surfaces as
       an unrecoverable 401 loop. End impersonation and return the admin to
       their own identity instead. */
    if (useImpersonationStore.getState().token) {
      useImpersonationStore.getState().endImpersonation()
      window.location.href = '/users?impersonation=expired'
      return Promise.reject(err)
    }

    original._retry = true

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push(ok => ok ? resolve(api(original)) : reject(err))
      })
    }

    /* Brake before the network call, not after — the point is to stop
       rotating refresh tokens, and a rejected 401 here surfaces to React
       Query as an ordinary error, which is the correct outcome for an
       endpoint this portal simply cannot satisfy. */
    if (!refreshAllowed()) return Promise.reject(err)

    isRefreshing = true
    try {
      await axios.post('/api/v1/admin/auth/refresh', null, { withCredentials: true })
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
        toLogin()
      }
      return Promise.reject(err)
    }
  },
)

/* ── Typed helpers ──────────────────────────────── */
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
