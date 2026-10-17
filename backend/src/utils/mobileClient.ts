import type { Request, Response } from 'express'
import type { TokenPair } from '@/types/index.ts'
import { setAuthCookies } from '@/utils/authCookies.ts'

/* ─────────────────────────────────────────────────────────────
   The student mobile app (plan.md §13.4 B1/B2) — one place for how a request
   from it differs from a browser's.

   It says who it is with `X-Client: mobile`, and then:
     · its session travels as TOKENS IN THE BODY, never cookies. A native HTTP
       stack keeps cookies on its own, and the auth middleware reads a cookie
       BEFORE a Bearer header — so a stale cookie left in the phone's jar would
       silently outrank the fresh token the app sends. No cookie is ever set
       for it, so there is never one to outrank anything.
     · its device identity is `X-Device-Id`, a 32-byte id the app generated
       once and keeps in the Keychain/Keystore — the app's equivalent of the
       browser's lms_device cookie, gated by the same two-device whitelist.

   A browser request never carries the header, so for the website nothing here
   changes a single byte of any response.
───────────────────────────────────────────────────────────── */

export const isMobileClient = (req: Request): boolean =>
  String(req.headers['x-client'] ?? '').toLowerCase() === 'mobile'

/* Same shape as the id resolveDeviceId mints for a browser: 64 hex chars. */
const DEVICE_ID = /^[a-f0-9]{64}$/

/** The app's device id, when it is a mobile request carrying a well-formed one. */
export function mobileDeviceId(req: Request): string | undefined {
  if (!isMobileClient(req)) return undefined
  const raw = req.headers['x-device-id']
  const id = Array.isArray(raw) ? raw[0] : raw
  return typeof id === 'string' && DEVICE_ID.test(id) ? id : undefined
}

/**
 * Hand a fresh session to whoever asked: cookies for a browser (exactly as
 * before), the token pair in the body for the app. Returns what to spread into
 * the response's data — `{}` for a browser.
 */
export function issueSession(
  req: Request, res: Response, tokens: TokenPair, refreshTtlOverride?: string,
): { tokens?: { accessToken: string; refreshToken: string } } {
  if (isMobileClient(req)) {
    return { tokens: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token } }
  }
  setAuthCookies(res, tokens, refreshTtlOverride)
  return {}
}

/** The refresh token the caller presented: the app's in the body, a browser's in its cookie. */
export function presentedRefreshToken(req: Request, cookieName: string): string | undefined {
  if (isMobileClient(req)) {
    const t = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken
    return typeof t === 'string' && t.length > 0 && t.length < 4096 ? t : undefined
  }
  const c = req.cookies?.[cookieName]
  return typeof c === 'string' && c.length > 0 ? c : undefined
}

/** The app's own refresh token on a read that has no body (GET /auth/sessions,
 *  DELETE /auth/sessions/:id): sent as `X-Refresh-Token` so the server can say
 *  which session is THIS phone. The browser's comes from its cookie, as ever. */
export function currentSessionToken(req: Request, cookieName: string): string | undefined {
  if (isMobileClient(req)) {
    const t = req.get('x-refresh-token')
    return t && t.length < 4096 ? t : undefined
  }
  const c = req.cookies?.[cookieName]
  return typeof c === 'string' && c.length > 0 ? c : undefined
}
