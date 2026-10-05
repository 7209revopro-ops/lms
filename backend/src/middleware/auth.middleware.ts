import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '@/utils/jwt.ts'
import { sendError } from '@/utils/response.ts'
import { ACCESS_COOKIE, ADMIN_ACCESS_COOKIE, IMPERSONATION_COOKIE } from '@/utils/authCookies.ts'
import { logger } from '@/utils/logger.ts'
import { toStudentProgram } from '@/utils/programVocabulary.ts'
import type { UserRole, ProgramType } from '@/types/index.ts'

/* ─────────────────────────────────────────────────────
   Account state — checked on every authenticated request  (P-06)
   ─────────────────────────────────────────────────────
   The access token carries `role`, and these guards used to trust it and never
   look at the account behind it. But revocation only ever touched REFRESH
   tokens: UserService.adminUpdate({isActive:false}), adminDelete(),
   deactivateAccount(), deleteAccount() and changePassword() all call
   revokeAllForUser() and nothing else. So blocking, deleting or demoting
   someone left their current access token fully usable for the rest of its
   lifetime — JWT_ACCESS_EXPIRES_IN, currently 1h, and 7d on any deployment
   that has not taken that change.

   N-04 fixed exactly one guard (assertSameOrganization); routes without a
   tenancy check inherited nothing. This closes it centrally.

   The lookup is not new work: authenticate() and authenticateAdmin() already
   queried the same document for organizationId. It now also selects role and
   isActive, and a missing or disabled record is refused instead of tolerated.
   `role` is taken from the RECORD rather than the token, so a demotion takes
   effect on the next request instead of at token expiry.
───────────────────────────────────────────────────── */
interface AccountState {
  role:            UserRole
  isActive:        boolean
  organizationId?: string
  program?:        ProgramType
  customRoleId?:   string
}

async function loadAccountState(userId: string | undefined): Promise<AccountState | null> {
  if (!userId) return null
  const { Types } = await import('mongoose')
  if (!Types.ObjectId.isValid(userId)) return null

  const { UserModel } = await import('@/models/schema.ts')
  const user = await UserModel.findById(userId)
    .select('role isActive organizationId program customRoleId')
    .lean()
  if (!user) return null

  const u = user as {
    role?: UserRole; isActive?: boolean; organizationId?: unknown
    program?: unknown; customRoleId?: unknown
  }
  return {
    role:           u.role as UserRole,
    /* Absent means true — the schema default, and legacy rows predate the field. */
    isActive:       u.isActive !== false,
    organizationId: u.organizationId ? String(u.organizationId) : undefined,
    program:        (u.program as ProgramType | undefined) ?? undefined,
    /* P-10: only fetched, never acted on here. requirePermission() resolves the
       matrix, and only for accounts that actually carry a custom role — which
       is why this costs nothing for everyone else. */
    customRoleId:   u.customRoleId ? String(u.customRoleId) : undefined,
  }
}

/* ─────────────────────────────────────────────────────
   Impersonation session check  (M-04)
   ─────────────────────────────────────────────────────
   A token carrying `isn` is only as valid as the session row it names. That
   row is what makes impersonation revocable: before this, the JWT *was* the
   session, so "end impersonation" merely meant the browser discarded its copy
   — anyone else holding the token kept full access until it expired.

   Re-read on every request, deliberately. Caching it would reintroduce exactly
   the window revocation exists to close.
───────────────────────────────────────────────────── */
async function applyImpersonation(
  req: Request,
  res: Response,
  payload: { isn?: string; act?: { sub: string; email: string } },
): Promise<boolean> {
  if (!payload.isn) return true          /* an ordinary session */

  const { Types } = await import('mongoose')
  if (!Types.ObjectId.isValid(payload.isn)) {
    sendError(res, 'IMPERSONATION_INVALID', 'This impersonation session is not valid.', 401)
    return false
  }

  const { ImpersonationSessionModel } = await import('@/models/schema.ts')
  const session = await ImpersonationSessionModel.findById(payload.isn)
    .select('revokedAt expiresAt actorId actorEmail').lean()

  if (!session) {
    sendError(res, 'IMPERSONATION_INVALID', 'This impersonation session is not valid.', 401)
    return false
  }
  if (session.revokedAt) {
    sendError(res, 'IMPERSONATION_REVOKED', 'This impersonation session has been ended.', 401)
    return false
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    sendError(res, 'IMPERSONATION_EXPIRED', 'This impersonation session has expired.', 401)
    return false
  }

  /* The actor is recorded on the request but never replaces req.user: every
     authorisation decision must still judge the impersonated account, or
     impersonating a student would grant the admin's own privileges. */
  req.user!.impersonatorId    = String(session.actorId)
  req.user!.impersonatorEmail = session.actorEmail
  req.user!.impersonationId   = String(payload.isn)
  return true
}

