import { randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import { env } from '@/config/env.ts'
import type { TokenPair } from '@/types/index.ts'

/* ─────────────────────────────────────────────────────
   Auth cookie helpers
   ─────────────────────────────────────────────────────
   Access token  → `lms_at` cookie, ~15m, Path=/
   Refresh token → `lms_rt` cookie, ~30d, Path=/api/v1/auth
   Both httpOnly + SameSite=Lax. Secure flag only in
   production so dev over http://localhost still works.
───────────────────────────────────────────────────── */

export const ACCESS_COOKIE  = 'lms_at'
export const REFRESH_COOKIE = 'lms_rt'

/* Identifies the browser for the device whitelist. Long-lived and httpOnly so
   it outlasts any single session — a browser keeps its identity across
   sign-outs and re-logins, even while a device is blocked (pending). Carries no
   authority on its own; it only names which device row to check. Host-only /
   Path=/ so it rides along with every auth request. */
export const DEVICE_COOKIE = 'lms_device'
const DEVICE_TTL_MS = 400 * 86_400_000 // 400 days (Chrome's max cookie lifetime)

export const ADMIN_ACCESS_COOKIE  = 'lms_admin_at'
export const ADMIN_REFRESH_COOKIE = 'lms_admin_rt'

/* Client-portal impersonation rides its OWN cookie rather than overwriting
   `lms_at`. A super admin usually has a real student session in the same
   browser; replacing it would destroy a session they cannot restore, because
   it is httpOnly and nothing else holds a copy. Keeping them apart also makes
   "exit impersonation" a single clear, with the real session still underneath,
   and lets the client render its banner off the cookie's presence alone.

   There is no refresh twin on purpose — impersonation stops dead at its TTL. */
export const IMPERSONATION_COOKIE = 'lms_imp_at'
/* Non-httpOnly, value '1', no secret — see setImpersonationCookie(). */
export const IMPERSONATION_FLAG_COOKIE = 'lms_imp'

const REFRESH_PATH       = '/api/v1/auth'
const ADMIN_REFRESH_PATH = '/api/v1/admin/auth'

const isProd = () => env.NODE_ENV === 'production'

/* ── Cookie scope (M-21) ───────────────────────────────────────────────
   These used to be pinned to `.deltainstitutions.com` in production, which
   made both session cookies readable by EVERY subdomain — a foothold on any
   unrelated sibling host (a marketing page, a status page, a staging box)
   yielded a live admin session. The shared scope was never needed: both
   frontends proxy /api/v1/* from their own origin (see each next.config.ts
   and the [...path] route handlers), so the browser only ever exchanges these
   cookies with the host it is already on.

   Default is now HOST-ONLY — no Domain attribute, so the cookie belongs to
   exactly the host that set it. COOKIE_DOMAIN is the escape hatch: set it to
   restore a shared scope without a code change, e.g. if the apps are ever
   split across hosts that must share one session.

   Nothing about this signs anyone out — see evictLegacyCookie() below. */
const cookieDomain = () => {
  const configured = (process.env['COOKIE_DOMAIN'] ?? '').trim()
  return configured === '' ? undefined : configured
}

/* The scope cookies were issued under BEFORE the change above. A browser that
   still holds one is the problem: the old and new cookies share a name, so the
   Cookie header carries both and the server reads whichever the browser lists
   first — the older one. For the refresh cookie that is actively harmful: the
   stale copy is a token that has already been rotated, and presenting it trips
   reuse detection, which invalidates every session the account has.

   So every response that sets a cookie also deletes the legacy-scoped twin.
   Deletion is keyed on (name, domain, path), and the replacement carries a
   different domain, so this removes the old cookie without touching the new
   one. The result is a scope change with zero forced sign-outs: the first
   login or token refresh after deploy quietly swaps each user over.

   Defaults to the value that was hardcoded here, which is exactly what is
   sitting in production browsers today. Set LEGACY_COOKIE_DOMAIN='' to skip. */
const legacyCookieDomain = () => {
  const configured = process.env['LEGACY_COOKIE_DOMAIN']
  const value = (configured ?? (isProd() ? '.deltainstitutions.com' : '')).trim()
  /* Never evict what we are currently setting — that would delete the live
     cookie in the same response that issued it. */
  return value === '' || value === cookieDomain() ? undefined : value
}

function evictLegacyCookie(res: Response, name: string, path: string): void {
  const domain = legacyCookieDomain()
  if (!domain) return
  res.clearCookie(name, { path, domain })
}

function parseDurationMs(duration: string): number {
  const unit  = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  /* Guard the number too: "bogus" ends in 's' and would otherwise return NaN,
     which Express turns into a session cookie with no expiry. */
  if (!Number.isFinite(value) || value <= 0) return 900_000   // fallback: 15m
  switch (unit) {
    case 's': return value * 1_000
    case 'm': return value * 60_000
    case 'h': return value * 3_600_000
    case 'd': return value * 86_400_000
    default:  return 900_000
  }
}

export function setAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie(ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
  })
  res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     REFRESH_PATH,
    maxAge:   parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  })
  evictLegacyCookie(res, ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, REFRESH_COOKIE, REFRESH_PATH)
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE,  { path: '/',          domain: cookieDomain() })
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH, domain: cookieDomain() })
  /* Logout must clear the legacy-scoped pair too. Missing it would leave a
     still-valid apex cookie in the jar, so "sign out" would not sign out. */
  evictLegacyCookie(res, ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, REFRESH_COOKIE, REFRESH_PATH)
}

