import { Router } from 'express'
import { z } from 'zod'
import { AuthController } from '@/controllers/auth.controller.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { authRateLimit, refreshRateLimit, impersonationRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { documentRef, requiredDocumentRef } from '@/utils/documentRef.ts'
import totpRoutes from './totp.routes.ts'

const router = Router()
const auth   = new AuthController()

/* ─── Zod schemas ────────────────────────────────── */
const enrollmentAppSchema = z.object({
  phone:              z.string().max(30).optional(),
  emergencyContact:   z.string().max(30).optional(),
  gender:             z.enum(['Male', 'Female', 'Prefer not to say']).optional(),
  dateOfBirth:        z.string().optional(),
  nationality:        z.string().max(80).optional(),
  homeCountry:        z.string().max(80).optional(),
  occupation:         z.string().max(120).optional(),
  idType:             z.string().max(40).optional(),
  idNumber:           z.string().max(40).optional(),
  emiratesId:         z.string().max(20).optional(),
  countryAttendance:  z.string().max(80).optional(),
  villa:              z.string().max(120).optional(),
  city:               z.string().max(80).optional(),
  addressCountry:     z.string().max(80).optional(),
  passportUrl:        documentRef,
  idDocUrl:           documentRef,
  photoUrl:           documentRef,
  experienceLevel:    z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  preferredStartDate: z.string().optional(),
  hearAboutUs:        z.string().max(80).optional(),
  referralName:       z.string().max(120).optional(),
  programs:           z.array(z.string().max(120)).optional(),
  paymentMethod:      z.string().max(50).optional(),
}).optional()

const registerSchema = z.object({
  name:       z.string().min(2).max(120).trim(),
  email:      z.string().trim().email().toLowerCase(),
  password:   z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  signupType:       z.enum(['express', 'full']).optional(),
  organizationSlug: z.enum(['dubai', 'bangalore']).optional(),
  enrollmentApplication: enrollmentAppSchema,
})

const loginSchema = z.object({
  /* .trim() BEFORE .email(): people paste their address out of the mail or
     message that gave it to them, and that carries whitespace. Without the
     trim it is refused as "Invalid email" -- which points at the address
     rather than at the space, and reads to the person as "my account is
     broken". Lowercasing already happens; trimming only makes the form agree
     with how the address is stored and looked up. */
  email:    z.string().trim().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
})

/* ─── Passwordless (email → OTP) login ────────────── */
const otpRequestSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
})
const otpVerifySchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  code:  z.string().regex(/^\d{6}$/, 'Enter the six-digit code from your email'),
})
const loginLinkSchema = z.object({
  token: z.string().min(16, 'Invalid link'),
})

/* Second login step for accounts with 2FA enabled — the challenge handed
   back by /login plus the 6-digit code from the authenticator app. */
const loginTwoFactorSchema = z.object({
  challengeToken: z.string().min(20, 'Challenge token is required'),
  code:           z.string().trim().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be 6 digits'),
})

/* ─── Reset / verify schemas ─────────────────────── */
const forgotSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
})
const resetSchema = z.object({
  token:    z.string().min(32),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})
const verifySchema = z.object({
  token: z.string().min(32),
})

/* ─── Routes ─────────────────────────────────────── */

// Public
router.post('/register',         authRateLimit, validate(registerSchema), auth.register)
router.post('/login',            authRateLimit, validate(loginSchema),    auth.login)
router.post('/login/2fa',        authRateLimit, validate(loginTwoFactorSchema), auth.loginTwoFactor)
/* Passwordless login: request an email code, then exchange it for a session. */
router.post('/otp/request',      authRateLimit, validate(otpRequestSchema), auth.requestLoginOtp)
router.post('/otp/verify',       authRateLimit, validate(otpVerifySchema),  auth.verifyLoginOtp)
/* One-click invite/login link → session (redeemed by the client's /auth/continue). */
router.post('/login-link/redeem', authRateLimit, validate(loginLinkSchema), auth.redeemLoginLink)
/* The admin portal's second factor lives beside its own login, at
   /api/v1/admin/auth/login/2fa (see admin.routes.ts). */
router.post('/refresh',          refreshRateLimit, auth.refresh)
router.post('/logout',           authRateLimit, auth.logout)
router.post('/forgot-password',  authRateLimit, validate(forgotSchema),   auth.forgotPassword)
router.post('/reset-password',   authRateLimit, validate(resetSchema),    auth.resetPassword)
router.post('/verify-email',     authRateLimit, validate(verifySchema),   auth.verifyEmail)

