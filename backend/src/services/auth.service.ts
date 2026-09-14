import { createHash, randomBytes, randomInt } from 'crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { UserRepository, RefreshTokenRepository, AuthTokenRepository } from '@/repositories/user.repository.ts'
import { hashPassword, comparePassword } from '@/utils/hash.ts'
import { generateTokenPair, verifyRefreshToken, type TokenAudience } from '@/utils/jwt.ts'
import { logger } from '@/utils/logger.ts'
import { sendPasswordReset, sendVerifyEmail, sendRegistrationAttempt, sendLoginCode, sendCourseInvite, sendDeviceApprovalRequest } from '@/services/email.service.ts'
import { TotpService } from '@/services/totp.service.ts'
import { resolveDeviceForLogin, isDeviceApproved, type DeviceOutcome } from '@/services/device.service.ts'
import { env } from '@/config/env.ts'
import type { RegisterDto, LoginDto, TokenPair, UserRole } from '@/types/index.ts'
import type { SafeUser } from '@/models/types.ts'
import { toSafeUser } from '@/models/types.ts'

/* ─── Domain error class ────────────────────────────
   Thrown by service, caught by controller → next(err)
   → mapped to HTTP response by errorMiddleware
───────────────────────────────────────────────────── */
/* Concurrent refresh calls (multi-tab, rapid retries) can legitimately
   present the same refresh token within milliseconds of each other. The
   loser of that race sees the token as already "rotated" — within this
   grace window we answer it with the pair that rotation already issued
   instead of treating it as a replay attack. A genuine race is bounded by
   a single round trip, so the window is kept tight to limit how long a
   rotated token stays replayable. */
const ROTATION_RACE_GRACE_MS = 2_000

/* How long the losing side of that race waits for the winner to publish the
   pair it is minting — only bridges the few milliseconds between the
   rotation becoming visible in the DB and the winner registering it. */
const SUCCESSOR_WAIT_MS = 250

/* Rotations of this process, keyed by the hash of the token that was rotated
   → the pair that rotation issues. In-memory only (never persisted, never
   logged) and dropped once the grace window closes, so a token presented
   twice is answered idempotently instead of minting a second session. */
const rotationSuccessors = new Map<string, { pending: Promise<TokenPair>; expiresAt: number }>()

/* Constant bcrypt hash (cost 12, random plaintext nobody holds) compared
   against when no account matches the supplied email, so the not-found path
   costs the same as a wrong-password attempt and login timing can't be used
   to enumerate accounts. */
const DUMMY_PASSWORD_HASH = '$2b$12$igY4YUQwInCkDWoEqB72TuoXocL9MWGytYJ5xKnd22gK/EZOt1Fzq'

/* ─── Pending two-factor login challenge ─────────────
   An account with twoFactorEnabled gets no session from the password step
   alone — it gets this short-lived handle, which records nothing but "the
   password for this user has just been verified". It is a jose JWT signed
   with the access secret, but its `type` claim is neither 'access' nor
   'refresh', so verifyAccessToken() / verifyRefreshToken() both reject it:
   it can never be presented as a session token. */
const TWO_FACTOR_TYPE             = '2fa-challenge'
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000
const TWO_FACTOR_MAX_ATTEMPTS     = 5

const twoFactorKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET)

/* Per-challenge state keyed by the challenge's jti: how many codes have been
   tried against it, and whether it has already been redeemed (single use).
   In-memory only (never persisted, never logged) and swept once the challenge
   can no longer be valid. The durable rail against code guessing is the
   account lockout counter, which every wrong code increments. */
const twoFactorChallenges = new Map<string, { attempts: number; consumed: boolean; expiresAt: number }>()

/* Password accepted, but the account still owes a TOTP code. */
export interface TwoFactorPending {
  twoFactorRequired: true
  challengeToken:    string
}

/* ─── Verification-first signup  (M-05) ───────────────
   Registration auto-logs-in, so a new address returns a SESSION and a taken
   one returns an error — distinguishable no matter how the error is worded.
   The only way to make the two identical is to stop issuing a session at
   signup: both answers become "check your inbox", and the account is only
   usable after the emailed link is followed.

   That is a real product cost — a mail round trip before a new user can
   browse, and it depends on deliverability — so it ships OFF. Switch on with
   SIGNUP_REQUIRE_VERIFICATION=true. The client already handles both shapes:
   it looks for `verificationRequired` and shows the inbox message instead of
   redirecting, so flipping this needs no frontend change. */
const verificationFirst = (): boolean =>
  process.env['SIGNUP_REQUIRE_VERIFICATION'] === 'true'

/** Returned by register() in verification-first mode — deliberately carries
 *  nothing that distinguishes a new address from one already registered. */
export interface VerificationPending {
  verificationRequired: true
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/* Session metadata threaded from the controller into token issuance. `deviceId`
   is the browser's device-whitelist id (lms_device cookie); the controller
   mints it, and student sign-ins are gated on it. */
type SessionMeta = { userAgent?: string; ip?: string; deviceId?: string }

/* Only students are device-limited; staff sign in on any number of devices. */
function isDeviceLimited(role: UserRole): boolean {
  return role === 'student'
}

/* The machine code + message for a blocked device, mirroring the AI-academy
   side's DEVICE_PENDING / DEVICE_LIMIT / DEVICE_REVOKED. */
function deviceBlockError(reason: Exclude<DeviceOutcome, { ok: true }>['reason']): AuthError {
  switch (reason) {
    case 'pending':
      return new AuthError('DEVICE_PENDING', 'This is a new device. An admin needs to approve it before you can sign in — you will be able to sign in once they do.', 403)
    case 'limit':
      return new AuthError('DEVICE_LIMIT', 'You are already set up on two devices. Ask an admin to remove one before adding this device.', 403)
    case 'revoked':
      return new AuthError('DEVICE_REVOKED', 'This device\'s access was removed. Contact support if you think that is a mistake.', 403)
  }
}

/* ─────────────────────────────────────────────────────
   AuthService
   ─────────────────────────────────────────────────────
   No db param — Mongoose models are module singletons.
   Repositories are instantiated once as class fields.
───────────────────────────────────────────────────── */
export class AuthService {
  private readonly userRepo      = new UserRepository()
  private readonly tokenRepo     = new RefreshTokenRepository()
  private readonly authTokenRepo = new AuthTokenRepository()
  private readonly totpService   = new TotpService()