/* ─────────────────────────────────────────────────────
   Client-portal impersonation is READ-ONLY
   ─────────────────────────────────────────────────────
   Anything written while impersonating is attributed to the STUDENT: a booking
   they did not make, an assignment they did not submit, an order they did not
   place. None of that is distinguishable from their own activity afterwards,
   which makes support disputes unresolvable. The feature exists to see what
   the student sees, so reads are all it grants.

   Enforced here rather than as a route-level middleware so it cannot be
   forgotten on one of the 260 endpoints.

   Deliberately NOT applied to authenticateAdmin: admin-portal impersonation
   predates this and staff rely on it to act on an account. Only the client
   portal is read-only.
───────────────────────────────────────────────────── */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function denyImpersonatedWrite(req: Request, res: Response): boolean {
  if (!req.user?.impersonationId) return true
  if (READ_METHODS.has(req.method)) return true
  sendError(
    res,
    'IMPERSONATION_READ_ONLY',
    'This impersonation session is read-only. Exit impersonation to make changes.',
    403,
  )
  return false
}

/** Reject a caller whose account is gone or disabled. Returns false when handled. */
function denyIfUnusable(res: Response, account: AccountState | null): boolean {
  if (!account) {
    sendError(res, 'ACCOUNT_GONE', 'This account no longer exists.', 401)
    return false
  }
  if (!account.isActive) {
    sendError(res, 'ACCOUNT_DISABLED', 'This account has been disabled.', 401)
    return false
  }
  return true
}

/* ─────────────────────────────────────────────────────
   authenticate
   ─────────────────────────────────────────────────────
   Reads the access token from the `lms_at` httpOnly
   cookie. Falls back to `Authorization: Bearer` for
   non-browser clients (CLI, mobile). Attaches decoded
   user to req.user on success.

   `lms_imp_at` wins when present: a super admin viewing the client portal as a
   student usually has their OWN student session in the same browser, and both
   cookies are sent on every request. Impersonation is the deliberate,
   short-lived, revocable one, so it takes precedence — and because it lives in
   a separate cookie, exiting restores the real session untouched.
───────────────────────────────────────────────────── */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const impersonationToken = req.cookies?.[IMPERSONATION_COOKIE]
  const cookieToken = req.cookies?.[ACCESS_COOKIE]
  const authHeader  = req.headers['authorization']
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  const token = impersonationToken ?? cookieToken ?? bearerToken

  if (!token) {
    sendError(res, 'MISSING_TOKEN', 'Authentication required', 401)
    return
  }

  try {
    const payload = await verifyAccessToken(token, 'client')

    /* The account, not just the token (P-06) — same query that used to fetch
       only organizationId, now also refusing deleted and disabled accounts. */
    const account = await loadAccountState(payload.sub)
    if (!denyIfUnusable(res, account)) return

    req.user = {
      id:    payload.sub!,
      email: payload.email,
      role:  account!.role,          /* record wins over the token */
    }
    if (account!.organizationId) req.user.organizationId = account!.organizationId
    if (account!.customRoleId) req.user.customRoleId = account!.customRoleId
    if (!(await applyImpersonation(req, res, payload))) return
    if (!denyImpersonatedWrite(req, res)) return
    next()
  } catch (err: any) {
    const isExpired = err?.code === 'ERR_JWT_EXPIRED'
    sendError(
      res,
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      isExpired ? 'Access token expired' : 'Invalid access token',
      401,
    )
  }
}

