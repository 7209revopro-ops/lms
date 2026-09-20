import type { Request, Response, NextFunction } from 'express'
import { AuthService, AuthError } from '@/services/auth.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import { verifyAccessToken, signAccessToken, toSeconds } from '@/utils/jwt.ts'
import {
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE,
  ACCESS_COOKIE,
  setAdminAuthCookies,
  clearAdminAuthCookies,
  ADMIN_REFRESH_COOKIE,
  ADMIN_ACCESS_COOKIE,
  setImpersonationCookie,
  clearImpersonationCookie,
  resolveDeviceId,
} from '@/utils/authCookies.ts'

/* ─────────────────────────────────────────────────────
   AuthController
   ─────────────────────────────────────────────────────
   Thin HTTP layer — no business logic here.
   Tokens are issued as httpOnly cookies, never returned
   in the JSON body (browsers attach them automatically).
───────────────────────────────────────────────────── */
function sessionMeta(
  req: Request,
  res?: Response,
): { userAgent?: string; ip?: string; deviceId?: string } {
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
  /* Express resolves req.ip via `trust proxy = 1`, so it handles X-Forwarded-For. */
  const ip = req.ip
  /* Reading/minting the device cookie is done here so it is set on the response
     even when the sign-in is then blocked (a pending device keeps its identity
     for an admin to approve). Only the student sign-in paths pass `res`; admin
     paths omit it, since staff are exempt from the device whitelist. */
  const deviceId = res ? resolveDeviceId(req, res) : undefined
  return { userAgent, ip, deviceId }
}

/* ─────────────────────────────────────────────────────
   Is this refresh failure proof the session is gone?
   ─────────────────────────────────────────────────────
   When it is, the caller CLEARS the cookies. That matters far more than it
   looks, because both Next middlewares gate on cookie PRESENCE while the API
   gates on validity. A dead-but-present cookie makes those two disagree
   forever: /login sees a cookie and bounces to the dashboard, the dashboard
   401s and bounces back to /login, and since each hop is a middleware
   redirect the browser reloads endlessly with no way to reach the sign-in
   form. Clearing on a definitive rejection is what keeps presence and
   validity telling the same story.

   Deliberately narrow. Only an AuthError carrying 401 counts — that is the
   service saying "this refresh token is invalid, expired, revoked or
   reused". A 429 from a limiter, a Mongo timeout, or any unexpected throw
   must NOT sign anybody out: those are transient, and logging out every
   admin over a blip would be a worse failure than the one being fixed. */
function isDeadSession(err: unknown): boolean {
  return err instanceof AuthError && err.statusCode === 401
}

/* Only clear when the caller actually presented one of our cookies.

   Without this guard the "no refresh token" branches would answer every
   anonymous POST with a cookie-deleting Set-Cookie — and since the cookies
   are SameSite=Lax with no CSRF layer, a cross-site POST carries NO cookies
   and would therefore hit exactly that branch. Any third-party page could
   then sign a logged-in user out at will. SameSite governs whether a cookie
   is SENT, not whether a Set-Cookie in the response is APPLIED, so the
   deletion would land.

   Requiring an access cookie to be present removes the vector completely: a
   cross-site request has none, so nothing is emitted. The case that matters
   — a stale access cookie whose refresh token is gone, which is precisely
   the present-but-dead state that loops — still gets cleaned up. */
function hasStaleCookie(req: Request, name: string): boolean {
  return typeof req.cookies?.[name] === 'string' && req.cookies[name].length > 0
}

export class AuthController {
  private readonly service = new AuthService()

  /* ── POST /auth/register ────────────────────────── */
  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.register(req.body, sessionMeta(req, res))

