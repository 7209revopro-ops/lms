import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes } from 'crypto'
import { env } from '@/config/env.ts'
import type { AccessTokenPayload, RefreshTokenPayload, TokenPair, UserRole } from '@/types/index.ts'

/* Random JWT ID — guarantees two tokens issued in the same second
   still produce different signatures, so tokenHash stays unique. */
function newJti(): string {
  return randomBytes(16).toString('hex')
}

/* ─── Key helpers ───────────────────────────────────
   jose uses TextEncoder for HMAC keys
───────────────────────────────────────────────────── */
const accessKey  = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET)

/* ─── Issuer + audience  (L-06) ─────────────────────
   The admin portal and the student portal are signed with the SAME key, so a
   client token has always been structurally valid on an admin endpoint —
   only the role check separated them. That is one missing guard away from a
   privilege boundary failing silently. `aud` binds a token to the portal that
   issued it, so the two token families stop being interchangeable.

   ROLLOUT IS STAGED, and the order matters: tokens already in circulation
   carry no `aud` and no `iss`, and there are 30-day refresh tokens out there.
   Rejecting them on deploy would sign out every user at once.

     Stage 1 (now)  — every new token carries iss + aud. A token WITHOUT them
                      is still accepted, so live sessions keep working.
     Stage 2 (later)— set JWT_ENFORCE_AUDIENCE=true once JWT_REFRESH_EXPIRES_IN
                      has elapsed since deploy, by which point every legacy
                      token has expired. Absence then becomes a rejection.

   Flip stage 2 too early and everyone is logged out; never flipping it leaves
   the claims decorative. It belongs in the deploy checklist, not in code. */
export const JWT_ISSUER = 'delta-lms'

/** Which portal a token belongs to. */
export type TokenAudience = 'client' | 'admin'

const enforceClaims = (): boolean => process.env['JWT_ENFORCE_AUDIENCE'] === 'true'

/* Checked manually rather than via jose's `issuer` / `audience` options,
   because those reject a token that simply lacks the claim — which is exactly
   the legacy case stage 1 must tolerate. */
function assertClaims(payload: JWTPayload, expected?: TokenAudience): void {
  const iss = payload.iss
  if (iss === undefined) {
    if (enforceClaims()) throw new Error('Token has no issuer')
  } else if (iss !== JWT_ISSUER) {
    throw new Error('Token issuer mismatch')
  }

  /* No expectation means the caller genuinely accepts either portal —
     authenticateAny, which fronts endpoints shared by both. */
  if (!expected) return

  const aud = payload.aud
  if (aud === undefined) {
    if (enforceClaims()) throw new Error('Token has no audience')
    return
  }
  const list = Array.isArray(aud) ? aud : [aud]
  if (!list.includes(expected)) throw new Error('Token audience mismatch')
}

/* ─── Duration → seconds ────────────────────────────
   Converts '15m', '30d', '1h' → seconds for expires_in field
───────────────────────────────────────────────────── */
function durationToSeconds(duration: string): number {
  const unit  = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  /* A bad NUMBER is as likely as a bad unit — "bogus" ends in 's', so without
     this it would reach `case 's'` and return NaN, which then propagates into
     expires_in and cookie maxAge. Fall back rather than emit NaN. */
  if (!Number.isFinite(value) || value <= 0) return 900   // fallback: 15m
  switch (unit) {
    case 's': return value
    case 'm': return value * 60
    case 'h': return value * 3600
    case 'd': return value * 86400
    default:  return 900  // fallback: 15m
  }
}