  /* ── Register ────────────────────────────────────── */
  async register(
    dto: RegisterDto,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<{ user: SafeUser; tokens: TokenPair } | VerificationPending> {
    /* 1. Hash FIRST, then check the email — deliberately in this order (M-05).
       Reversed, the taken-email path short-circuits before bcrypt and answers
       in ~6ms where a fresh email takes ~260ms. That 250ms gap is a clean
       enumeration oracle entirely independent of the status code: an attacker
       does not need to read the response at all, only time it. Paying the same
       bcrypt cost on both paths removes the signal. The hash is discarded when
       the address is taken; wasting it is the point. */
    const passwordHash = await hashPassword(dto.password)

    if (await this.userRepo.emailExists(dto.email)) {
      /* Tell the ACCOUNT HOLDER, not the caller. A probe against an address
         that already exists becomes something its owner can see, rather than
         a silent oracle — and if it was a genuine person who forgot they had
         signed up, it is the message they needed anyway. */
      void this.#notifyRegistrationAttempt(dto.email).catch(err =>
        logger.warn({ err }, 'registration-attempt notice failed'),
      )

      /* VERIFICATION-FIRST MODE closes the last of M-05. Both outcomes answer
         identically — "check your inbox" — so nothing in the response
         distinguishes a taken address from a new one. Only reachable when
         SIGNUP_REQUIRE_VERIFICATION is on; see the note below. */
      if (verificationFirst()) return { verificationRequired: true }

      /* DEFAULT MODE still confirms the address exists, and cannot avoid it:
         registration auto-logs-in, so a fresh email returns a SESSION and an
         attacker need only check whether they got one. No wording changes
         that. Turning it off is a product decision — it costs a mail round
         trip before a new user can browse — so the mechanism is built and the
         switch is left to you rather than flipped unilaterally. */
      throw new AuthError(
        'EMAIL_TAKEN',
        'An account with this email already exists. Please sign in.',
        409,
      )
    }

    /* 3. Determine signup type:
          - explicit flag from client takes priority
          - fallback: detect express if only homeCountry provided */
    const appFields = dto.enrollmentApplication ? Object.keys(dto.enrollmentApplication).filter(k => (dto.enrollmentApplication as Record<string, unknown>)[k] != null) : []
    const signupType: 'express' | 'full' = dto.signupType ?? (appFields.length <= 1 ? 'express' : 'full')

    /* 4. Determine organization — explicit selection (express signup) takes
       priority; fall back to the legacy homeCountry guess (India → Bangalore,
       else → Dubai) only for callers that don't send organizationSlug, e.g.
       the one-shot full-registration form. */
    const { OrganizationModel } = await import('@/models/schema.ts')
    const orgSlug = dto.organizationSlug
      ?? (dto.enrollmentApplication?.homeCountry === 'India' ? 'bangalore' : 'dubai')
    const orgDoc  = await OrganizationModel.findOne({ slug: orgSlug }).select('_id').lean()
    const organizationId = orgDoc?._id

    /* 5. Create user with pending enrollment status.

       `photoUrl` doubles as the avatar. The full signup form used to set it
       with a PATCH /auth/me straight after registering, which needed the
       session register hands back — the very thing verification-first mode
       withholds (M-05). Applying it here instead means the whole signup, files
       included, completes in this one request and works identically whether or
       not a session is issued at the end of it. */
    const photoUrl = dto.enrollmentApplication?.photoUrl?.trim()
    const user = await this.userRepo.createUser({
      name:                   dto.name.trim(),
      email:                  dto.email,
      passwordHash,
      role:                   'student',
      enrollmentStatus:       'pending',
      categories:             [],
      enrollmentApplication:  dto.enrollmentApplication,
      signupType,
      organizationId:         organizationId as any,
      ...(photoUrl ? { avatarUrl: photoUrl } : {}),
    })

    /* 6. Notify all admins of the new signup request */
    void this.#notifyAllAdmins(user.name, user.email).catch(err =>
      logger.warn({ err, userId: user.id }, 'admin notification failed'),
    )

    /* 7. Fire-and-forget verification email */
    void this.#sendVerificationEmail(user.id, user.email, user.name).catch(err =>
      logger.warn({ err, userId: user.id }, 'verification email failed'),
    )

    /* VERIFICATION-FIRST: no session at signup, and the SAME answer a taken
       address gets — which is what makes the two indistinguishable (M-05).
       The account exists and its enrolment data is saved; it simply cannot be
       used until the emailed link is followed. */
    if (verificationFirst()) {
      logger.info({ userId: user.id }, 'User registered — awaiting email verification')
      return { verificationRequired: true }
    }

    /* Default: issue tokens (student gets tokens but stays pending) */
    const tokens = await this.#issueLoginTokens(user.id, user.email, user.role, meta, audience)