/* ── Admin-portal cookies (lms_admin_at / lms_admin_rt) ─────────────────
   Completely separate from client cookies so both portals can maintain
   independent sessions on the same browser simultaneously.
──────────────────────────────────────────────────────────────────────── */
/*
 * The admin portal is opened inside the Root portal's frame, which makes it
 * third-party to the page around it. A SameSite=Lax cookie is never stored in
 * that position — by design, since that is the defence against cross-site
 * request forgery — so signing in from the portal looked like a failure and
 * was not: the handover worked, this cookie was set, the browser discarded it,
 * and the admin app, seeing no session, showed the login page again.
 *
 * SameSite=None lifts that and requires Secure, which is why it only applies
 * where the site is served over HTTPS. Over plain http a Secure cookie is
 * dropped instead, trading one silent sign-in failure for another.
 *
 * Only the admin cookies. The client portal is not opened from the Root portal
 * and keeps Lax, because weakening it would cost every student the same
 * protection for no benefit at all.
 *
 * This is a real reduction for the admin portal: another site can now cause an
 * authenticated request to be sent here. It is deliberate, and the alternative
 * considered was opening these systems in their own tab.
 */
const adminSameSite = (): 'lax' | 'none' => (isProd() ? 'none' : 'lax')

export function setAdminAuthCookies(res: Response, tokens: TokenPair): void {
  res.cookie(ADMIN_ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: adminSameSite(),
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
  })
  res.cookie(ADMIN_REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: adminSameSite(),
    domain:   cookieDomain(),
    path:     ADMIN_REFRESH_PATH,
    maxAge:   parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  })
  evictLegacyCookie(res, ADMIN_ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH)
}

export function clearAdminAuthCookies(res: Response): void {
  res.clearCookie(ADMIN_ACCESS_COOKIE,  { path: '/',               domain: cookieDomain() })
  res.clearCookie(ADMIN_REFRESH_COOKIE, { path: ADMIN_REFRESH_PATH, domain: cookieDomain() })
  evictLegacyCookie(res, ADMIN_ACCESS_COOKIE,  '/')
  evictLegacyCookie(res, ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_PATH)
}

/* ── Client-portal impersonation cookie ────────────────────────────────
   No legacy eviction: this name has never been issued under any other scope,
   so there is no stale twin to displace.
──────────────────────────────────────────────────────────────────────── */
export function setImpersonationCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   maxAgeMs,
  })
  /* Readable companion flag — carries no token and grants nothing. The banner
     needs to know an impersonation is running WITHOUT asking the server: it is
     mounted app-wide, so a probe request would fire on public pages too, where
     the 401 trips the global "session expired" redirect and bounces a visitor
     off the login page. The flag lets it stay silent unless there is something
     to show. Forging it does nothing — the httpOnly cookie above is the only
     thing that authenticates. */
  res.cookie(IMPERSONATION_FLAG_COOKIE, '1', {
    httpOnly: false,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   maxAgeMs,
  })
}

export function clearImpersonationCookie(res: Response): void {
  res.clearCookie(IMPERSONATION_COOKIE,      { path: '/', domain: cookieDomain() })
  res.clearCookie(IMPERSONATION_FLAG_COOKIE, { path: '/', domain: cookieDomain() })
}

/* ── Device identity cookie (lms_device) ───────────────────────────────
   Reads the browser's device id, minting and setting one on first contact so
   that even a blocked (pending) browser keeps a stable identity for an admin to
   approve. Never cleared on logout — it identifies the browser, not the
   session. Returns the id to check against the whitelist. */
export function resolveDeviceId(req: Request, res: Response): string {
  const existing = req.cookies?.[DEVICE_COOKIE]
  if (typeof existing === 'string' && existing.length > 0) return existing

  const deviceId = randomBytes(32).toString('hex')
  res.cookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: 'lax',
    domain:   cookieDomain(),
    path:     '/',
    maxAge:   DEVICE_TTL_MS,
  })
  return deviceId
}