/* ── Client-portal impersonation handoff ──────────────────────────────
   Both unauthenticated by design — see the controller. On their OWN limiter,
   not the auth one: sharing it let a few impersonations exhaust the login
   budget for a whole office IP, and put EXIT behind the same cap, which meant
   the punishment for going too fast was being stuck inside a student account.
   See impersonationRateLimit. */
router.post('/impersonation/redeem', impersonationRateLimit, auth.redeemImpersonation)
router.post('/impersonation/exit',   impersonationRateLimit, auth.exitImpersonation)

/* ─── Profile update DTO ─────────────────────────── */
const updateMeSchema = z.object({
  name:       z.string().min(2).max(120).trim().optional(),
  headline:   z.string().max(255).optional(),
  bio:        z.string().max(2000).optional(),
  avatarUrl:  z.string().url().or(z.literal('')).optional(),
  websiteUrl: z.string().url().or(z.literal('')).optional(),
})

/* Enrollment docs update — identity scans arrive as a `kyc/` key (H-11), the
   profile photo as a URL on our own storage. See utils/documentRef.ts. */
const enrollmentDocsSchema = z.object({
  passportUrl: documentRef,
  idDocUrl:    documentRef,
  photoUrl:    documentRef,
})

/* Complete registration — express users upgrading to full enrollment */
const completeRegistrationSchema = z.object({
  phone:              z.string().min(5).max(30),
  emergencyContact:   z.string().max(30).optional().or(z.literal('')),
  gender:             z.enum(['Male', 'Female', 'Prefer not to say']),
  dateOfBirth:        z.string().min(1),
  nationality:        z.string().max(80),
  homeCountry:        z.string().max(80),
  occupation:         z.string().max(120),
  idType:             z.enum(['Emirates ID', 'Passport', 'Aadhaar Card', 'Other']),
  idNumber:           z.string().max(40),
  countryAttendance:  z.string().max(80),
  villa:              z.string().max(120).optional().or(z.literal('')),
  city:               z.string().min(1).max(80),
  addressCountry:     z.string().max(80),
  passportUrl:        requiredDocumentRef,
  idDocUrl:           requiredDocumentRef,
  photoUrl:           documentRef,
  experienceLevel:    z.enum(['Beginner', 'Intermediate', 'Advanced']),
  preferredStartDate: z.string().min(1),
  hearAboutUs:        z.string().max(80),
  referralName:       z.string().max(120).optional().or(z.literal('')),
  programs:           z.array(z.string().max(120)).min(1, 'Select at least one program'),
  paymentMethod:      z.string().max(50),
  avatarUrl:          z.string().url().optional().or(z.literal('')),
})

/* Re-auth schema used by deactivate + delete */
const reauthSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

/* The same shape the signup form validates against, so an address accepted
   here cannot be one that could never have registered in the first place. */
const emailChangeSchema = z.object({
  newEmail:        z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  currentPassword: z.string().min(1, 'Your current password is required'),
})

const confirmEmailChangeSchema = z.object({
  token: z.string().min(1),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

// Protected
/* ── 2FA sub-router ── */
router.use('/2fa', totpRoutes)

router.post  ('/logout-all',          authenticate, auth.logoutAll)
router.get   ('/me',                  authenticate, auth.me)
router.patch ('/me',                       authenticate, validate(updateMeSchema), auth.updateMe)
router.patch ('/me/enrollment-docs',       authenticate, validate(enrollmentDocsSchema), auth.updateEnrollmentDocs)
router.patch ('/me/complete-registration', authenticate, validate(completeRegistrationSchema), auth.completeRegistration)
router.patch ('/me/password',         authRateLimit, authenticate, validate(changePasswordSchema), auth.changePassword)

/* ── Changing the address on an account ───────────────
   All three carry authRateLimit. The request endpoint reports whether an
   address is already registered — useful to the student, but a probe if left
   unbounded, and the limiter is what bounds it. Confirm is limited for the
   ordinary reason: it takes a single-use token and must not be brute-forced. */
router.patch ('/me/email',            authRateLimit, authenticate, validate(emailChangeSchema), auth.requestEmailChange)
router.delete('/me/email',            authRateLimit, authenticate, auth.cancelEmailChange)
router.post  ('/confirm-email-change', authRateLimit, validate(confirmEmailChangeSchema), auth.confirmEmailChange)
router.post  ('/resend-verification', authRateLimit, authenticate, auth.resendVerification)
router.get   ('/sessions',            authenticate, auth.listSessions)
router.delete('/sessions/:id',        authenticate, auth.revokeSession)
router.post  ('/deactivate',          authRateLimit, authenticate, validate(reauthSchema), auth.deactivateAccount)
router.delete('/account',             authRateLimit, authenticate, validate(reauthSchema), auth.deleteAccount)

export default router