/* ─────────────────────────────────────────────────────
   authenticateAny
   ─────────────────────────────────────────────────────
   Accepts EITHER the client cookie (`lms_at`) or the admin
   cookie (`lms_admin_at`). Used by endpoints shared between
   the client and admin portals (e.g. support tickets, where
   both the ticket owner and an admin read/reply on the same
   resource).
───────────────────────────────────────────────────── */
export async function authenticateAny(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader  = req.headers['authorization']
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  /* Impersonation first, for the same reason as in authenticate(): while an
     impersonation is live it must win over the super admin's own admin cookie,
     or a shared endpoint (support tickets) would quietly serve the ADMIN's
     records instead of the student's.

     BOTH flavours of impersonation have to outrank that cookie, and they
     arrive by different routes: the client-portal one as its own cookie, the
     admin-portal one as a Bearer. The Bearer used to sit LAST in this chain,
     below the admin cookie — and since the impersonator is by definition still
     signed in, their cookie always won. Admin-portal impersonation was
     therefore ignored on every route mounted here, silently, and the request
     was served as the impersonator.

     It surfaced on /live-classes/:id/host-ticket: an impersonated instructor
     was judged to be the super admin, so they were not "the assigned
     instructor", so the LMS minted an ADMIN observer ticket, so CLT refused it
     with "this class has not started yet" — a host who could not start their
     own room. authenticateAdmin already ordered these correctly
     (`bearerToken ?? cookieToken`); this now matches it. */
  const token = req.cookies?.[IMPERSONATION_COOKIE]
             ?? bearerToken
             ?? req.cookies?.[ADMIN_ACCESS_COOKIE]
             ?? req.cookies?.[ACCESS_COOKIE]

  /* Whether THIS request is a client-portal impersonation, as opposed to the
     admin-portal one that arrives as a Bearer. Only the former is read-only,
     so the flag is taken from where the token came from rather than from the
     `isn` claim, which both flavours carry. */
  const viaImpersonationCookie =
    token !== undefined && token === req.cookies?.[IMPERSONATION_COOKIE]

  if (!token) {
    sendError(res, 'MISSING_TOKEN', 'Authentication required', 401)
    return
  }

  try {
    const payload = await verifyAccessToken(token)

    /* Same account check as the other two guards (P-06). This also populates
       organizationId, which authenticateAny never did — the gap that let a
       neighbouring academy's admin read identity documents (N-07) and that
       every route mounted here had to work around by hand. */
    const account = await loadAccountState(payload.sub)
    if (!denyIfUnusable(res, account)) return

    req.user = { id: payload.sub!, email: payload.email, role: account!.role }
    if (account!.organizationId) req.user.organizationId = account!.organizationId
    if (account!.program)        req.user.program        = account!.program
    if (account!.customRoleId) req.user.customRoleId = account!.customRoleId
    if (!(await applyImpersonation(req, res, payload))) return
    if (viaImpersonationCookie && !denyImpersonatedWrite(req, res)) return
    next()
  } catch (err: any) {
    const isExpired = err?.code === 'ERR_JWT_EXPIRED'
    sendError(
      res,
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      isExpired ? 'Access token expired' : 'Invalid access token',
      401,
    )
  }
}

/* ─────────────────────────────────────────────────────
   requirePermission(resource, action)  —  P-10
   ─────────────────────────────────────────────────────
   The Roles & Permissions screen wrote `customRoleId` and a full permission
   matrix to the database, and NOTHING read either. Every access decision came
   from `req.user.role` alone, so building a "Read-only Support" role, ticking
   only `read`, and assigning it changed precisely nothing. That is worse than
   having no such screen: it invites someone to rely on a control that does not
   exist.

   TWO RULES, and the first is the security-critical one:

   1. A custom role can only ever NARROW. It is applied AFTER requireRole, so
      the base role still gates the route and this can only take away. If it
      REPLACED the base check, `PATCH /admin/users/:id/assign-role` would
      become a privilege-escalation primitive — hand a student the "Super
      Admin" custom role and they would inherit it. Intersection makes that
      impossible: the student still fails requireRole first.

   2. An account with NO custom role is untouched. Almost nobody has one
      (0 of 79 accounts when this shipped), so this is a no-op in practice and
      starts working the moment a role is actually assigned — which is the
      behaviour the screen always implied.

   super_admin bypasses, matching every other guard in this codebase.

   PERMISSIONS_MODE=report logs what WOULD be denied without denying it, so the
   blast radius of assigning roles can be measured on real traffic before
   anyone is locked out. Default is enforce, which is safe precisely because
   rule 2 makes it inert until a role is assigned.
───────────────────────────────────────────────────── */
export type PermissionAction =
  'create' | 'read' | 'update' | 'delete' | 'list' | 'list_basic' | 'impersonate'

