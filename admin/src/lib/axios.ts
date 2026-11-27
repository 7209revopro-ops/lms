import axios from 'axios'
import { useImpersonationStore } from '@/store/impersonation.store'
import { useOrgStore } from '@/store/org.store'
import { PUBLIC_PATHS } from '@/lib/publicPaths'
import { returnParamFor } from '@/lib/returnPath'

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

/* ── The admin's own access token: a Bearer header, not a cookie (2026-11-27) ──
   The user: "do as bearer token in admin side also instead of cookie". The backend hands the access token back in the
   answer to sign-in and refresh when asked with `X-Auth-Mode: bearer`, and no longer sets it as a cookie; every
   request carries it as `Authorization: Bearer`.

   It is kept in MEMORY only — not localStorage or sessionStorage, where any script on the page could read it for as
   long as it lives. The refresh token stays an httpOnly cookie the page never sees, so a reload or a new tab starts
   with no access token and asks /admin/auth/refresh for one before its first call (ensureAccessToken).

   Against a backend from before this change the answer carries no token: nothing is kept, no header is sent, and the
   `lms_admin_at` cookie that backend still sets goes on working. */
const AUTH_MODE = { 'X-Auth-Mode': 'bearer' }
let accessToken: string | null = null

export function clearAccessToken(): void { accessToken = null }

const tokenIn = (data: unknown): string | null => {
  const t = (data as { data?: { access_token?: unknown } } | null | undefined)?.data?.access_token
  return typeof t === 'string' && t.length > 0 ? t : null
}

/* One refresh at a time, whoever asks: the first call of a fresh page, or a 401 further down. */
let refreshing: Promise<boolean> | null = null
function refreshSession(): Promise<boolean> {
  refreshing ??= axios.post('/api/v1/admin/auth/refresh', null, { withCredentials: true, headers: AUTH_MODE })
    .then(res => { accessToken = tokenIn(res.data) ?? accessToken; return true })
    .finally(() => { refreshing = null })
  return refreshing
}

/* A page that has just loaded has no token yet. Asking once here, before the first call goes out, replaces a burst
   of 401s (one per query on the page) each of which would otherwise refresh. Tried once per page load: if it is
   refused the call goes out without a token and its 401 takes the usual road to the sign-in page. */
let bootstrap: Promise<unknown> | null = null
async function ensureAccessToken(url: string | undefined): Promise<void> {
  if (accessToken) return
  /* Signing in, signing out, a forgotten password: nothing to wait for. (/admin/auth/me and the rest do wait.) */
  if (/^\/admin\/auth\/(login|sso-login|refresh|logout|forgot-password|reset-password)(\/|$|\?)/.test(url ?? '')) return
  if (PUBLIC_PATHS.has(window.location.pathname)) return
  /* Every call of the first burst waits on the same one. */
  bootstrap ??= refreshAllowed() ? refreshSession().catch(() => false) : Promise.resolve(false)
  await bootstrap
}

/* ── Request interceptor — the Bearer token (impersonation's, else the admin's own) ── */
api.interceptors.request.use(async config => {
  if (typeof window !== 'undefined') {
    config.headers = config.headers ?? {}
    config.headers['X-Auth-Mode'] = 'bearer'
    const impersonation = useImpersonationStore.getState().token
    if (!impersonation) await ensureAccessToken(config.url)
    const token = impersonation ?? accessToken
    if (token) config.headers['Authorization'] = `Bearer ${token}`
    else delete config.headers['Authorization']
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

/* Never bounce AWAY from a page nobody needs a session to use. This is what
   used to break the reset-password page: TimezoneScope's unconditional
   `useCurrentUser()` (see providers.tsx) 401s there by definition — the
   admin clicking the link is signed out — and the refresh that followed
   also 401s (no refresh cookie either), which used to hard-redirect the
   admin to /login before they could see the form, let alone use it. */
function toLogin() {
  if (PUBLIC_PATHS.has(window.location.pathname)) return
  /* And back to this page once signed in again (lib/returnPath). */
  const from = returnParamFor(window.location.pathname, window.location.search)
  window.location.href = `/login?${EXPIRED_PARAM}${from ? `&from=${encodeURIComponent(from)}` : ''}`
}

api.interceptors.response.use(
  res => {
    /* Sign-in (password, second factor, from the Root portal) answers with the token; sign-out drops it. */
    const url = res.config?.url ?? ''
    if (url.startsWith('/admin/auth/')) {
      if (url.startsWith('/admin/auth/logout')) accessToken = null
      else accessToken = tokenIn(res.data) ?? accessToken
    }
    return res
  },
  async err => {
    const original = err.config

    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err)
    }

    if (typeof window === 'undefined') return Promise.reject(err)
    if (PUBLIC_PATHS.has(window.location.pathname)) return Promise.reject(err)

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
      await refreshSession()
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