    logger.info({ userId: user.id }, 'User registered')
    return { user: toSafeUser(user), tokens }
  }

  /* ── Login ───────────────────────────────────────── */
  async login(
    dto: LoginDto,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<{ user: SafeUser; tokens: TokenPair } | TwoFactorPending> {
    /* 1. Find user (includes passwordHash via select:+passwordHash) */
    const user = await this.userRepo.findByEmail(dto.email)
    if (!user) {
      /* Burn the same bcrypt cost as a real comparison before rejecting. */
      await comparePassword(dto.password, DUMMY_PASSWORD_HASH)
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }
    if (!user.isActive) {
      /* Same cost as the not-found path, so a blocked account can't be told
         apart from an unregistered one by response time either. */
      await comparePassword(dto.password, DUMMY_PASSWORD_HASH)
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }

    /* 2. Account-level lockout */
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      throw new AuthError(
        'ACCOUNT_LOCKED',
        `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        423,
      )
    }

    /* 3. An account that has no password yet.

       This used to answer "This account uses social login. Please sign in with
       Google." Both halves were wrong. There is no Google sign-in — no
       /auth/google route, no callback, and findByProvider() is never called
       from anywhere — so it pointed at a door that does not exist. And these
       are not social accounts: the two paths that create a user without a
       password are the bulk student import and external-purchase provisioning,
       neither of which involves a provider. Such a student is told to do the
       one thing that cannot work, and never told the thing that can.

       Forgot-password DOES work for them: it issues a reset token for any
       active account regardless of whether a hash exists, and resetPassword()
       simply writes one. So that is what the message names. */
    if (!user.passwordHash) {
      throw new AuthError(
        'NO_PASSWORD_SET',
        'This account does not have a password yet. Use "Forgot password?" below and ' +
        'we will email you a link to set one.',
        400,
      )
    }

    /* 4. Verify password */
    const valid = await comparePassword(dto.password, user.passwordHash)
    if (!valid) {
      const { lockedUntil } = await this.userRepo.incrementFailedLogin(user.id)
      if (lockedUntil) {
        throw new AuthError(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Account locked for 15 minutes.',
          423,
        )
      }
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }

    /* 5. Second factor — only for accounts that actually enabled it.
       The password step is not a session yet: hand back a challenge and
       leave lastLoginAt / the failed-attempt counter untouched until the
       code is verified. Accounts without 2FA fall straight through, so
       their response is byte-for-byte what it always was. */
    if (user.twoFactorEnabled) {
      const challengeToken = await this.#issueTwoFactorChallenge(user.id)
      logger.info({ userId: user.id }, 'password verified — awaiting 2FA code')
      return { twoFactorRequired: true, challengeToken }
    }

    /* 6. Successful login — reset counter + stamp time */
    void this.userRepo.touchLastLogin(user.id)

    /* 7. Issue tokens */
    const tokens = await this.#issueLoginTokens(user.id, user.email, user.role, meta, audience)

    logger.info({ userId: user.id }, 'User logged in')
    return { user: toSafeUser(user), tokens }
  }

  /* ── Login step 2 — verify the TOTP code ───────────
       Redeems a challenge from login() and, only then,
       issues the real pair. */
  async loginTwoFactor(
    challengeToken: string,
    code: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<{ user: SafeUser; tokens: TokenPair }> {
    /* 1. Verify the challenge itself — signature, expiry, type */
    let payload: JWTPayload
    try {
      ({ payload } = await jwtVerify(challengeToken, twoFactorKey, { algorithms: ['HS256'] }))
    } catch {
      throw new AuthError('INVALID_2FA_CHALLENGE', 'This sign-in request has expired. Please sign in again.', 401)
    }
    if (payload['type'] !== TWO_FACTOR_TYPE || !payload.sub || !payload.jti) {
      throw new AuthError('INVALID_2FA_CHALLENGE', 'This sign-in request is not valid. Please sign in again.', 401)
    }

    /* 2. Burn one attempt — caps guessing per challenge and rejects a
       handle that was already redeemed. */
    this.#claimTwoFactorAttempt(payload.jti, payload.exp)

    /* 3. Re-check the account — it may have been blocked, locked or had
       2FA turned off in the minutes since the password step. */
    const user = await this.userRepo.findById(payload.sub)
    if (!user || !user.isActive) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      throw new AuthError(
        'ACCOUNT_LOCKED',
        `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        423,
      )
    }
    if (!user.twoFactorEnabled) {
      throw new AuthError(
        'INVALID_2FA_CHALLENGE',
        'Two-factor authentication is no longer enabled on this account. Please sign in again.',
        401,
      )
    }

    /* 4. Verify the code — the secret never leaves TotpService */
    const ok = await this.totpService.verifyLoginCode(user.id, code)
    if (!ok) {
      /* Feed the same lockout counter a wrong password feeds, so guessing
         survives neither a fresh challenge nor a process restart. */
      const { lockedUntil } = await this.userRepo.incrementFailedLogin(user.id)
      if (lockedUntil) {
        throw new AuthError(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Account locked for 15 minutes.',
          423,
        )
      }
      throw new AuthError('INVALID_2FA_CODE', 'Verification code is incorrect or expired.', 401)
    }

    /* 5. Challenge redeemed — single use */
    this.#consumeTwoFactorChallenge(payload.jti)

    /* 6. Successful login — reset counter + stamp time */
    void this.userRepo.touchLastLogin(user.id)

    /* 7. Issue tokens */
    const tokens = await this.#issueLoginTokens(user.id, user.email, user.role, meta, audience)

    logger.info({ userId: user.id }, 'User logged in (2FA verified)')
    return { user: toSafeUser(user), tokens }
  }

  /* ── Refresh ─────────────────────────────────────── */
  async refresh(
    rawRefreshToken: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<TokenPair> {
    /* 1. Verify JWT */
    let payload
    try {
      payload = await verifyRefreshToken(rawRefreshToken, audience)
    } catch {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.', 401)
    }

    /* 2. Look up the token in DB and reason about its state.
       - Not found at all              → invalid / unknown token, 401
       - Found, revoked by 'rotation'  → possible reuse attack OR a benign
                                          race between concurrent refresh
                                          calls (e.g. two browser tabs both
                                          refreshing near the same 15-min
                                          expiry). Only escalate to a full
                                          session wipe once the rotation is
                                          older than a short grace window —
                                          within the window we hand back the
                                          pair that rotation already issued,
                                          so no second session is created.
       - Found, revoked any other way  → device was kicked legitimately, 401
       - Found, not revoked            → all good, rotate */
    const tokenHash = this.#hashToken(rawRefreshToken)
    const stored    = await this.tokenRepo.findByHash(tokenHash)

    if (!stored) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.', 401)
    }
    if (stored.isRevoked) {
      if (stored.revokedReason === 'rotation') {
        const rotatedAgoMs = Date.now() - stored.updatedAt.getTime()
        if (rotatedAgoMs > ROTATION_RACE_GRACE_MS) {
          await this.tokenRepo.revokeAllForUser(payload.sub!, 'security')
          logger.warn({ userId: payload.sub }, 'Refresh token reuse detected — all sessions revoked')
          throw new AuthError('TOKEN_REUSE', 'Security alert: session invalidated.', 401)
        }
        const successor = await this.#awaitRotationSuccessor(tokenHash)
        if (successor) {
          logger.debug({ userId: payload.sub }, 'Concurrent refresh race — replaying the pair that rotation already issued')
          return successor
        }
        /* Another instance performed that rotation, so its pair is not
           reachable from here (the map is per-process). Still a benign race —
           issue a fresh pair rather than signing a legitimate racer out. */
        logger.debug({ userId: payload.sub }, 'Concurrent refresh race — successor held by another instance, issuing a fresh pair')
        return this.#rotateTokens(payload.sub!, meta, audience)
      }
      /* User-revoked / logged-out / security-revoked — just reject this device. */
      throw new AuthError('INVALID_REFRESH_TOKEN', 'This session has been signed out.', 401)
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.', 401)
    }

    /* 3. Atomically claim this token for rotation. If another concurrent
       request already claimed it between our read above and now, treat
       this one as the losing side of the race too (see block above) —
       hand back the pair that request is issuing rather than minting a
       second session. */
    const claimed = await this.tokenRepo.claimForRotation(tokenHash)
    if (!claimed) {
      const successor = await this.#awaitRotationSuccessor(tokenHash)
      if (successor) {
        logger.debug({ userId: payload.sub }, 'Concurrent refresh race — replaying the pair that rotation already issued')
        return successor
      }
      /* Re-read before falling back: only a concurrent *rotation* is a benign
         race. A logout / logout-all / password change that landed in the same
         moment must still reject, or it could be outrun by a refresh. */
      const current = await this.tokenRepo.findByHash(tokenHash)
      if (current?.revokedReason !== 'rotation') {
        throw new AuthError('INVALID_REFRESH_TOKEN', 'This session has been signed out.', 401)
      }
      logger.debug({ userId: payload.sub }, 'Concurrent refresh race — successor held by another instance, issuing a fresh pair')
      return this.#rotateTokens(payload.sub!, meta, audience)
    }

    /* 4. Issue the new pair, publishing the in-flight work under the old
       token's hash first so a concurrent presentation of the same token
       is answered with this very pair. */
    const pending = this.#rotateTokens(payload.sub!, meta, audience)
    this.#rememberRotation(tokenHash, pending)
    const tokens = await pending
    logger.debug({ userId: payload.sub }, 'Tokens rotated')
    return tokens
  }

  /* ── Logout ──────────────────────────────────────── */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenRepo.revokeToken(this.#hashToken(rawRefreshToken), 'logout')
  }

  /* ── Logout all devices ──────────────────────────── */
  async logoutAll(userId: string): Promise<void> {
    await this.tokenRepo.revokeAllForUser(userId, 'logout')
    logger.info({ userId }, 'All sessions revoked')
  }

  /* ── List active sessions for the current user ─────
       Marks the session matching the supplied refresh token
       as `isCurrent: true` so the UI can label it. */
  async listSessions(userId: string, currentRefreshToken?: string) {
    const sessions = await this.tokenRepo.listActiveForUser(userId)
    const currentHash = currentRefreshToken ? this.#hashToken(currentRefreshToken) : null
    return sessions.map(s => ({
      id:         s.id,
      userAgent:  s.userAgent,
      ip:         s.ip,
      lastUsedAt: s.lastUsedAt,
      createdAt:  s.createdAt,
      expiresAt:  s.expiresAt,
      isCurrent:  currentHash !== null && s.tokenHash === currentHash,
    }))
  }

  /* ── Deactivate account (soft) ───────────────────────
       Sets isActive=false and revokes every session. The
       user record stays so an admin can reactivate. */
  async deactivateAccount(userId: string, currentPassword: string): Promise<void> {
    const user = await this.userRepo.findById(userId)
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    /* Re-auth: even logged in, require the current password */
    await this.#verifyCurrentPassword(userId, currentPassword)

    await this.userRepo.updateById(userId, { isActive: false })
    await this.tokenRepo.revokeAllForUser(userId, 'security')
    logger.info({ userId }, 'account deactivated')
  }

  /* ── Hard-delete account (GDPR) ───────────────────────
       Removes the user document, refresh tokens, auth
       tokens, and best-effort cascades to user-owned
       data. Enrollment + lesson progress are kept but
       repointed (orphaned) for analytics integrity —
       PII has been removed. */
  async deleteAccount(userId: string, currentPassword: string): Promise<void> {
    const user = await this.userRepo.findById(userId)
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    await this.#verifyCurrentPassword(userId, currentPassword)

    /* Cascade the user-attached personal records first. Shared with the ADMIN
       delete path, which used to do none of this and left every enrolment
       behind — see services/userCascade.ts. Imported lazily to avoid a
       circular import at module load. */
    const { cascadeUserDeletion } = await import('@/services/userCascade.ts')
    await Promise.all([
      this.tokenRepo.revokeAllForUser(userId, 'security'),
      cascadeUserDeletion(userId),
    ])
    await this.userRepo.hardDelete(userId)
    logger.info({ userId }, 'account hard-deleted')
  }

  /* Internal: verify the supplied current password matches.
     Used as a re-auth gate before destructive actions. */
  async #verifyCurrentPassword(userId: string, password: string): Promise<void> {
    /* findById doesn't return passwordHash (select:false); pull via email. */
    const user = await this.userRepo.findById(userId)
    if (!user) throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    const withHash = await this.userRepo.findByEmail(user.email)
    if (!withHash || !withHash.passwordHash) {
      throw new AuthError('PASSWORD_REQUIRED', 'Password confirmation is required.', 400)
    }
    const ok = await comparePassword(password, withHash.passwordHash)
    if (!ok) throw new AuthError('INVALID_PASSWORD', 'Password did not match.', 401)
  }

  /* ── Revoke a specific session (user action) ─────── */
  async revokeSession(userId: string, sessionId: string, currentRefreshToken?: string): Promise<{ revokedCurrent: boolean }> {
    if (!/^[a-fA-F0-9]{24}$/.test(sessionId)) {
      throw new AuthError('INVALID_SESSION_ID', 'Invalid session id', 400)
    }
    const session = await this.tokenRepo.findOwn(sessionId, userId)
    if (!session) {
      throw new AuthError('SESSION_NOT_FOUND', 'Session not found.', 404)
    }
    await this.tokenRepo.revokeById(sessionId, 'user')
    const currentHash = currentRefreshToken ? this.#hashToken(currentRefreshToken) : null
    const revokedCurrent = currentHash !== null && session.tokenHash === currentHash
    logger.info({ userId, sessionId, revokedCurrent }, 'session revoked by user')
    return { revokedCurrent }
  }

  /* ── Get authenticated user ──────────────────────── */
  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.userRepo.findById(userId)
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    return toSafeUser(user)
  }

  /* ── Update own profile (whitelisted fields) ─────── */
  async updateMe(
    userId: string,
    input: Partial<{
      name:       string
      headline:   string
      bio:        string
      avatarUrl:  string
      websiteUrl: string
    }>,
  ): Promise<SafeUser> {
    const data: Record<string, unknown> = {}
    if (input.name       !== undefined) data['name']       = input.name.trim()
    if (input.headline   !== undefined) data['headline']   = input.headline
    if (input.bio        !== undefined) data['bio']        = input.bio
    if (input.avatarUrl  !== undefined) data['avatarUrl']  = input.avatarUrl
    if (input.websiteUrl !== undefined) data['websiteUrl'] = input.websiteUrl

    const updated = await this.userRepo.updateById(userId, data)
    if (!updated) throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    return toSafeUser(updated)
  }

  /* ── Update enrollment document URLs after upload ── */
  async updateEnrollmentDocs(
    userId: string,
    input: { passportUrl?: string; idDocUrl?: string; photoUrl?: string },
  ): Promise<SafeUser> {
    const { UserModel } = await import('@/models/schema.ts')
    const update: Record<string, unknown> = {}
    if (input.passportUrl !== undefined) update['enrollmentApplication.passportUrl'] = input.passportUrl
    if (input.idDocUrl    !== undefined) update['enrollmentApplication.idDocUrl']    = input.idDocUrl
    if (input.photoUrl    !== undefined) update['enrollmentApplication.photoUrl']    = input.photoUrl
    const updated = await UserModel.findByIdAndUpdate(userId, { $set: update }, { new: true }).exec()
    if (!updated) throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    return toSafeUser(updated)
  }

  /* ── Complete full registration (express → full) ─── */
  async completeRegistration(
    userId: string,
    input: Record<string, unknown>,
  ): Promise<SafeUser> {
    const { UserModel } = await import('@/models/schema.ts')

    const user = await UserModel.findById(userId)
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }

    const appFields = [
      'phone', 'emergencyContact', 'gender', 'dateOfBirth', 'nationality', 'homeCountry',
      'occupation', 'idType', 'idNumber', 'emiratesId', 'countryAttendance', 'villa', 'city',
      'addressCountry', 'passportUrl', 'idDocUrl', 'photoUrl', 'experienceLevel',
      'preferredStartDate', 'hearAboutUs', 'referralName', 'programs', 'paymentMethod',
    ]

    const $set: Record<string, unknown> = {
      fullRegistrationSubmittedAt: new Date(),
      signupType: 'full',
    }

    /* If user was previously rejected, reset to pending so admin queue picks them up */
    if (user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled') {
      $set['enrollmentStatus'] = 'pending'
    }

    for (const field of appFields) {
      if (input[field] !== undefined) $set[`enrollmentApplication.${field}`] = input[field]
    }

    /* organizationId is intentionally left untouched here — it was already
       fixed at signup (explicit selection, or the homeCountry fallback for
       one-shot full registrations) and must not silently change just because
       the student is filling in the rest of their profile. */

    if (input['avatarUrl'] !== undefined && input['avatarUrl'] !== '') {
      $set['avatarUrl'] = input['avatarUrl']
    }

    const updated = await UserModel.findByIdAndUpdate(userId, { $set }, { new: true }).exec()
    if (!updated) throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)

    /* If the user already has a paid order, auto-approve immediately (approved by payment).
       This handles the express-account flow: pay → register → auto-approved. */
    const { OrderModel, CourseModel } = await import('@/models/schema.ts')
    const paidOrder = await OrderModel.findOne({ userId, status: 'paid' }).lean()
    if (paidOrder) {
      const course    = await CourseModel.findById((paidOrder as any).courseId).select('program').lean()
      const newCat    = (course as any)?.program as string | undefined
      const existing: string[] = (updated as any).categories ?? ((updated as any).category ? [(updated as any).category] : [])
      const merged    = newCat ? [...new Set([...existing, newCat])] : existing
      await UserModel.findByIdAndUpdate(userId, {
        $set: {
          enrollmentStatus: 'approved',
          approvedByEmail:  'payment@system',
          approvedByName:   'Paid Enrollment',
          approvedByRole:   'system',
          approvedAt:       new Date(),
          ...(merged.length > 0 && { categories: merged, category: merged[0] }),
        },
        $unset: { rejectionReason: '', enrollmentCancellationReason: '' },
      })
      const approved = await UserModel.findById(userId).exec()
      if (approved) {
        logger.info({ userId }, '✅ Express user auto-approved after completing registration with existing paid order')
        return toSafeUser(approved)
      }
    }

    logger.info({ userId }, 'express user completed full registration')
    return toSafeUser(updated)
  }

  /* ── Change password (authenticated) ──────────────
       Returns a fresh pair for the calling device: every
       pre-existing session is revoked, so the caller needs
       new cookies to stay signed in here. */
  /* ─── Changing the address on an account ─────────────────────────────────
     Three steps, and the split is the whole design.

     An email change is the classic path from a stolen SESSION to a stolen
     ACCOUNT: move the address, then use forgot-password against it, and the
     real owner finds out when they can no longer sign in. So:

       · the current password is required — a borrowed cookie is not enough,
         and this is the same bar changePassword() already sets;
       · the new address is parked in `pendingEmail` and proven by a link sent
         to it, because being able to read mail there is the only thing that
         demonstrates it belongs to you. A typo therefore costs nothing: the
         old address keeps working and the request simply expires;
       · the old address is told immediately, while it is still the live one —
         that is the owner's only chance to react in time.

     One hour, not the 24 the signup verification uses. This link moves an
     existing account rather than activating a new one, so the window in which
     a leaked link is useful should be as short as is still practical. */
  async requestEmailChange(
    userId: string,
    newEmailRaw: string,
    currentPassword: string,
  ): Promise<{ pendingEmail: string }> {
    const { UserModel } = await import('@/models/schema.ts')

    const user = await UserModel.findById(userId).select('+passwordHash').exec()
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    if (!user.passwordHash) {
      throw new AuthError(
        'NO_PASSWORD_SET',
        'This account does not have a password yet, so there is nothing to confirm with. ' +
        'Use "Forgot password?" to set one first.',
        400,
      )
    }
    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      throw new AuthError('WRONG_PASSWORD', 'Current password is incorrect.', 401)
    }

    const newEmail = newEmailRaw.trim().toLowerCase()
    if (newEmail === user.email.toLowerCase()) {
      throw new AuthError('SAME_EMAIL', 'That is already the address on your account.', 400)
    }

    /* Told plainly, rather than hidden behind a generic success.
       The caller is already signed in as this account, so the only thing a
       vague answer protects is whether OTHER addresses are registered — and it
       costs the student the one fact they need to fix their own mistake. The
       route rate-limits this endpoint, which is what actually bounds probing. */
    const taken = await UserModel.findOne({ email: newEmail }).select('_id').lean()
    if (taken) {
      throw new AuthError('EMAIL_TAKEN', 'That address is already used by another account.', 409)
    }

    user.pendingEmail = newEmail
    await user.save()

    const { raw } = await this.#issueAuthToken(userId, 'change-email', 60 * 60 * 1000)
    const url = `${env.CLIENT_URL}/confirm-email?token=${raw}`

    const { sendEmailChangeConfirm, sendEmailChangeNotice } =
      await import('@/services/email.service.ts')

    /* The confirmation is awaited: if it cannot be sent there is nothing for
       the student to click, and they should be told now rather than left
       waiting for a mail that never comes. The warning to the old address is
       fire-and-forget — it must never be able to fail the request, because a
       student whose old mailbox is dead still has to be able to move off it. */
    await sendEmailChangeConfirm(newEmail, user.name, url)
    void sendEmailChangeNotice(user.email, user.name, newEmail).catch(err =>
      logger.warn({ err, userId }, 'could not warn the old address about an email change'))

    return { pendingEmail: newEmail }
  }

  /** Drops an outstanding request. Any issued link stops working with it. */
  async cancelEmailChange(userId: string): Promise<void> {
    const { UserModel, AuthTokenModel } = await import('@/models/schema.ts')
    await UserModel.updateOne({ _id: userId }, { $unset: { pendingEmail: '' } })
    await AuthTokenModel.deleteMany({ userId, purpose: 'change-email' })
  }

  async confirmEmailChange(rawToken: string): Promise<{ email: string }> {
    const { UserModel } = await import('@/models/schema.ts')

    const tokenHash = this.#hashToken(rawToken)
    const claimed   = await this.authTokenRepo.claim(tokenHash, 'change-email')
    if (!claimed) {
      throw new AuthError('INVALID_TOKEN', 'That link is invalid or has expired.', 400)
    }

    const user = await UserModel.findById(claimed.userId).exec()
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }

    /* The request may have been cancelled, or superseded by a later one that
       parked a different address. The token is single-use and already spent,
       so there is nothing to roll back — just refuse. */
    const pending = user.pendingEmail
    if (!pending) {
      throw new AuthError('NO_PENDING_CHANGE', 'There is no email change waiting to be confirmed.', 400)
    }

    /* Checked AGAIN, because the gap between asking and confirming is up to an
       hour and somebody else can register the address inside it. The unique
       index is still the final arbiter below — this only turns the common case
       into a sentence a person can act on rather than a duplicate-key error. */
    const taken = await UserModel.findOne({ email: pending, _id: { $ne: user._id } }).select('_id').lean()
    if (taken) {
      user.pendingEmail = undefined
      await user.save()
      throw new AuthError('EMAIL_TAKEN', 'That address was registered by someone else while you were confirming.', 409)
    }

    user.email        = pending
    user.pendingEmail = undefined
    /* Confirmed by construction: the link was delivered to this address and
       came back. An account that was never verified becomes verified here. */
    user.isVerified   = true

    try {
      await user.save()
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        throw new AuthError('EMAIL_TAKEN', 'That address was registered by someone else while you were confirming.', 409)
      }
      throw err
    }

    return { email: user.email }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<TokenPair> {
    /* Must opt-in to passwordHash (select: false on schema) */
    const { UserModel } = await import('@/models/schema.ts')
    const user = await UserModel.findById(userId).select('+passwordHash').exec()
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    if (!user.passwordHash) {
      throw new AuthError(
        'NO_PASSWORD_SET',
        'This account does not have a password yet. Use "Forgot password?" to set one.',
        400,
      )
    }
    const valid = await comparePassword(currentPassword, user.passwordHash)
    if (!valid) {
      throw new AuthError('WRONG_PASSWORD', 'Current password is incorrect.', 401)
    }
    const newHash = await hashPassword(newPassword)
    await this.userRepo.updatePasswordHash(userId, newHash)
    /* Revoke every live session so a stolen refresh token dies with the
       old password, then re-issue for the device that made the change. */
    await this.tokenRepo.revokeAllForUser(userId, 'security')
    const tokens = await this.#issueTokens(user.id, user.email, user.role, meta, audience)
    logger.info({ userId }, 'password changed — all sessions revoked')
    return tokens
  }

  /* ── Forgot password ────────────────────────────── */
  /* ── Passwordless login — request an email code ────
       Always returns void without signalling whether the address exists, so
       this cannot be used to enumerate accounts. A 6-digit code is stored
       hashed and bound to the user; only the latest is valid. */
  async requestLoginOtp(email: string): Promise<{ devCode?: string }> {
    const user = await this.userRepo.findOne({ email: email.toLowerCase().trim() })
    if (!user || !user.isActive) {
      logger.debug({ email }, 'otp-login: no active account, silently skipping')
      return {}
    }
    const code = await this.#issueLoginOtp(user.id)
    await sendLoginCode(user.email, user.name, code)
    logger.info({ userId: user.id }, 'login OTP sent')
    /* Local convenience only: return the code so the flow can be exercised
       without a mailbox. Two gates — never production, and opt-in per env. */
    const echo = process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_ECHO === '1'
    return echo ? { devCode: code } : {}
  }

  /* ── Passwordless login — verify the code ──────────
       Same session-issuing outcome as password login. The code is single-use
       and expires in 10 minutes (claim() enforces both atomically). */
  async verifyLoginOtp(
    email: string,
    code: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<{ user: ReturnType<typeof toSafeUser>; tokens: TokenPair }> {
    const invalid = () => new AuthError('INVALID_OTP', 'That code is invalid or has expired. Request a new one.', 400)

    const user = await this.userRepo.findOne({ email: email.toLowerCase().trim() })
    if (!user || !user.isActive) throw invalid()

    const tokenHash = this.#hashToken(`${user.id}:${code.trim()}`)
    const claimed   = await this.authTokenRepo.claim(tokenHash, 'otp-login')
    if (!claimed) throw invalid()

    void this.userRepo.touchLastLogin(user.id)
    const tokens = await this.#issueLoginTokens(user.id, user.email, user.role, meta, audience)
    logger.info({ userId: user.id }, 'User logged in via OTP')
    return { user: toSafeUser(user), tokens }
  }

  /* ── Invitation: email a one-click login link ──────
       Creates a passwordless account if none exists (name derived from the
       email when not given), issues a single-use link, and emails it. The
       link lands on the client's /auth/continue page, which signs the user in
       and forwards to `next` (e.g. the English course interface). */
  async inviteToCourse(
    email: string,
    opts: { next?: string; name?: string; courseName?: string } = {},
  ): Promise<{ link: string; created: boolean }> {
    const normalized = email.toLowerCase().trim()
    let user = await this.userRepo.findOne({ email: normalized })
    let created = false
    if (!user) {
      const { UserModel } = await import('@/models/schema.ts')
      user = await UserModel.create({
        name: opts.name?.trim() || normalized.split('@')[0],
        email: normalized,
        role: 'student',
      })
      created = true
    }
    if (!user.isActive) throw new AuthError('ACCOUNT_DISABLED', 'This account is disabled.', 403)

    const raw  = await this.#issueLoginLink(user.id)
    const next = opts.next && opts.next.startsWith('/') ? opts.next : '/my-learning'
    const link = `${env.CLIENT_URL}/continue?token=${raw}&next=${encodeURIComponent(next)}`
    await sendCourseInvite(user.email, user.name, link, opts.courseName ?? 'Delta AI Academy')
    logger.info({ userId: user.id, created }, 'course invite / login link sent')
    return { link, created }
  }

  /* ── Redeem a one-click login link → session ───────
       Single-use and time-limited (claim() enforces both). Same session
       outcome as a password login. */
  async redeemLoginLink(
    rawToken: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<{ user: ReturnType<typeof toSafeUser>; tokens: TokenPair }> {
    const invalid = () => new AuthError('INVALID_LOGIN_LINK', 'This sign-in link is invalid, used, or expired. Sign in with your email instead.', 400)
    const tokenHash = this.#hashToken(rawToken)
    const claimed   = await this.authTokenRepo.claim(tokenHash, 'login-link')
    if (!claimed) throw invalid()

    const user = await this.userRepo.findById(claimed.userId.toString())
    if (!user || !user.isActive) throw invalid()

    void this.userRepo.touchLastLogin(user.id)
    const tokens = await this.#issueLoginTokens(user.id, user.email, user.role, meta, audience)
    logger.info({ userId: user.id }, 'User logged in via login link')
    return { user: toSafeUser(user), tokens }
  }

  /* ── Generate a one-time login-link token ──────────
       Random 32-byte token (unlike the 6-digit OTP), 7-day single-use. Prior
       unused links are invalidated so only the latest works. */
  async #issueLoginLink(userId: string): Promise<string> {
    await this.authTokenRepo.invalidateForUser(userId, 'login-link')
    const raw       = randomBytes(32).toString('hex')
    const tokenHash = this.#hashToken(raw)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await this.authTokenRepo.create_({ userId, tokenHash, purpose: 'login-link', expiresAt })
    return raw
  }

  /* ── Generate a one-time 6-digit login code ────────
       Bound to the user (hash of `${userId}:${code}`) so a short code stays
       unique in the shared token collection and can't be replayed for another
       account. Prior unused codes are invalidated first. */
  async #issueLoginOtp(userId: string): Promise<string> {
    await this.authTokenRepo.invalidateForUser(userId, 'otp-login')
    const code      = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const tokenHash = this.#hashToken(`${userId}:${code}`)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await this.authTokenRepo.create_({ userId, tokenHash, purpose: 'otp-login', expiresAt })
    return code
  }

  async forgotPassword(email: string): Promise<void> {
    /* Always succeed visibly (don't leak account existence).
       Only do work when an active account is found. */
    const user = await this.userRepo.findOne({ email: email.toLowerCase().trim() })
    if (!user || !user.isActive) {
      logger.debug({ email }, 'forgot-password: no active account, silently skipping')
      return
    }
    const { raw } = await this.#issueAuthToken(user.id, 'reset-password', 60 * 60 * 1000)
    const resetUrl = `${env.CLIENT_URL}/reset-password?token=${raw}`
    await sendPasswordReset(user.email, user.name, resetUrl)
    logger.info({ userId: user.id }, 'password-reset email sent')
  }

  /* ── Reset password (token-based) ────────────────── */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.#hashToken(rawToken)
    const claimed   = await this.authTokenRepo.claim(tokenHash, 'reset-password')
    if (!claimed) {
      throw new AuthError('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.', 400)
    }
    const passwordHash = await hashPassword(newPassword)
    await this.userRepo.updatePasswordHash(claimed.userId.toString(), passwordHash)
    /* Revoke all live sessions for safety. */
    await this.tokenRepo.revokeAllForUser(claimed.userId.toString(), 'security')
    logger.info({ userId: claimed.userId }, 'password reset')
  }

  /* ── Verify email ────────────────────────────────── */
  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = this.#hashToken(rawToken)
    const claimed   = await this.authTokenRepo.claim(tokenHash, 'verify-email')
    if (!claimed) {
      throw new AuthError('INVALID_VERIFY_TOKEN', 'This verification link is invalid or has expired.', 400)
    }
    await this.userRepo.setVerified(claimed.userId.toString())
    logger.info({ userId: claimed.userId }, 'email verified')
  }

  /* ── Resend verification email ───────────────────── */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId)
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found.', 404)
    }
    if (user.isVerified) {
      throw new AuthError('ALREADY_VERIFIED', 'This account is already verified.', 400)
    }
    await this.#sendVerificationEmail(user.id, user.email, user.name)
  }

  /* ── Device whitelist gate for a sign-in ───────────
     Students are capped at two devices: the first browser is auto-approved as
     their main, a second is a pending request an admin approves, a third is
     refused. Staff are exempt. A block throws before any token is issued, so a
     blocked device never gets a session (its device row and cookie still exist,
     so an admin can approve it and the buyer can then sign in). */
  async #enforceDeviceForLogin(userId: string, role: UserRole, meta?: SessionMeta): Promise<void> {
    if (!isDeviceLimited(role)) return
    const deviceId = meta?.deviceId
    if (!deviceId) return // no browser device context (non-cookie client) — nothing to gate on
    const outcome = await resolveDeviceForLogin(userId, deviceId, { userAgent: meta?.userAgent, ip: meta?.ip })
    if (!outcome.ok) {
      /* Tell admins the first time a browser is blocked, so the request doesn't
         sit unseen — but only once (created), not on every blocked retry. */
      if ((outcome.reason === 'pending' || outcome.reason === 'limit') && outcome.created) {
        void this.#notifyAdminsDeviceRequest(userId, outcome.label).catch(err =>
          logger.warn({ err, userId }, 'device approval notification failed'))
      }
      throw deviceBlockError(outcome.reason)
    }
  }

  /* Emails admins that a student is waiting on a second-device approval, with a
     link to the Devices page. Best-effort — never blocks the sign-in it
     describes. Mirrors #notifyAllAdmins. */
  async #notifyAdminsDeviceRequest(userId: string, deviceLabel: string): Promise<void> {
    const { UserModel } = await import('@/models/schema.ts')
    const student = await UserModel.findById(userId).select('email').lean<{ email?: string }>()
    if (!student?.email) return
    const admins = await UserModel.find({
      role: { $in: ['super_admin', 'admin'] },
      isActive: true,
    }).select('name email').lean()
    const reviewUrl = `${env.ADMIN_URL}/devices`
    await Promise.allSettled(
      admins.map(a =>
        sendDeviceApprovalRequest(a['email'] as string, (a['name'] as string) ?? 'there', student.email!, deviceLabel, reviewUrl)
          .catch(() => undefined),
      ),
    )
    logger.info({ userId, adminCount: admins.length }, 'Admin device-approval notifications sent')
  }

  /* Issue a session for a fresh sign-in — gated on the device whitelist first.
     Every login path funnels through here; token reissue for an already-open
     session (password change) and rotation call #issueTokens directly. */
  async #issueLoginTokens(
    userId: string,
    email: string,
    role: UserRole,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<TokenPair> {
    await this.#enforceDeviceForLogin(userId, role, meta)
    return this.#issueTokens(userId, email, role, meta, audience)
  }

  /* ── Issue + persist token pair ──────────────────── */
  async #issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<TokenPair> {
    /* `audience` binds the pair to the portal that issued it (L-06). Defaults
       to 'client' so any caller that forgets to pass one produces the LESS
       privileged token rather than an admin one. */
    const pair = await generateTokenPair({ id: userId, email, role }, audience)

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    await this.tokenRepo.saveToken({
      userId,
      tokenHash: this.#hashToken(pair.refresh_token),
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 500),
      ip:        meta?.ip,
    })

    return pair
  }

  /* ── Mint the successor pair for a claimed rotation ─ */
  async #rotateTokens(
    userId: string,
    meta?: SessionMeta,
    audience: TokenAudience = 'client',
  ): Promise<TokenPair> {
    const user = await this.userRepo.findById(userId)
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Account not found or deactivated.', 401)
    }
    /* The session lives only while its browser stays an approved device: a
       student whose device an admin revokes loses the session on the next
       refresh, rather than waiting out the 30-day token. 401 so the controller
       clears the cookies as a dead session. Staff are exempt. */
    if (isDeviceLimited(user.role) && !(await isDeviceApproved(user.id, meta?.deviceId ?? ''))) {
      throw new AuthError('DEVICE_REVOKED', 'This device is no longer approved. Sign in again.', 401)
    }
    /* A rotation must preserve the portal the session started in, or the
       first refresh would silently re-issue the pair as 'client' (L-06). */
    return this.#issueTokens(user.id, user.email, user.role, meta, audience)
  }

  /* ── Publish an in-flight rotation for racing callers ─ */
  #rememberRotation(tokenHash: string, pending: Promise<TokenPair>): void {
    const now = Date.now()
    for (const [hash, entry] of rotationSuccessors) {
      if (entry.expiresAt <= now) rotationSuccessors.delete(hash)
    }
    /* Keep a handler attached so a failed rotation neither surfaces as an
       unhandled rejection nor lingers in the map. */
    void pending.catch(() => rotationSuccessors.delete(tokenHash))
    rotationSuccessors.set(tokenHash, { pending, expiresAt: now + ROTATION_RACE_GRACE_MS })
  }

  /* ── Await the pair a concurrent rotation issued ────
       null when this process never rotated that token —
       another instance did, or the window already closed. */
  async #awaitRotationSuccessor(tokenHash: string): Promise<TokenPair | null> {
    const deadline = Date.now() + SUCCESSOR_WAIT_MS
    for (;;) {
      const entry = rotationSuccessors.get(tokenHash)
      if (entry && entry.expiresAt > Date.now()) {
        try {
          return await entry.pending
        } catch {
          return null
        }
      }
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 20))
    }
  }

  /* ── Mint a pending-2FA challenge ──────────────────
       Carries only the user id + a jti; the attempt count
       and the single-use flag live in twoFactorChallenges. */
  async #issueTwoFactorChallenge(userId: string): Promise<string> {
    const now   = Date.now()
    const jti   = randomBytes(16).toString('hex')
    const token = await new SignJWT({ type: TWO_FACTOR_TYPE })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(Math.floor((now + TWO_FACTOR_CHALLENGE_TTL_MS) / 1000))
      .sign(twoFactorKey)

    this.#sweepTwoFactorChallenges(now)
    twoFactorChallenges.set(jti, {
      attempts:  0,
      consumed:  false,
      expiresAt: now + TWO_FACTOR_CHALLENGE_TTL_MS,
    })
    return token
  }

  /* ── Burn one attempt against a challenge ──────────
       An unknown jti was minted by another instance (or
       before a restart): it is tracked from here on rather
       than rejected, so a legitimate user is never stranded
       — every wrong code still increments the account's
       durable failed-login counter. */
  #claimTwoFactorAttempt(jti: string, expSeconds?: number): void {
    const now = Date.now()
    this.#sweepTwoFactorChallenges(now)

    let entry = twoFactorChallenges.get(jti)
    if (!entry) {
      entry = {
        attempts:  0,
        consumed:  false,
        expiresAt: expSeconds ? expSeconds * 1000 : now + TWO_FACTOR_CHALLENGE_TTL_MS,
      }
      twoFactorChallenges.set(jti, entry)
    }
    if (entry.consumed) {
      throw new AuthError(
        'INVALID_2FA_CHALLENGE',
        'This sign-in request has already been used. Please sign in again.',
        401,
      )
    }
    entry.attempts += 1
    if (entry.attempts > TWO_FACTOR_MAX_ATTEMPTS) {
      entry.consumed = true
      throw new AuthError('TOO_MANY_2FA_ATTEMPTS', 'Too many incorrect codes. Please sign in again.', 429)
    }
  }

  /* ── Mark a challenge as spent (single use) ──────── */
  #consumeTwoFactorChallenge(jti: string): void {
    const entry = twoFactorChallenges.get(jti)
    if (entry) entry.consumed = true
  }

  /* ── Drop challenges that can no longer be valid ─── */
  #sweepTwoFactorChallenges(now: number): void {
    for (const [id, entry] of twoFactorChallenges) {
      if (entry.expiresAt <= now) twoFactorChallenges.delete(id)
    }
  }

  /* ── SHA-256 hash a token string ─────────────────── */
  #hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /* ── Generate a one-time auth token (reset / verify) ─
       Returns the raw token for emailing AND persists
       only the hash to the DB. */
  async #issueAuthToken(
    userId: string,
    purpose: 'reset-password' | 'verify-email' | 'change-email',
    ttlMs: number,
  ): Promise<{ raw: string }> {
    /* Invalidate any outstanding tokens for this purpose so the most
       recent email is always the only working link. */
    await this.authTokenRepo.invalidateForUser(userId, purpose)

    const raw       = randomBytes(32).toString('hex')
    const tokenHash = this.#hashToken(raw)
    const expiresAt = new Date(Date.now() + ttlMs)
    await this.authTokenRepo.create_({ userId, tokenHash, purpose, expiresAt })
    return { raw }
  }

  /* ── Tell an account holder that someone tried to reuse their address ──
       Looks the owner up by email so the notice goes to the registered
       account, never to the caller. Silent when no account matches — this is
       only reachable when one does, but the guard keeps it honest if the
       call site ever moves. */
  async #notifyRegistrationAttempt(email: string): Promise<void> {
    const existing = await this.userRepo.findOne({ email: email.toLowerCase().trim() })
    if (!existing || !existing.isActive) return
    await sendRegistrationAttempt(existing.email, existing.name, `${env.CLIENT_URL}/login`)
  }

  /* ── Send a verification email for a user ────────── */
  async #sendVerificationEmail(userId: string, email: string, name: string): Promise<void> {
    const { raw } = await this.#issueAuthToken(userId, 'verify-email', 24 * 60 * 60 * 1000)
    const url = `${env.CLIENT_URL}/verify-email?token=${raw}`
    await sendVerifyEmail(email, name, url)
  }

  /* ── Notify all admins of a new student signup ────── */
  async #notifyAllAdmins(studentName: string, studentEmail: string): Promise<void> {
    const { UserModel } = await import('@/models/schema.ts')
    const admins = await UserModel.find({
      role: { $in: ['super_admin', 'admin'] },
      isActive: true,
    }).select('name email').lean()
    await Promise.allSettled(
      admins.map(a =>
        sendVerifyEmail(
          a['email'] as string,
          a['name'] as string,
          `${env.CLIENT_URL}/admin/enrollment-requests`,
        ).catch(() => undefined),
      ),
    )
    logger.info({ studentEmail, adminCount: admins.length }, 'Admin enrollment notifications sent')
  }
}