const permissionsMode = (): 'enforce' | 'report' | 'off' => {
  const raw = process.env['PERMISSIONS_MODE']
  return raw === 'report' || raw === 'off' ? raw : 'enforce'
}

export function requirePermission(resource: string, action: PermissionAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) { sendError(res, 'UNAUTHORIZED', 'Authentication required', 401); return }
      if (permissionsMode() === 'off')          { next(); return }
      if (req.user.role === 'super_admin')      { next(); return }
      if (!req.user.customRoleId)               { next(); return }   /* rule 2 */

      const { RoleModel } = await import('@/models/schema.ts')
      const role = await RoleModel.findById(req.user.customRoleId).select('name permissions').lean()

      /* A dangling customRoleId (role deleted mid-session) must not silently
         grant everything. RolesController.delete unsets the field on every
         holder, so this is the torn-write case, and denying is the safe read. */
      if (!role) {
        sendError(res, 'ROLE_NOT_FOUND', 'Your assigned role no longer exists. Contact an administrator.', 403)
        return
      }

      const entry = (role as { permissions?: { resource: string }[] }).permissions
        ?.find(p => p.resource === resource) as Record<string, unknown> | undefined
      const allowed = entry?.[action] === true

      if (allowed) { next(); return }

      if (permissionsMode() === 'report') {
        logger.warn(
          { userId: req.user.id, role: (role as { name?: string }).name, resource, action },
          'PERMISSIONS_MODE=report — this request WOULD be denied under enforcement',
        )
        next(); return
      }

      sendError(
        res, 'PERMISSION_DENIED',
        `Your role does not permit ${action} on ${resource}.`, 403,
      )
    } catch (err) { next(err) }
  }
}

/* ─────────────────────────────────────────────────────
   requireRole(...roles)
   ─────────────────────────────────────────────────────
   Authorization guard — must come AFTER authenticate.
───────────────────────────────────────────────────── */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', 401)
      return
    }
    if (!roles.includes(req.user.role)) {
      sendError(
        res,
        'FORBIDDEN',
        `Access restricted to: ${roles.join(', ')}`,
        403,
      )
      return
    }
    next()
  }
}

/* ─── Role hierarchy (highest to lowest) ───────────────
   super_admin > admin > sub_admin / support > instructor > student
──────────────────────────────────────────────────── */
export const requireSuperAdmin = requireRole('super_admin')

/** Any admin-panel admin — super_admin or admin (full platform management) */
export const requireAdmin      = requireRole('super_admin', 'admin')

/** Category-scoped admins + above (sub_admin replaces legacy *_admin roles) */
export const requireAnyAdmin   = requireRole('super_admin', 'admin', 'sub_admin', 'support')

/** Teaching staff + above */
export const requireInstructor = requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor')

/* Roles that may AUTHOR a course (B-07).
   ─────────────────────────────────────────────────────────────────────────
   POST /admin/courses carried no role gate at all, so every role the admin
   router admits could create one — including `support`, the lowest-privilege
   staff role. Measured, not inferred: a support account created a course with
   status 'published' and it appeared on the PUBLIC catalogue to an anonymous
   visitor, reachable by slug. It could then neither edit nor delete it,
   because assertCourseEditable refuses support — so a help-desk account could
   publish to the marketing site and be unable to take it back down.

   This list is deliberately the same set assertCourseEditable can authorise:
   you may only create a course you could afterwards manage. If sub_admin is
   meant to author courses, the fix is to add it to assertCourseEditable — one
   line in section.service.ts — AND here, rather than to reopen creation to a
   role that cannot maintain what it creates. */