      /* Verification-first mode (M-05): no session, and deliberately the same
         answer a taken address gets — that identity is the whole point. */
      if ('verificationRequired' in result) {
        sendSuccess(
          res,
          { verificationRequired: true },
          'Check your inbox to finish setting up your account.',
          201,
        )
        return
      }

      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Account created successfully', 201)
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/login ─────────────────────────────
     An account with 2FA enabled gets a challenge instead
     of cookies; every other account gets exactly the
     response shape it always got. */
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body, sessionMeta(req, res))
      if ('twoFactorRequired' in result) {
        sendSuccess(
          res,
          { twoFactorRequired: true, challengeToken: result.challengeToken },
          'Enter the code from your authenticator app to finish signing in',
        )
        return
      }
      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/otp/request ───────────────────────
     Passwordless login step 1. Always answers the same way so it can't be
     used to probe which emails have accounts. */
  requestLoginOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { devCode } = await this.service.requestLoginOtp(String(req.body.email))
      sendSuccess(res, { ok: true, ...(devCode ? { devCode } : {}) }, 'If an account exists for that email, a sign-in code is on its way.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/otp/verify ────────────────────────
     Passwordless login step 2 — exchanges the code for the same session
     cookies a password login would set. */
  verifyLoginOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, code } = req.body as { email: string; code: string }
      const result = await this.service.verifyLoginOtp(email, code, sessionMeta(req, res))
      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/login-link/redeem ─────────────────
     One-click invite/login link → the same session cookies a password login
     sets. The client page then forwards to its `next` target (the course). */
  redeemLoginLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.redeemLoginLink(String(req.body.token), sessionMeta(req, res))
      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/login/2fa ───────────────────────── */
  loginTwoFactor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { challengeToken, code } = req.body as { challengeToken: string; code: string }
      const { user, tokens } = await this.service.loginTwoFactor(challengeToken, code, sessionMeta(req, res))
      setAuthCookies(res, tokens)
      sendSuccess(res, { user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/refresh ─────────────────────────── */
  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE]

      if (!rawToken) {
        /* No refresh cookie means the session cannot be recovered, so drop
           the access cookie with it — see isDeadSession above for why a
           dead-but-present cookie is the thing that loops. Guarded so an
           anonymous cross-site POST cannot use this as a logout. */
        if (hasStaleCookie(req, ACCESS_COOKIE)) clearAuthCookies(res)
        res.status(401).json({
          success: false,
          error: { code: 'MISSING_REFRESH_TOKEN', message: 'Refresh session not found' },
        })
        return
      }

      const tokens = await this.service.refresh(rawToken, sessionMeta(req, res))
      setAuthCookies(res, tokens)
      sendSuccess(res, null, 'Session refreshed')
    } catch (err) {
      if (isDeadSession(err)) clearAuthCookies(res)
      next(err)
    }
  }

  /* ── POST /auth/logout ──────────────────────────── */
  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE]
      if (rawToken) await this.service.logout(rawToken)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Signed out successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/login ─────────────────────────
     Admin-portal login — sets lms_admin_at / lms_admin_rt
     cookies only. Client lms_at is left completely untouched
     so both portals can maintain independent sessions.
  ──────────────────────────────────────────────────── */
  adminLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body, sessionMeta(req), 'admin')
      if ('twoFactorRequired' in result) {
        sendSuccess(
          res,
          { twoFactorRequired: true, challengeToken: result.challengeToken },
          'Enter the code from your authenticator app to finish signing in',
        )
        return
      }
      if (result.user.role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/sso-login ─────────────────────
     Somebody arriving from the Root portal, which is where this estate signs
     people in once and sends them on. It ends in the lms_admin_* cookies and
     applies the same refusal as a password sign-in here: a student has an
     account, but not one for this portal, and being vouched for elsewhere
     does not change which portal they belong in. */
  adminSsoLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.ssoLogin(String(req.body.token ?? ''), sessionMeta(req), 'admin')
      if (result.user.role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/login/2fa ─────────────────────
     Second factor for the admin portal — same challenge,
     but it ends in the lms_admin_* cookies. */
  adminLoginTwoFactor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { challengeToken, code } = req.body as { challengeToken: string; code: string }
      const { user, tokens } = await this.service.loginTwoFactor(challengeToken, code, sessionMeta(req), 'admin')
      if (user.role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, tokens)
      sendSuccess(res, { user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/refresh ───────────────────── */
  adminRefresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[ADMIN_REFRESH_COOKIE]
      if (!rawToken) {
        if (hasStaleCookie(req, ADMIN_ACCESS_COOKIE)) clearAdminAuthCookies(res)
        res.status(401).json({ success: false, error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } })
        return
      }
      const tokens = await this.service.refresh(rawToken, sessionMeta(req), 'admin')
      const { role } = await verifyAccessToken(tokens.access_token)
      if (role === 'student') {
        /* The refresh already rotated the stored token, so the cookies still
           in the browser are now stale. Leaving them would park this account
           in the same present-but-dead state, and no future refresh could
           ever succeed here. */
        clearAdminAuthCookies(res)
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, tokens)
      sendSuccess(res, null, 'Session refreshed')
    } catch (err) {
      if (isDeadSession(err)) clearAdminAuthCookies(res)
      next(err)
    }
  }

  /* ── POST /admin/auth/logout ─────────────────────── */
  adminLogout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[ADMIN_REFRESH_COOKIE]
      if (rawToken) await this.service.logout(rawToken)
      clearAdminAuthCookies(res)
      sendSuccess(res, null, 'Signed out successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/logout-all ──────────────────────── */
  logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.logoutAll(req.user!.id)
      clearAuthCookies(res)
      sendSuccess(res, null, 'All sessions revoked')
    } catch (err) {
      next(err)
    }
  }

  /* ── GET /auth/me ───────────────────────────────── */
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.getMe(req.user!.id)

      /* The impersonation cookie is httpOnly, so the client cannot see for
         itself that it is inside someone else's account. Reporting it here is
         what lets the banner exist at all — and the banner is the only thing
         stopping an admin forgetting whose screen they are looking at.
         Absent for ordinary sessions, so nothing changes for students. */
      const impersonation = req.user!.impersonationId
        ? {
            actorEmail: req.user!.impersonatorEmail,
            readOnly:   true,
          }
        : undefined

      sendSuccess(res, { user, ...(impersonation && { impersonation }) })
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me ─────────────────────────────── */
  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.updateMe(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Profile updated')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/enrollment-docs ────────────── */
  updateEnrollmentDocs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.updateEnrollmentDocs(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Documents updated')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/complete-registration ──────── */
  completeRegistration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.completeRegistration(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Registration submitted. Pending admin approval.')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/password ────────────────────── */
  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
      const tokens = await this.service.changePassword(req.user!.id, currentPassword, newPassword, sessionMeta(req))
      setAuthCookies(res, tokens)
      sendSuccess(res, null, 'Password changed successfully. Other devices have been signed out.')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/email ─────────────────────────
     Asks for the change. Nothing moves until the link in the new mailbox is
     clicked — the response says what is now pending, not what has happened. */
  requestEmailChange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { newEmail, currentPassword } = req.body as { newEmail: string; currentPassword: string }
      const out = await this.service.requestEmailChange(req.user!.id, newEmail, currentPassword)
      sendSuccess(res, out, `Confirmation sent to ${out.pendingEmail}. Your current address keeps working until you confirm.`)
    } catch (err) {
      next(err)
    }
  }

  /* ── DELETE /auth/me/email ──────────────────────── */
  cancelEmailChange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.cancelEmailChange(req.user!.id)
      sendSuccess(res, null, 'Email change cancelled.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/confirm-email-change ──────────────
     Unauthenticated on purpose: the link is opened from a mailbox, which may
     well be on a different device or browser from the signed-in session. The
     single-use token is the credential. */
  confirmEmailChange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token: string }
      const out = await this.service.confirmEmailChange(token)
      sendSuccess(res, out, 'Your email address has been changed. Use it to sign in from now on.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/forgot-password ───────────────────
     Always returns 200 to prevent account enumeration. */
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string }
      await this.service.forgotPassword(email)
      sendSuccess(res, null, 'If an account exists with that email, a reset link has been sent.')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /admin/auth/me/email-preferences ───────
     Every admin-side role (including sub_admin and support) manages its own
     notification preferences, so this is guarded by the admin portal session
     alone — no extra role gate. */
  updateMyEmailPrefs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const prefs = await this.service.updateEmailPrefs(req.user!.id, req.body ?? {})
      sendSuccess(res, prefs, 'Notification preferences updated.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/forgot-password ─────────────
     Same enumeration-safe behavior as the client flow, but the emailed reset
     link points at the admin portal and only staff accounts are served. The
     reset step itself (resetPassword) is shared — the token is portal-agnostic. */
  adminForgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string }
      await this.service.forgotPassword(email, 'admin')
      sendSuccess(res, null, 'If a staff account exists with that email, a reset link has been sent.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/reset-password ──────────────────── */
  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = req.body as { token: string; password: string }
      await this.service.resetPassword(token, password)
      sendSuccess(res, null, 'Password reset successfully. You can sign in now.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/verify-email ────────────────────── */
  verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token: string }
      await this.service.verifyEmail(token)
      sendSuccess(res, null, 'Email verified.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/resend-verification ─────────────── */
  resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.resendVerification(req.user!.id)
      sendSuccess(res, null, 'Verification email sent.')
    } catch (err) {
      next(err)
    }
  }

  /* ── GET /auth/sessions ─────────────────────────── */
  listSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentRefreshToken = req.cookies?.[REFRESH_COOKIE]
      const sessions = await this.service.listSessions(req.user!.id, currentRefreshToken)
      sendSuccess(res, sessions)
    } catch (err) {
      next(err)
    }
  }

  /* ── DELETE /auth/sessions/:id ──────────────────── */
  revokeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentRefreshToken = req.cookies?.[REFRESH_COOKIE]
      const { revokedCurrent } = await this.service.revokeSession(
        req.user!.id,
        String(req.params['id'] ?? ''),
        currentRefreshToken,
      )
      if (revokedCurrent) clearAuthCookies(res)
      sendSuccess(res, { revokedCurrent }, 'Session revoked.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/deactivate ──────────────────────── */
  deactivateAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password } = req.body as { password: string }
      await this.service.deactivateAccount(req.user!.id, password)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Account deactivated. You have been signed out.')
    } catch (err) {
      next(err)
    }
  }

  /* ── DELETE /auth/account ───────────────────────── */
  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password } = req.body as { password: string }
      await this.service.deleteAccount(req.user!.id, password)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Account permanently deleted.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/impersonation/redeem ─────────────────────────────────
     Runs on the CLIENT origin, which is the whole point: only this origin can
     set the client's host-only cookie. Unauthenticated by design — the code IS
     the credential, and the caller is a super admin who has no client session
     yet (and may never have had one).
  ─────────────────────────────────────────────────────────────────────── */
  redeemImpersonation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { code } = req.body as { code?: string }
      if (typeof code !== 'string' || code.length !== 64) {
        sendSuccess(res, null, 'This link is not valid.', 400)
        return
      }

      const { createHash } = await import('node:crypto')
      const codeHash = createHash('sha256').update(code).digest('hex')

      const { ImpersonationHandoffModel, ImpersonationSessionModel, UserModel } =
        await import('@/models/schema.ts')

      /* Single use, enforced atomically: the same filter that finds the row
         marks it spent, so two simultaneous redemptions cannot both win. A
         findOne-then-update would leave exactly that race. */
      const handoff = await ImpersonationHandoffModel.findOneAndUpdate(
        { codeHash, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true },
      ).lean()

      if (!handoff) {
        sendSuccess(res, null, 'This link has expired or has already been used.', 410)
        return
      }

      const session = await ImpersonationSessionModel.findById(handoff.sessionId)
        .select('targetId actorId actorEmail expiresAt revokedAt').lean()

      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        sendSuccess(res, null, 'This impersonation session is no longer active.', 410)
        return
      }

      const target = await UserModel.findById(session.targetId)
        .select('email role isActive').lean()
      if (!target || target.isActive === false) {
        sendSuccess(res, null, 'This account is no longer available.', 410)
        return
      }

      /* Minted here, not at handoff time — so no token granting student access
         ever sits in the database. Audience 'client' is what lets it pass
         authenticate(); the admin-side token is 'admin' and is rejected there. */
      const remainingMs = session.expiresAt.getTime() - Date.now()
      const token = await signAccessToken(
        { id: String(session.targetId), email: target.email, role: target.role },
        `${Math.max(1, Math.floor(remainingMs / 1000))}s`,
        'client',
        {
          actorId:    String(session.actorId),
          actorEmail: session.actorEmail,
          sessionId:  String(handoff.sessionId),
        },
      )

      setImpersonationCookie(res, token, remainingMs)
      sendSuccess(res, {
        expiresAt: session.expiresAt,
        actorEmail: session.actorEmail,
      }, 'Impersonation session started')
    } catch (err) { next(err) }
  }

  /* ── POST /auth/impersonation/exit ───────────────────────────────────
     Unauthenticated on purpose: clearing your own cookie needs no authority,
     and requiring auth here would mean a revoked or expired session could not
     be cleared — leaving a dead cookie that shadows the real one on every
     subsequent request.
  ─────────────────────────────────────────────────────────────────────── */
  exitImpersonation = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      clearImpersonationCookie(res)
      sendSuccess(res, null, 'Impersonation ended')
    } catch (err) { next(err) }
  }
}
