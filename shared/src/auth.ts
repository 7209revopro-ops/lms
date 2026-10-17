/* ─────────────────────────────────────────────────────────────
   Sign-in shapes, as the backend answers them (auth.controller.ts).
   Types only — each client validates at its own boundary.
───────────────────────────────────────────────────────────── */

export type EnrollmentStatus = 'pending' | 'approved' | 'cancelled' | 'rejected'

/** The part of GET /auth/me every client needs. The server sends more. */
export interface CurrentUser {
  id:                string
  name:              string
  email:             string
  role:              string
  isVerified?:       boolean
  isActive?:         boolean
  avatarUrl?:        string
  enrollmentStatus?: EnrollmentStatus
  organizationId?:   string
  twoFactorEnabled?: boolean
}

/** The mobile app's session (plan.md §13.4 B1) — tokens in the body, never cookies. */
export interface SessionTokens {
  accessToken:  string
  refreshToken: string
}

/** POST /auth/login — a session, or a second-factor challenge. */
export type LoginAnswer =
  | { user: CurrentUser; tokens: SessionTokens }
  | { twoFactorRequired: true; challengeToken: string }

/** POST /auth/otp/verify, /auth/login/2fa — always a session. */
export interface SessionAnswer { user: CurrentUser; tokens: SessionTokens }

/** POST /auth/refresh (mobile) */
export interface RefreshAnswer { tokens: SessionTokens }

/** GET /app/config (plan.md §13.4 B5) */
export interface AppConfig {
  minVersion:    string
  latestVersion: string
  storeUrls:     { ios: string | null; android: string | null }
  maintenance:   boolean
}

/** Sign-in refusals that need their own screen rather than a line of red text. */
export const DEVICE_CODES = ['DEVICE_PENDING', 'DEVICE_LIMIT', 'DEVICE_REVOKED'] as const
export type DeviceCode = typeof DEVICE_CODES[number]
export const isDeviceCode = (code: string): code is DeviceCode => (DEVICE_CODES as readonly string[]).includes(code)