export const requireCourseAuthor = requireRole(
  'super_admin', 'admin', 'instructor',
)

/** Any authenticated user */
export const requireStudent    = requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor', 'student')

/** Require caller's organization matches the given org slug */
export function requireOrgAccess(slug: import('@/types/index.ts').OrgSlug) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { sendError(res, 'UNAUTHORIZED', 'Authentication required', 401); return }
    if (req.user.role === 'super_admin') { next(); return }

    const { OrganizationModel } = await import('@/models/schema.ts')
    const org = await OrganizationModel.findOne({ slug }).select('_id').lean()
    if (!org) { sendError(res, 'NOT_FOUND', 'Organization not found', 404); return }

    if (req.user.organizationId !== org._id.toString()) {
      sendError(res, 'FORBIDDEN', 'Access restricted to this organization', 403); return
    }
    next()
  }
}

/** Require sub_admin's program matches one of the given programs */
export function requireProgram(...programs: import('@/types/index.ts').ProgramType[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { sendError(res, 'UNAUTHORIZED', 'Authentication required', 401); return }
    if (req.user.role === 'super_admin' || req.user.role === 'admin') { next(); return }
    if (!req.user.program || !programs.includes(req.user.program)) {
      sendError(res, 'FORBIDDEN', `Access restricted to programs: ${programs.join(', ')}`, 403); return
    }
    next()
  }
}

/* ─────────────────────────────────────────────────────
   authenticateAdmin
   ─────────────────────────────────────────────────────
   Same as authenticate but reads from the admin-portal
   cookie `lms_admin_at` so admin and client sessions are
   fully independent on the same browser.
───────────────────────────────────────────────────── */
export async function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieToken = req.cookies?.[ADMIN_ACCESS_COOKIE]
  const authHeader  = req.headers['authorization']
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  // Bearer takes priority: an explicit Authorization header (used for impersonation)
  // overrides the session cookie so the caller identity is whoever the token says.
  const token = bearerToken ?? cookieToken

  if (!token) {
    sendError(res, 'MISSING_TOKEN', 'Authentication required', 401)
    return
  }

  try {
    const payload = await verifyAccessToken(token, 'admin')

    /* The account, not just the token (P-06). Applies to super_admin too —
       a deleted or disabled super_admin token was previously never checked at
       all, because the org lookup was skipped for that role. */
    const account = await loadAccountState(payload.sub)
    if (!denyIfUnusable(res, account)) return

    req.user = {
      id:    payload.sub!,
      email: payload.email,
      role:  account!.role,          /* record wins over the token */
    }

    if (req.user.role !== 'super_admin') {
      if (account!.organizationId) req.user.organizationId = account!.organizationId
      if (account!.program)        req.user.program        = account!.program
    } else {
      /* super_admin selects the active org via X-Organization-Id.
         Validated as an ObjectId before it is trusted (B-05): it flows into
         Mongoose queries downstream, where a malformed value throws a
         CastError and surfaces as a 500 rather than a 400. A header that is
         not an id is refused outright instead of being ignored, because
         silently falling back to "all academies" is the opposite of what a
         caller narrowing their scope intended. */
      const orgHeader = req.headers['x-organization-id']
      if (orgHeader !== undefined) {
        const raw = Array.isArray(orgHeader) ? orgHeader[0] : orgHeader
        if (typeof raw === 'string' && raw.trim() !== '') {
          const { Types } = await import('mongoose')
          if (!Types.ObjectId.isValid(raw.trim())) {
            sendError(res, 'INVALID_ORGANIZATION', 'X-Organization-Id is not a valid organization id.', 400)
            return
          }
          req.user.organizationId = raw.trim()
        }
      }
    }

    if (account!.customRoleId) req.user.customRoleId = account!.customRoleId
    if (!(await applyImpersonation(req, res, payload))) return
    next()
  } catch (err: any) {
    const isExpired = err?.code === 'ERR_JWT_EXPIRED'
    sendError(
      res,
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      isExpired ? 'Access token expired' : 'Invalid access token',
      401,
    )
  }
}