/* ─── Sign access token ─────────────────────────────
   Short-lived (default 15m), carries role + email.

   `expiresIn` overrides the session TTL for tokens that are NOT part of the
   refresh cycle. Impersonation is the case that matters (M-02/M-04): it is
   handed out as a bare Bearer token with no refresh counterpart, so when it
   inherits a 15-minute session TTL the admin's impersonation session dies
   mid-task and the client cannot renew it — /admin/auth/refresh renews the
   ADMIN's cookie, not this token. Given its own budget it stays usable while
   ordinary sessions get short.
───────────────────────────────────────────────────── */
export async function signAccessToken(payload: {
  id: string
  email: string
  role: UserRole
}, expiresIn?: string, audience?: TokenAudience, impersonation?: {
  actorId:    string
  actorEmail: string
  sessionId:  string
}): Promise<string> {
  const jwt = new SignJWT({
    email: payload.email,
    role:  payload.role,
    type:  'access',
    /* Impersonation only (M-04): who is really behind the request, and which
       revocable session authorises it. */
    ...(impersonation && {
      act: { sub: impersonation.actorId, email: impersonation.actorEmail },
      isn: impersonation.sessionId,
    }),
  } satisfies Omit<AccessTokenPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.id)
    .setJti(newJti())
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(safeDuration(expiresIn ?? env.JWT_ACCESS_EXPIRES_IN, '15m'))
  if (audience) jwt.setAudience(audience)
  return jwt.sign(accessKey)
}

/** Seconds for a duration string — exported so callers can report expiry. */
export function toSeconds(duration: string): number {
  return durationToSeconds(duration)
}

/* ─── Duration jose will accept ─────────────────────
   jose's setExpirationTime THROWS on a malformed value, so passing an env
   string through unchecked means a single typo in JWT_ACCESS_EXPIRES_IN
   turns every login, registration and refresh into a 500 — authentication
   down platform-wide. Normalise to a known-good string instead; the value is
   already reported through durationToSeconds, which falls back the same way.
───────────────────────────────────────────────────── */
const VALID_UNITS = new Set(['s', 'm', 'h', 'd'])

function safeDuration(duration: string, fallback: string): string {
  const unit  = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  if (!VALID_UNITS.has(unit) || !Number.isFinite(value) || value <= 0) return fallback
  return `${value}${unit}`
}

/* ─── Sign refresh token ────────────────────────────
   Long-lived (default 30d), only carries sub
───────────────────────────────────────────────────── */
export async function signRefreshToken(userId: string, audience?: TokenAudience, expiresIn?: string): Promise<string> {
  const jwt = new SignJWT({ type: 'refresh' } satisfies Omit<RefreshTokenPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(newJti())
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(safeDuration(expiresIn ?? env.JWT_REFRESH_EXPIRES_IN, '30d'))
  if (audience) jwt.setAudience(audience)
  return jwt.sign(refreshKey)
}

/* ─── Generate token pair ───────────────────────────
   Convenience: returns both tokens + expiry seconds
───────────────────────────────────────────────────── */
export async function generateTokenPair(payload: {
  id: string
  email: string
  role: UserRole
}, audience?: TokenAudience, refreshExpiresIn?: string): Promise<TokenPair> {
  const [access_token, refresh_token] = await Promise.all([
    signAccessToken(payload, undefined, audience),
    signRefreshToken(payload.id, audience, refreshExpiresIn),
  ])
  return {
    access_token,
    refresh_token,
    expires_in: durationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
  }
}

/* ─── Verify access token ───────────────────────────
   Returns typed payload or throws
───────────────────────────────────────────────────── */
export async function verifyAccessToken(
  token: string,
  audience?: TokenAudience,
): Promise<AccessTokenPayload & JWTPayload> {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ['HS256'] })
  if (payload['type'] !== 'access') {
    throw new Error('Invalid token type')
  }
  assertClaims(payload, audience)
  return payload as AccessTokenPayload & JWTPayload
}

/* ─── Verify refresh token ──────────────────────────
   Returns typed payload or throws
───────────────────────────────────────────────────── */
export async function verifyRefreshToken(
  token: string,
  audience?: TokenAudience,
): Promise<RefreshTokenPayload & JWTPayload> {
  const { payload } = await jwtVerify(token, refreshKey, { algorithms: ['HS256'] })
  if (payload['type'] !== 'refresh') {
    throw new Error('Invalid token type')
  }
  /* Binds the refresh cookie to its portal too — otherwise a client refresh
     token replayed at /admin/auth/refresh would mint an admin session. */
  assertClaims(payload, audience)
  return payload as RefreshTokenPayload & JWTPayload
}