/* ─────────────────────────────────────────────────────
   optionalAuthenticate
   ─────────────────────────────────────────────────────
   Like authenticate but never rejects the request.
   Sets req.user when a valid token is present;
   leaves req.user undefined otherwise.
   Use on public endpoints that want to personalise
   their response when the caller happens to be logged in.
───────────────────────────────────────────────────── */
/* The caller's OWN account, which no department owns: their notification
   preferences, their academy's name and currency (the top bar of every page)
   and their own calendar. A sub_admin with no department may still use these —
   refusing them protects no department's data and only breaks the page around
   the "no department" notice. Exact method + path, nothing broader. */
const OWN_ACCOUNT_ROUTES = new Set([
  'PATCH /api/v1/admin/auth/me/email-preferences',
  'GET /api/v1/admin/my-organization',
  'GET /api/v1/admin/availability/me',
  'PUT /api/v1/admin/availability/me',
])

export async function injectCategoryScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { next(); return }
  if (req.user.role === 'sub_admin') {
    // sub_admin program → categoryScope
    const scope = toStudentProgram(req.user.program)
    /* FAIL CLOSED (plan.md §10, rule R2). A sub_admin is a department head;
       one with no department used to get no categoryScope, and every
       `if (scope)` downstream read that as "unscoped" — the whole academy, all
       four departments. Refused here instead, before any read or write runs:
       a missing field must never widen access. */
    if (!scope) {
      if (OWN_ACCOUNT_ROUTES.has(`${req.method} ${(req.baseUrl + req.path).replace(/[/]+$/, '')}`)) { next(); return }
      res.status(403).json({
        success: false,
        error: {
          code:    'NO_DEPARTMENT',
          message: 'Your account is not assigned to a department yet. Ask an administrator to set one.',
        },
      })
      return
    }
    req.user.categoryScope = scope
  } else if (req.user.role === 'instructor') {
    const { UserModel } = await import('@/models/schema.ts')
    const user = await UserModel.findById(req.user.id).select('category').lean()
    const cat  = (user as any)?.category as string | undefined
    if (cat === '4x-trading' || cat === 'digital-marketing' || cat === 'ai' || cat === 'jura') req.user.categoryScope = cat
  }
  next()
}

/* ─────────────────────────────────────────────────────
   requireEnrollmentApproval
   ─────────────────────────────────────────────────────
   For student-facing endpoints that require the student
   to have been approved by an admin (when they signed up
   with a program category).

   Non-students always pass through.
   Students with no category always pass through.
   Students with a category must have enrollmentStatus === 'approved'.
───────────────────────────────────────────────────── */
export async function requireEnrollmentApproval(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user || req.user.role !== 'student') { next(); return }

  const { UserModel } = await import('@/models/schema.ts')
  const user = await UserModel.findById(req.user.id)
    .select('category categories enrollmentStatus enrollmentCancellationReason rejectionReason').lean()

  if (!user || !user.enrollmentStatus) { next(); return }

  if (user.enrollmentStatus === 'pending') {
    res.status(403).json({
      success: false,
      error: {
        code:    'PENDING_APPROVAL',
        message: 'Your account is pending admin approval. You can browse courses but cannot access sessions yet.',
      },
    }); return
  }

  if (user.enrollmentStatus === 'rejected' || user.enrollmentStatus === 'cancelled') {
    res.status(403).json({
      success: false,
      error: {
        code:    'ACCESS_REJECTED',
        message: 'Your access request was not approved.',
        reason:  (user as any).rejectionReason ?? (user as any).enrollmentCancellationReason ?? '',
      },
    }); return
  }

  next()
}

/* ─────────────────────────────────────────────────────
   requireCheckoutEligibility  (B-03)
   ─────────────────────────────────────────────────────
   Five checkout routes, one of which behaved differently from the other four.
   `POST /checkout/` (Stripe) carried requireEnrollmentApproval; Razorpay,
   Tabby, Abzer and Tamara did not. That mattered because paying is a
   DESIGNED path to approval — order.service's _autoApproveViaPayment()
   promotes a viewer *or a rejected user*, clears rejectionReason, and records
   the approval as 'Paid Enrollment'. So the four unguarded routes matched the
   intent and Stripe was the outlier: a pending applicant was refused by the
   one gateway on the flow built to approve them.

   All five now share this guard, so the behaviour is the same whichever
   gateway an academy uses. It permits `pending` deliberately — that is the
   pay-to-enrol flow — and leaves `rejected`/`cancelled` alone by default,
   which is exactly what the four majority routes already did.

   CHECKOUT_BLOCK_REJECTED=true makes a rejection final: an applicant an admin
   explicitly turned away can no longer buy their way back in. That is a
   product decision rather than a bug, so it ships off — off is today's
   behaviour on four of the five routes, and turning it on changes nothing for
   pending or approved users. Blocking with isActive:false is separate and
   still absolute; it stops login outright.
───────────────────────────────────────────────────── */
export async function requireCheckoutEligibility(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user || req.user.role !== 'student') { next(); return }
  if (process.env['CHECKOUT_BLOCK_REJECTED'] !== 'true') { next(); return }

  const { UserModel } = await import('@/models/schema.ts')
  const user = await UserModel.findById(req.user.id)
    .select('enrollmentStatus rejectionReason enrollmentCancellationReason').lean()
  if (!user) { next(); return }

  const status = (user as { enrollmentStatus?: string }).enrollmentStatus
  if (status === 'rejected' || status === 'cancelled') {
    res.status(403).json({
      success: false,
      error: {
        code:    'ACCESS_REJECTED',
        message: 'Your access request was not approved, so this purchase cannot continue.',
        reason:  (user as any).rejectionReason ?? (user as any).enrollmentCancellationReason ?? '',
      },
    }); return
  }
  next()
}

/* Read-only validity check for an impersonation token on a route that must
   never reject (optionalAuthenticate). Mirrors the checks applyImpersonation()
   makes for strict routes, but returns a boolean instead of sending an error:
   a revoked or expired impersonation simply degrades to anonymous here. A token
   with no `isn` is an ordinary session and always passes. */
async function impersonationStillValid(payload: { isn?: string }): Promise<boolean> {
  if (!payload.isn) return true
  const { Types } = await import('mongoose')
  if (!Types.ObjectId.isValid(payload.isn)) return false
  const { ImpersonationSessionModel } = await import('@/models/schema.ts')
  const session = await ImpersonationSessionModel.findById(payload.isn)
    .select('revokedAt expiresAt').lean() as { revokedAt?: Date; expiresAt?: Date } | null
  if (!session || session.revokedAt) return false
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) return false
  return true
}

export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  /* `lms_imp_at` wins, exactly as in authenticate(): a super admin viewing the
     client portal as a student carries only the impersonation cookie on the
     client origin. Reading just lms_at here left every optional route — the
     course catalogue, course detail, per-lesson content gating — treating an
     impersonated session as anonymous, so an impersonated Bangalore student saw
     Dubai's courses too (the catalogue only scopes to an org when it knows the
     viewer's org). */
  const impersonationToken = req.cookies?.[IMPERSONATION_COOKIE]
  const cookieToken = req.cookies?.[ACCESS_COOKIE]
  const authHeader  = req.headers['authorization']
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token       = impersonationToken ?? cookieToken ?? bearerToken

  if (token) {
    try {
      const payload = await verifyAccessToken(token, 'client')
      /* A deleted or disabled account, or a revoked/expired impersonation, is
         simply anonymous here — this guard never rejects, it only personalises. */
      const account = await loadAccountState(payload.sub)
      if (account?.isActive && await impersonationStillValid(payload)) {
        req.user = {
          id:    payload.sub!,
          email: payload.email,
          role:  account.role,
        }
        if (account.organizationId) req.user.organizationId = account.organizationId
        /* Record the impersonation so read-only personalisation (e.g. the
           forensic watermark) still attributes to the real operator. */
        if (payload.isn) {
          req.user.impersonationId = String(payload.isn)
          if (payload.act) {
            req.user.impersonatorId    = payload.act.sub
            req.user.impersonatorEmail = payload.act.email
          }
        }
      }
    } catch {
      /* expired / invalid — treat as unauthenticated */
    }
  }

  next()
}
