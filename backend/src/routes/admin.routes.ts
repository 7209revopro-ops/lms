import { Router } from 'express'
import { resolveClassEntitlement } from '@/services/classEntitlement.service.ts'
/* Type-only, and aliased: every handler below binds its own `Types` value
   via `await import('mongoose')`, which would shadow the namespace. */
import type { Types as MongoTypes } from 'mongoose'
import { z } from 'zod'
import { AdminController } from '@/controllers/admin.controller.ts'
import { AuthController } from '@/controllers/auth.controller.ts'
import { LiveClassController } from '@/controllers/liveClass.controller.ts'
import { RolesController } from '@/controllers/roles.controller.ts'
import { authenticateAdmin, requireRole, requireAdmin, requireAnyAdmin, requireInstructor, requireCourseAuthor, injectCategoryScope, requirePermission } from '@/middleware/auth.middleware.ts'
import { issueClassHandoff } from '@/controllers/classHandoff.controller.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { env } from '@/config/env.ts'
import { authRateLimit, refreshRateLimit, impersonationRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { QuizService } from '@/services/quiz.service.ts'
import { AdminExamService } from '@/services/admin-exam.service.ts'
import { AssignmentService } from '@/services/assignment.service.ts'
import { SectionService } from '@/services/section.service.ts'
import { OrderService } from '@/services/order.service.ts'
import { CouponService } from '@/services/coupon.service.ts'
import {
  requireSameOrgUser, requireImpersonableStudent, requireBorrowedInstructorUnchanged,
  callerMayAccess, instructorOwnsSession, callerOrgForRead,
  servedClassFilter, classServesOrg, andFilter,
} from '@/utils/tenancy.ts'
import { CROSS_ORG_CLASSES_ENABLED } from '@/utils/featureFlags.ts'
import { reserveSeat, releaseSeat, seatStampFrom } from '@/services/seatPool.service.ts'
import { ensureOrgSlugs, orgSlugFor } from '@/utils/orgSlugs.ts'
import { academyClock } from '@/utils/academyClock.ts'
import { documentRef } from '@/utils/documentRef.ts'
import { UserService } from '@/services/user.service.ts'
import { adminListDevices, adminApproveDevice, adminRevokeDevice } from '@/services/device.service.ts'
import { deviceLimitMeta, setDeviceLimitEnabled } from '@/services/settings.service.ts'
import { sendSuccess, buildPaginationMeta, parsePagination } from '@/utils/response.ts'
import { toSafeUser } from '@/models/types.ts'
import { audit } from '@/middleware/audit.middleware.ts'
import type { Request, Response, NextFunction } from 'express'
import { SCHEDULE_LINK } from '@/utils/clientLinks.ts'

const router     = Router()
const ctrl       = new AdminController()
const live       = new LiveClassController()
const authCtrl   = new AuthController()
const roleCtrl   = new RolesController()
const quizSvc    = new QuizService()
const examSvc    = new AdminExamService()
const assignSvc  = new AssignmentService()
const sectionSvc = new SectionService()
const orderSvc   = new OrderService()
const couponSvc  = new CouponService()
const userSvc    = new UserService()

/* ── Admin-portal auth routes (public — no cookie guard) ──────────────
   These use lms_admin_at / lms_admin_rt so the admin session is fully
   independent from the client-portal session (lms_at / lms_rt).
─────────────────────────────────────────────────────────────────────── */
const adminLoginSchema = z.object({
  email:    z.string().trim().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
})

/* What the portal hands over: one opaque single-use token, nothing else. */
const adminSsoLoginSchema = z.object({
  token: z.string().min(16, 'Invalid sign-in token'),
})

/* Second login step for admin accounts with 2FA enabled — the challenge
   handed back by /auth/login plus the 6-digit authenticator code. */
const adminLoginTwoFactorSchema = z.object({
  challengeToken: z.string().min(20, 'Challenge token is required'),
  code:           z.string().trim().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be 6 digits'),
})

/* Forgot / reset password for the admin portal. forgot-password mails a link
   into the ADMIN app (staff accounts only, enumeration-safe); reset-password
   shares the client controller since the token is portal-agnostic. */
const adminForgotSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
})
const adminResetSchema = z.object({
  token:    z.string().min(32),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

router.post('/auth/login',   authRateLimit, validate(adminLoginSchema), authCtrl.adminLogin)
/* Arriving from the Root portal. Rate limited like every other sign-in here:
   the token is single-use and short-lived, but guessing at one should cost the
   same as guessing at a password. */
router.post('/auth/sso-login', authRateLimit, validate(adminSsoLoginSchema), authCtrl.adminSsoLogin)
router.post('/auth/login/2fa', authRateLimit, validate(adminLoginTwoFactorSchema), authCtrl.adminLoginTwoFactor)
router.post('/auth/forgot-password', authRateLimit, validate(adminForgotSchema), authCtrl.adminForgotPassword)
router.post('/auth/reset-password',  authRateLimit, validate(adminResetSchema),  authCtrl.resetPassword)
router.post('/auth/refresh', refreshRateLimit, authCtrl.adminRefresh)
router.post('/auth/logout',  authRateLimit, authCtrl.adminLogout)
router.get ('/auth/me',      authenticateAdmin, authCtrl.me)

/* Admin routes are open to admins and instructors. Per-resource
   ownership checks inside the controllers reject instructors who
   try to mutate courses they don't own. */
router.use(authenticateAdmin, requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor'), injectCategoryScope)

/* ─── Own email-notification preferences ───────────────
   Self-service for every admin-side role: the router.use above already proves
   an admin-portal session and a staff role, and a user may only ever change
   their OWN preferences (the id comes from the session, never the body).
   Partial by design — send just the keys you want to change. */
const emailPrefsSchema = z.object({
  masterEnabled: z.boolean().optional(),
  categories: z.object({
    enrollmentRequest:   z.boolean().optional(),
    deviceApproval:      z.boolean().optional(),
    classScheduled:      z.boolean().optional(),
    classReminder:       z.boolean().optional(),
    assignmentSubmitted: z.boolean().optional(),
  }).strict().optional(),
}).strict()

router.patch('/auth/me/email-preferences', validate(emailPrefsSchema), authCtrl.updateMyEmailPrefs)

/* ─── Schemas ─────────────────────────────────────── */
const courseCreateSchema = z.object({
  title:        z.string().min(3).max(255).trim(),
  slug:         z.string().min(2).max(255).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  description:  z.string().min(20).optional(),
  thumbnailUrl: z.string().url().or(z.literal('')).optional(),
  previewUrl:   z.string().url().or(z.literal('')).optional(),
  price:        z.coerce.number().min(0),
  /* Per-currency overrides (B-01). Blank means "use the conversion rate",
     which is what every course did before these were storable. */
  priceAED:     z.coerce.number().min(0).optional(),
  priceINR:     z.coerce.number().min(0).optional(),
  isFree:       z.boolean(),
  status:       z.enum(['draft', 'published', 'archived']),
  level:        z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  language:     z.string().min(1).default('English'),
  tags:         z.union([z.string(), z.array(z.string())]).optional(),
  categoryId:   z.string().optional(),
  instructorId: z.string().optional(),
  program:      z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).optional(),
  /* Which academy the course belongs to. Super admins only — see the resolver
     in createCourse; everyone else's is their own. */
  organizationId: z.string().optional(),
})

const courseUpdateSchema = courseCreateSchema.partial().extend({
  /* On update, level may be cleared with empty string */
  level: z.enum(['beginner', 'intermediate', 'advanced', '']).optional(),
})

const categoryCreateSchema = z.object({
  name:        z.string().min(2).max(100).trim(),
  slug:        z.string().min(2).max(120).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).optional(),
  icon:        z.string().max(40).optional(),
})

const categoryUpdateSchema = categoryCreateSchema.partial()

const usersQuerySchema = z.object({
  page:              z.coerce.number().int().min(1).default(1),
  per_page:          z.coerce.number().int().min(1).max(500).default(20),
  role:              z.enum(['student', 'instructor', 'admin', 'sub_admin', 'support', 'super_admin']).optional(),
  search:            z.string().trim().optional(),
  category:          z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).optional(),
  status:            z.enum(['active', 'inactive']).optional(),
  exclude_students:  z.coerce.boolean().optional(),
  enrollmentStatus:  z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
})

/* The rate the CHECKOUT actually uses, handed out so the admin panel shows
   the number a student will really be charged rather than re-deriving it and
   drifting. Same env values order.service.ts converts with. */
const rateFor = (currency: string): number =>
  currency === 'AED' ? env.UAE_EXCHANGE_RATE : env.INR_EXCHANGE_RATE

/* ─── Organizations (super_admin only) ─────────────
   Only a super admin sees every academy, because only they can switch
   between them. Scoped admins get their own via /my-organization below. */
router.get('/organizations', requireRole('super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { OrganizationModel } = await import('@/models/schema.ts')
    const orgs = await OrganizationModel.find().select('name slug currency').lean()
    sendSuccess(res, orgs.map(o => ({
      id: (o._id as any).toString(), name: o.name, slug: o.slug,
      currency: o.currency, exchangeRate: rateFor(o.currency),
    })))
  } catch (err) { next(err) }
})

/* ─── The caller's own academy ─────────────────────
   Every admin needs to know which currency their panel works in, but
   /organizations above is super_admin-only — so a Bangalore admin had no way
   to learn they are an INR academy, and the UI fell back to showing the USD
   base price to everyone. This returns exactly one org: the caller's.

   No org on the account (super admins have none) returns null rather than an
   error, and the panel falls back to the base currency. */
/* requireInstructor (= any admin OR instructor): instructors need their academy
   too — the panel derives its display timezone (Dubai vs Bangalore) and
   currency from this. Response is the caller's own org only; nothing scoped. */
router.get('/my-organization', requireInstructor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user?.organizationId
    if (!orgId) { sendSuccess(res, null); return }
    const { OrganizationModel } = await import('@/models/schema.ts')
    const org = await OrganizationModel.findById(orgId).select('name slug currency').lean()
    if (!org) { sendSuccess(res, null); return }
    sendSuccess(res, {
      id: (org._id as any).toString(), name: org.name, slug: org.slug,
      currency: org.currency, exchangeRate: rateFor(org.currency),
    })
  } catch (err) { next(err) }
})

/* ─── Dashboard ──────────────────────────────────── */
router.get('/stats',                       requireAnyAdmin, ctrl.stats)
router.get('/analytics/enrollments',       requireAnyAdmin, ctrl.enrollmentsTimeseries)
router.get('/analytics/top-courses',       requireAnyAdmin, ctrl.topCourses)
router.get('/analytics/completion',        requireAnyAdmin, ctrl.completionStats)

/* ─── Bulk course operations (8.12) ──────────────── */
const bulkSchema = z.object({
  ids:    z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['publish', 'archive', 'delete']),
})
router.post(
  '/courses/bulk',
  requireAdmin,
  validate(bulkSchema),
  audit('bulk.publish', 'Course', undefined, r => ({ action: r.body.action, ids: r.body.ids })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, action } = req.body as z.infer<typeof bulkSchema>
      const CourseModel = (await import('@/models/schema.ts')).CourseModel
      const { Types } = await import('mongoose')
      const objectIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id))
      if (objectIds.length === 0) { sendSuccess(res, { affected: 0 }); return }

      /* Tenancy — a bulk action must never reach another org's courses.
         super_admin is unrestricted; courses that predate organizationId
         stay in scope so legacy data is still manageable. */
      const filter: Record<string, unknown> = { _id: { $in: objectIds } }
      const orgId = req.user!.organizationId
      if (req.user!.role !== 'super_admin' && orgId && Types.ObjectId.isValid(orgId)) {
        filter['$or'] = [
          { organizationId: new Types.ObjectId(orgId) },
          { organizationId: null },
          { organizationId: { $exists: false } },
        ]
      }

      let affected: number
      if (action === 'delete') {
        const result = await CourseModel.deleteMany(filter)
        affected = result.deletedCount ?? 0
      } else {
        const status = action === 'publish' ? 'published' : 'archived'
        const result = await CourseModel.updateMany(filter, { $set: { status } })
        affected = result.matchedCount ?? 0
      }
      sendSuccess(res, { affected })
    } catch (err) { next(err) }
  },
)

/* ─── Courses ─────────────────────────────────────── */
router.get   ('/courses', requirePermission('courses','list'),        ctrl.listCourses)
router.get   ('/courses/:id',    ctrl.getCourse)
router.post  ('/courses', requirePermission('courses','create'),        requireCourseAuthor, validate(courseCreateSchema), audit('course.create', 'Course'), ctrl.createCourse)
router.patch ('/courses/:id', requirePermission('courses','update'),    validate(courseUpdateSchema), audit('course.update', 'Course', r => String(r.params['id'] ?? '')), ctrl.updateCourse)
router.delete('/courses/:id', requirePermission('courses','delete'),    audit('course.delete', 'Course', r => String(r.params['id'] ?? '')), ctrl.deleteCourse)

/* ─── Categories (admin-only writes) ──────────────── */
router.get   ('/categories',     ctrl.listCategories)
router.post  ('/categories', requirePermission('categories','create'),     requireAdmin, validate(categoryCreateSchema), audit('category.create', 'Category'), ctrl.createCategory)
router.patch ('/categories/:id', requirePermission('categories','update'), requireAdmin, validate(categoryUpdateSchema), audit('category.update', 'Category', r => String(r.params['id'] ?? '')), ctrl.updateCategory)
router.delete('/categories/:id', requirePermission('categories','delete'), requireAdmin, audit('category.delete', 'Category', r => String(r.params['id'] ?? '')), ctrl.deleteCategory)

/* ─── Users (admin-only) ──────────────────────────── */
const userUpdateSchema = z.object({
  role:       z.enum(['student', 'instructor', 'admin', 'sub_admin', 'support', 'super_admin']).optional(),
  isActive:   z.boolean().optional(),
  isVerified: z.boolean().optional(),
  name:       z.string().min(2).max(100).trim().optional(),
  email:      z.string().trim().email().optional(),
  category:   z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).nullable().optional(),
  categories: z.array(z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura'])).optional(),
  /* A SUB-ADMIN'S PROGRAMME. userCreateSchema has always carried this; this
     one did not, and validate() strips what a schema does not name — so the
     Edit User modal, which requires a programme before it will let you save a
     sub_admin, sent `program` and had it silently dropped. The user came back
     with role sub_admin and no programme, and injectCategoryScope derives
     categoryScope from exactly this field: no programme, no scope. Every
     programme-scoped guard then reads undefined, including the impersonation
     one, which now fails closed — so promoting someone to sub_admin through
     the modal produced an account that could open nobody. */
  program:    z.enum(['ai', 'digital_marketing', 'forex', 'jura']).optional(),
  avatarUrl:  z.string().url().or(z.literal('')).optional(),
  headline:   z.string().max(255).optional(),
  bio:        z.string().max(2000).optional(),
  /* Lend this instructor to the other academy. Who may SET it is enforced in
     the route, not here — a schema cannot see the caller's role. */
  sharedAcrossOrgs: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Provide at least one field' })

const userCreateSchema = z.object({
  name:       z.string().min(2).max(100).trim(),
  /* .trim() BEFORE .email(): admins paste addresses out of spreadsheets and
     chat messages, and those arrive with whitespace attached. Without the
     trim the address is rejected as "Invalid email", which points at the
     address rather than at the space that is actually wrong. The schema
     stores it lowercased and trimmed anyway, so accepting it here only makes
     the form agree with the database. */
  email:      z.string().trim().email(),
  password:   z.string().min(8, 'Password must be at least 8 characters'),
  role:       z.enum(['student', 'instructor', 'admin', 'sub_admin', 'support', 'super_admin']).default('instructor'),
  bio:        z.string().max(2000).optional(),
  headline:   z.string().max(255).optional(),
  category:   z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).optional(),
  categories: z.array(z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura'])).optional(),
  avatarUrl:  z.string().url().or(z.literal('')).optional(),
  program:    z.enum(['ai', 'digital_marketing', 'forex', 'jura']).optional(),
  /* Lend this instructor to the other academy — see userUpdateSchema. */
  sharedAcrossOrgs: z.boolean().optional(),
  courses:    z.array(z.object({
    courseId:       z.string().min(1),
    blockedLessons: z.array(z.string()).default([]),
  })).optional(),
  /* Which academy the new account belongs to. Only a super_admin may set it;
     for everyone else it is their own, and naming someone else's is refused
     rather than ignored. Resolved in the create handler below. */
  organizationId: z.string().optional(),
})

router.get  ('/users', requirePermission('users','list'),
  validate(usersQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user!.role === 'instructor') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } })
      return
    }
    next()
  },
  ctrl.listUsers)
router.post ('/users', requirePermission('users','create'),          validate(userCreateSchema), audit('user.create', 'User'),
  async (req, res, next) => {
    const role       = req.user!.role
    const targetRole = (req.body as { role?: string }).role ?? 'instructor'
    if (role === 'instructor') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Instructors cannot create accounts.' } })
      return
    }
    if (role === 'sub_admin' && targetRole !== 'instructor') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only create instructor accounts.' } })
      return
    }
    if (role === 'support' && !['student', 'instructor'].includes(targetRole)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Support staff can only create student or instructor accounts.' } })
      return
    }
    if ((role === 'admin' || role === 'sub_admin' || role === 'support') && targetRole === 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only super admins can create super admin accounts.' } })
      return
    }
    /* A programme-scoped creator stamps their own programme onto the account
       they create, so a scoped admin cannot mint staff outside their programme.
       Reads the RESOLVED scope rather than the role name: the three legacy
       roles that used to be listed here were only ever sub_admin with the
       programme baked into the role, and injectCategoryScope now derives the
       same value from `program`. */
    if (req.user!.categoryScope) (req.body as any).category = req.user!.categoryScope

    /* Lending an instructor to the other academy is an admin decision.
       REJECTED, not silently dropped: a sub-admin who ticks the box and gets a
       quiet success would believe the instructor is shared when they are not,
       and only find out when the other academy cannot see them. */
    const body = req.body as { sharedAcrossOrgs?: boolean; role?: string }
    if (body.sharedAcrossOrgs) {
      if (role !== 'admin' && role !== 'super_admin') {
        res.status(403).json({ success: false, error: {
          code: 'FORBIDDEN',
          message: 'Only an admin or super admin can make an instructor available to both organizations.',
        } }); return
      }
      if ((body.role ?? 'instructor') !== 'instructor') {
        res.status(400).json({ success: false, error: {
          code: 'INVALID_SHARED_ROLE',
          message: 'Only instructors can be shared between organizations.',
        } }); return
      }
    }
    next()
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      /* Build DTO without the courses field (handled separately) */
      const { courses, organizationId: bodyOrg, ...userDto } = req.body as z.infer<typeof userCreateSchema>

      /* ── Which academy does this account belong to? ──────────────────────
         It used to be whatever `req.user.organizationId` happened to be, which
         for a super_admin is the org switcher in the topbar — and the
         switcher's default is "All Orgs", which sends no header at all. So
         creating a student from that position produced an account belonging to
         NO academy: a 201, no warning, and a person who never appears in any
         academy's student list again.

         A super_admin now says explicitly which academy, falling back to the
         switcher when one is selected. Anyone else gets their own and may not
         name another — that is a cross-tenant write, so it is refused rather
         than quietly dropped. */
      const isSuper   = req.user!.role === 'super_admin'
      const callerOrg = req.user!.organizationId

      if (!isSuper && bodyOrg && bodyOrg !== callerOrg) {
        res.status(403).json({ success: false, error: {
          code: 'FORBIDDEN', message: 'You can only create accounts in your own academy.',
        } })
        return
      }

      /* `||` not `??`: an unselected picker sends an empty string, which is
         "not chosen", not "chosen as empty" — it should still fall back to
         the switcher rather than skipping past it into the refusal below. */
      const orgId = isSuper ? (bodyOrg || callerOrg) : callerOrg

      /* super_admin is the one role that legitimately belongs to no single
         academy. Everyone else must have one, or they are invisible to every
         scoped list in the product. */
      if (!orgId && userDto.role !== 'super_admin') {
        res.status(400).json({ success: false, error: {
          code: 'ORGANIZATION_REQUIRED', message: 'Select an academy for this account.',
        } })
        return
      }

      if (orgId) {
        const { Types } = await import('mongoose')
        const { OrganizationModel } = await import('@/models/schema.ts')
        if (!Types.ObjectId.isValid(orgId)) {
          res.status(400).json({ success: false, error: {
            code: 'INVALID_ORGANIZATION', message: 'That is not a valid academy id.',
          } })
          return
        }
        if (!(await OrganizationModel.exists({ _id: orgId }))) {
          res.status(404).json({ success: false, error: {
            code: 'ORGANIZATION_NOT_FOUND', message: 'That academy does not exist.',
          } })
          return
        }
      }

      const user = await userSvc.adminCreateUser({
        ...userDto,
        approvedBy:     req.user!.id,
        organizationId: orgId,
      })

      /* Enroll the new student into the requested courses */
      if (courses && courses.length > 0) {
        const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
        const { Types } = await import('mongoose')
        await Promise.all(
          courses.map(async (c: { courseId: string; blockedLessons: string[] }) => {
            try {
              const blockedObjectIds = (c.blockedLessons ?? [])
                .filter((id: string) => Types.ObjectId.isValid(id))
                .map((id: string) => new Types.ObjectId(id))
              const enrollDoc: Record<string, unknown> = {
                userId:         new Types.ObjectId(user.id),
                courseId:       new Types.ObjectId(c.courseId),
                blockedLessons: blockedObjectIds,
                source:         'admin' as const,
              }
              /* The new account's academy, not the caller's — for a super
                 admin creating into Dubai from "All Orgs" those differ. */
              if (orgId && Types.ObjectId.isValid(orgId)) {
                enrollDoc['organizationId'] = new Types.ObjectId(orgId)
              }
              await EnrollmentModel.create(enrollDoc)
              await CourseModel.updateOne(
                { _id: new Types.ObjectId(c.courseId) }, { $inc: { enrolledCount: 1 } },
              )
            } catch (_) { /* skip duplicate enrollments silently */ }
          })
        )
      }

      /* toSafeUser, not the raw document.

         passwordHash is declared `select: false`, which hides it from QUERIES
         -- but this document was just created, so it still carries the hash
         that was written to it, and sending it raw put the bcrypt hash of the
         new account's password in the API response. Every other route that
         returns a user already goes through this allowlist; this one did not.
         The field list is opt-in, so anything added to the schema later stays
         out of responses until somebody decides it belongs there. */
      sendSuccess(res, toSafeUser(user), 'User created', 201)
    } catch (err) { next(err) }
  },
)
router.patch ('/users/:id', requirePermission('users','update'),
  requireAdmin,
  requireSameOrgUser('id'),
  /* requireSameOrgUser lets EITHER academy's admin through for a lent
     instructor. This says what that does not extend to — see the guard. */
  requireBorrowedInstructorUnchanged('id'),
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user!.role === 'admin' && (req.body as any).role === 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only super admins can grant super admin access.' } })
      return
    }
    /* Same rule as on create. This route is already requireAdmin, so a
       sub-admin cannot reach it at all — the check is kept explicit so the
       rule reads the same in both places and survives someone loosening the
       route guard later. */
    const patch = req.body as { sharedAcrossOrgs?: boolean }
    if (patch.sharedAcrossOrgs !== undefined
        && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ success: false, error: {
        code: 'FORBIDDEN',
        message: 'Only an admin or super admin can change cross-organization availability.',
      } }); return
    }
    next()
  },
  validate(userUpdateSchema),
  audit('user.roleChange', 'User', r => String(r.params['id'] ?? '')),
  ctrl.updateUser,
)
router.delete('/users/:id', requirePermission('users','delete'),           requireAdmin, requireSameOrgUser('id'), audit('user.delete', 'User', r => String(r.params['id'] ?? '')), ctrl.deleteUser)

/* POST /admin/users/:id/reset-2fa — clear a user's second factor.
   For the lost-device case. Nothing else in the codebase could write
   twoFactorEnabled, so a user who lost their authenticator had no route back
   short of database surgery (NEW-01). Tenancy-scoped and audited; this hands
   back the ability to sign in with a password alone, so it is a real
   privilege and treated as one. */
router.post('/users/:id/reset-2fa', requireAdmin, requireSameOrgUser('id'),
  audit('user.reset2fa', 'User', r => String(r.params['id'] ?? '')),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { TotpService } = await import('@/services/totp.service.ts')
      await new TotpService().adminReset(String(req.params['id'] ?? ''))
      sendSuccess(res, null, 'Two-factor authentication reset for this user.')
    } catch (err) { next(err) }
  })
router.post  ('/users/:id/impersonate', impersonationRateLimit, requirePermission('users','impersonate'), requireRole('super_admin'), audit('user.impersonate', 'User', r => String(r.params['id'] ?? '')), ctrl.impersonateUser)

/* Client-portal impersonation — separate action from the one above so the
   audit trail distinguishes "acted inside the admin panel as them" from
   "browsed the student app as them".

   OPEN TO ADMINS AND SUB-ADMINS, unlike the admin-panel route. This is the
   half of impersonation that is safe to widen, and the asymmetry is the
   point:

     · the session it creates is READ-ONLY — denyImpersonatedWrite refuses
       every non-GET — so an admin sees what the student sees and cannot act
       as them;
     · it already refuses any target that is not an active student, so it
       cannot be turned on staff;
     · requireImpersonableStudent adds what was missing the moment a
       per-academy role could reach it: the target must be in the caller's own
       academy, and a sub_admin's must be inside its programme.

   The admin-panel route above is not read-only and exists to impersonate
   STAFF, which is why it stays super_admin only. */
router.post  ('/users/:id/impersonate-client', impersonationRateLimit, requirePermission('users','impersonate'), requireRole('super_admin', 'admin', 'sub_admin'), requireImpersonableStudent('id'), audit('user.impersonate.client', 'User', r => String(r.params['id'] ?? '')), ctrl.impersonateClient)

/* ── Impersonation sessions (M-04) ────────────────────────────────────
   Impersonation is a session record now, not a bare token, so it can be
   listed and stopped.

   Three different widths, on purpose:
     · STARTING one — super_admin for the admin panel, plus admin and
       sub_admin for the read-only client view (above).
     · READING the trail — an academy's admins read their academy; everyone
       else reads the rows they are the actor of. It is a supervisory view.
     · STOPPING one — whoever may read it may stop it. A power you can begin
       and not end is a bad shape, and revoking is the only thing that cuts
       off every holder of a token at once.
──────────────────────────────────────────────────────────────────────── */
router.get('/impersonation-sessions', requireAnyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ImpersonationSessionModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { page, per_page } = parsePagination(req.query as Record<string, unknown>)

    /* Scoped like every other admin listing: an org admin sees their own
       academy's sessions, super_admin sees all.

       A SUB-ADMIN SEES ONLY ITS OWN. It can start a session now, so it has to
       be able to find and end one — a power you can begin and not stop is a
       bad shape, and the whole point of the session row is that revoking it
       cuts every holder off at once. But reading the trail is a supervisory
       act: "who has been inside which account" is for the people who
       supervise the academy, not for everyone who can open a support view. So
       it gets exactly the rows it is answerable for. */
    const filter: Record<string, unknown> = {}
    const orgId = req.user!.organizationId
    if (req.user!.role !== 'super_admin' && orgId && Types.ObjectId.isValid(orgId)) {
      filter['organizationId'] = new Types.ObjectId(orgId)
    }
    /* Narrowed to your own rows for everyone below a full admin — and ALSO
       for a full admin whose org filter did not apply, because an admin with
       no organizationId would otherwise read every impersonation in both
       academies, with actor and target emails, ip and user agent. An unscoped
       reader is the one case a supervisory listing must not have. */
    const belowFullAdmin = req.user!.role === 'sub_admin' || req.user!.role === 'support' || req.user!.role === 'instructor'
    const unscoped       = filter['organizationId'] === undefined
    if (req.user!.role !== 'super_admin' && (belowFullAdmin || unscoped)) {
      filter['actorId'] = new Types.ObjectId(req.user!.id)
    }
    if (req.query['active'] === 'true') {
      filter['revokedAt'] = { $exists: false }
      filter['expiresAt'] = { $gt: new Date() }
    }

    const [docs, totalCount] = await Promise.all([
      ImpersonationSessionModel.find(filter).sort({ createdAt: -1 })
        .skip((page - 1) * per_page).limit(per_page).lean({ virtuals: true }),
      ImpersonationSessionModel.countDocuments(filter),
    ])
    sendSuccess(res, (docs as any[]).map(d => ({ ...d, id: d.id ?? String(d._id) })),
      undefined, 200, buildPaginationMeta(totalCount, page, per_page))
  } catch (err) { next(err) }
})

/* Ends ONE session. Idempotent — revoking an already-revoked session is not
   an error, because the useful outcome is "it is off", not "I was first". */
router.delete('/impersonation-sessions/:id', requireAnyAdmin,
  audit('user.impersonate.revoke', 'ImpersonationSession', r => String(r.params['id'] ?? '')),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ImpersonationSessionModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const id = String(req.params['id'] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid session id' } }); return
      }
      const existing = await ImpersonationSessionModel
        .findById(id).select('_id actorId organizationId').lean() as
          { _id: unknown; actorId?: unknown; organizationId?: unknown } | null
      if (!existing) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
      }

      /* WHO MAY END ONE. super_admin ends anything, as before. An academy
         admin ends anything in their own academy — the supervisory role they
         already have over the listing. Anyone else ends only what they
         themselves started, which is what makes starting one safe to grant.

         The row carries no org for a cross-academy super_admin session (the
         actor had no academy selected), so an undefined organizationId is
         never treated as "matches mine". 404, not 403: a session outside your
         reach should not be confirmed to exist. */
      const role = req.user!.role
      if (role !== 'super_admin') {
        const mine    = String(existing.actorId ?? '') === String(req.user!.id)
        const sameOrg = !!existing.organizationId && !!req.user!.organizationId
          && String(existing.organizationId) === String(req.user!.organizationId)
        const mayEnd  = mine || (role === 'admin' && sameOrg)
        if (!mayEnd) {
          res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
        }
      }
      await ImpersonationSessionModel.updateOne(
        { _id: id, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), revokedBy: req.user!.id } },
      )
      sendSuccess(res, null, 'Impersonation session ended')
    } catch (err) { next(err) }
  })

/* The kill switch. Ends every live impersonation session at once — the thing
   you reach for when you do not yet know which one is the problem. */
router.post('/impersonation-sessions/revoke-all', requireRole('super_admin'),
  audit('user.impersonate.revoke', 'ImpersonationSession'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ImpersonationSessionModel } = await import('@/models/schema.ts')
      const result = await ImpersonationSessionModel.updateMany(
        { revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $set: { revokedAt: new Date(), revokedBy: req.user!.id } },
      )
      sendSuccess(res, { revoked: result.modifiedCount }, 'All impersonation sessions ended')
    } catch (err) { next(err) }
  })

/* ── Device whitelist (two-device limit) ─────────────────────────────────
   Students are capped at two devices (enforced in auth.service at login and
   refresh). This is the approval side: list a student's devices, approve a
   pending second device, or revoke one to free a slot. Org admins see and act
   on their own academy only; super_admin sees all. */
const DEVICE_STATUSES = ['pending', 'approved', 'revoked'] as const

/* ─── The switch itself ──────────────────────────────────────────

   READ is open to any admin: the Devices page has to be able to say whether
   the queue it is showing is actually enforcing anything. An org admin
   looking at a list of pending requests that cannot block anyone needs to
   know that.

   WRITE is super_admin only, and deliberately not a permission an org admin
   can be granted. This is one global switch across every academy — a Dubai
   admin turning it off would be turning it off for Bangalore too — and it
   disables a security control, so it belongs to whoever owns the platform
   rather than to whoever owns an academy. */
router.get('/settings/device-limit', requireAnyAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await deviceLimitMeta())
  } catch (err) { next(err) }
})

const deviceLimitSchema = z.object({ enabled: z.boolean() })

router.patch('/settings/device-limit',
  requireRole('super_admin'),
  validate(deviceLimitSchema),
  audit('settings.device-limit', 'SystemSetting', undefined, r => ({ enabled: r.body.enabled })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enabled = await setDeviceLimitEnabled(Boolean(req.body.enabled), req.user!.id)
      sendSuccess(res, await deviceLimitMeta(),
        enabled
          ? 'Device limit is now enforced'
          : 'Device limit is now off — students can sign in on any device')
    } catch (err) { next(err) }
  })

router.get('/devices', requireAnyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const statusRaw = String(req.query['status'] ?? '')
    const status = DEVICE_STATUSES.find(s => s === statusRaw)
    const orgId = req.user!.role === 'super_admin' ? undefined : req.user!.organizationId
    const devices = await adminListDevices({ status, organizationId: orgId ?? undefined })
    sendSuccess(res, devices)
  } catch (err) { next(err) }
})

router.patch('/devices/:id/approve', requireAnyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.role === 'super_admin' ? undefined : req.user!.organizationId
    const result = await adminApproveDevice(String(req.params['id'] ?? ''), req.user!.id, orgId ?? undefined)
    if (!result.ok) {
      if (result.reason === 'limit') {
        res.status(409).json({ success: false, error: { code: 'DEVICE_LIMIT', message: 'This student already has two approved devices. Revoke one first.' } })
        return
      }
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found' } })
      return
    }
    sendSuccess(res, null, 'Device approved')
  } catch (err) { next(err) }
})

router.patch('/devices/:id/revoke', requireAnyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.role === 'super_admin' ? undefined : req.user!.organizationId
    const result = await adminRevokeDevice(String(req.params['id'] ?? ''), orgId ?? undefined)
    if (!result.ok) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Device not found' } })
      return
    }
    sendSuccess(res, null, 'Device revoked')
  } catch (err) { next(err) }
})

/* ── Enrollment requests (student approval workflow) ─────────────────────
   a programme-scoped sub_admin approves or cancels student signups
   for their program. super_admin / admin manage all.
──────────────────────────────────────────────────────────────────────── */
const enrollmentRequestQuerySchema = z.object({
  status:   z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).default('pending'),
  category: z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).optional(),
  page:     z.coerce.number().min(1).default(1),
  per_page: z.coerce.number().min(1).max(100).default(20),
})

const approveEnrollmentSchema = z.object({
  categories: z.array(z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura'])).optional(),
})

const rejectEnrollmentSchema = z.object({
  reason: z.string().min(5, 'Please provide a reason (min 5 characters)').max(1000),
})

router.get ('/enrollment-requests',
  requireAnyAdmin,
  validate(enrollmentRequestQuerySchema, 'query'),
  ctrl.listEnrollmentRequests,
)
router.patch('/enrollment-requests/:userId/approve',         requireAnyAdmin, requireSameOrgUser('userId'), validate(approveEnrollmentSchema), ctrl.approveEnrollment)
router.patch('/enrollment-requests/:userId/reject',          requireAnyAdmin, requireSameOrgUser('userId'), validate(rejectEnrollmentSchema),  ctrl.rejectEnrollment)
router.patch('/enrollment-requests/:userId/cancel',          requireAnyAdmin, requireSameOrgUser('userId'), validate(rejectEnrollmentSchema),  ctrl.rejectEnrollment)
router.patch('/enrollment-requests/:userId/revoke-to-viewer', requireAnyAdmin, requireSameOrgUser('userId'), ctrl.revokeToViewer)

const removeCategorySchema = z.object({
  category: z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']),
})
router.patch('/enrollment-requests/:userId/remove-category', requireAnyAdmin, requireSameOrgUser('userId'), validate(removeCategorySchema), ctrl.removeEnrollmentCategory)

/* Identity scans arrive as a `kyc/` key (H-11), the photo as a URL on our own
   storage. `z.string().url()` here rejected every key the upload endpoint
   returns, so admin re-uploads answered 422. See utils/documentRef.ts. */
const enrollmentDocsAdminSchema = z.object({
  passportUrl: documentRef,
  idDocUrl:    documentRef,
  photoUrl:    documentRef,
})
router.patch('/enrollment-requests/:userId/docs', requireAnyAdmin, requireSameOrgUser('userId'), validate(enrollmentDocsAdminSchema), ctrl.updateStudentDocs)

/* ─── Express Members ─────────────────────────────── */
const expressMembersQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(20),
  status:   z.enum(['all', 'active', 'blocked']).default('all'),
  search:   z.string().trim().optional(),
})
router.get   ('/express-members',            requireAnyAdmin, validate(expressMembersQuerySchema, 'query'), ctrl.listExpressMembers)
router.patch ('/express-members/:userId/block', requireAnyAdmin, requireSameOrgUser('userId'), ctrl.blockExpressMember)
router.delete('/express-members/:userId',    requireAdmin,    requireSameOrgUser('userId'), ctrl.deleteExpressMember)

/* ── Category-scope guards for enrollment management ──────────────
   Full admins (super_admin/admin) are unrestricted. Category-scoped
   callers (sub_admin, whose programme comes from `program`) may only
   touch students and courses within their own program — mirrors the pattern already used by rejectEnrollment
   (this file) and SectionService.assertCourseEditable. Always compare
   against req.user.categoryScope (already normalized to the hyphenated
   '4x-trading'|'digital-marketing'|'ai' form), never req.user.program
   directly — program uses a different naming scheme. */
function isFullAdmin(role: string): boolean {
  return role === 'super_admin' || role === 'admin'
}

async function courseMatchesScope(courseId: string, scope: string): Promise<boolean> {
  const { CourseModel } = await import('@/models/schema.ts')
  const course = await CourseModel.findById(courseId).select('program').lean()
  return !!course && (course as any).program === scope
}

async function studentMatchesScope(studentId: string, scope: string): Promise<boolean> {
  const { UserModel } = await import('@/models/schema.ts')
  const student = await UserModel.findById(studentId).select('category categories').lean()
  const cats: string[] = (student as any)?.categories?.length
    ? (student as any).categories
    : ((student as any)?.category ? [(student as any).category] : [])
  return cats.includes(scope)
}

/* ── May this caller act on this live session? ────────────────────
   The same two gates LiveClassController.#canManage applies, in the same
   order — academy first for everyone below super_admin, then ownership for
   instructors — reachable from the routes in THIS file that address a session
   indirectly (a booking id, a feedback id). Those routes had no check at all,
   so any instructor or staff account in either academy could rewrite another
   academy's attendance or read its feedback (P-05, P-12).

   The session's own instructorId is the sole authority; the parent course's
   owner is consulted only when the session names nobody, which is legacy data
   from before the field was populated (N-10). */
async function callerMayManageSession(req: Request, liveClassId: unknown): Promise<boolean> {
  if (req.user!.role === 'super_admin') return true

  const { LiveClassModel, CourseModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')

  const id = String(liveClassId ?? '')
  if (!Types.ObjectId.isValid(id)) return false

  const live = await LiveClassModel.findById(id)
    .select('instructorId courseId organizationId').lean()
  if (!live) return false

  /* Assignment first. For the instructor this session NAMES, the academy wall
     is asking the wrong question — a LENT instructor's borrowed-academy
     sessions sit on the far side of their own academy by design, so checking
     tenancy first refused attendance, cancellation and feedback on exactly the
     classes lending them exists to create. See instructorOwnsSession in
     utils/tenancy.ts. Anyone who is NOT the assigned instructor, including an
     instructor holding a colleague's session id, still meets the wall. */
  const owns = await instructorOwnsSession(req, live)

  if (!owns && !(await callerMayAccess(req, (live as { organizationId?: unknown }).organizationId))) {
    return false
  }

  if (req.user!.role !== 'instructor') return true
  return owns
}

/* ── May this caller act on THIS SEAT? ─────────────────────────────────────
   A narrower sibling of callerMayManageSession, and deliberately the ONLY
   write carve-out this feature adds.

   Managing the CLASS stays with the academy that owns it: editing, moving,
   cancelling and deleting all still route through the untouched funnels and
   still answer 404 across the wall. But a guest academy with forty of its own
   students in a shared room has to be able to mark them present and release a
   seat somebody took by mistake. Refusing that means their staff can see their
   students on the class and do nothing about them, which is not a tenable
   product answer.

   NARROW IN THREE INDEPENDENT WAYS:
     · the class must actually SERVE the caller's academy — owner or named
       guest cohort;
     · the SEAT must be stamped with the caller's academy, so a Bangalore admin
       can only touch Bangalore's seats on that class;
     · everything that is not one of the three seat routes still goes through
       callerMayManageSession, untouched.

   The seat stamp is read, never re-derived. A student's entitlement can change
   after they book, and re-deriving would hand one academy authority over the
   other's seat. */
async function callerMayManageSeat(
  req:     Request,
  booking: { liveClassId?: unknown; seatOrganizationId?: unknown },
): Promise<boolean> {
  if (await callerMayManageSession(req, booking.liveClassId)) return true

  const caller = await callerOrgForRead(req)
  if (caller.gone || !caller.org) return false
  if (!booking.seatOrganizationId) return false
  if (String(booking.seatOrganizationId) !== String(caller.org)) return false

  const { LiveClassModel } = await import('@/models/schema.ts')
  const live = await LiveClassModel.findById(String(booking.liveClassId ?? ''))
    .select('organizationId guestCohorts').lean()
  return classServesOrg(live as never, caller.org)
}

/* ── May this caller act on this student's records? ───────────────
   Wraps callerMayAccess for the routes that reach a user indirectly (via an
   enrolment, a booking). requireSameOrgUser already covers the routes that
   take a user id in the path. */
async function callerMayAccessUser(req: Request, userId: unknown): Promise<boolean> {
  const { UserModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')

  const id = String(userId ?? '')
  if (!Types.ObjectId.isValid(id)) return false

  const target = await UserModel.findById(id).select('organizationId').lean()
  if (!target) return false
  return callerMayAccess(req, (target as { organizationId?: unknown }).organizationId)
}

/* GET /admin/users/:id/enrollments — list a student's course enrollments */
router.get('/users/:id/enrollments', requireAnyAdmin, requireSameOrgUser('id'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { EnrollmentModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const studentId = req.params['id'] as string
      if (!Types.ObjectId.isValid(studentId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } })
        return
      }
      if (!isFullAdmin(req.user!.role)) {
        const scope = req.user!.categoryScope
        if (!scope || !(await studentMatchesScope(studentId, scope))) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only view students in your own program.' } })
          return
        }
      }
      const enrollments = await EnrollmentModel.find({ userId: new Types.ObjectId(studentId) })
        .populate('courseId', 'id title thumbnailUrl')
        .lean({ virtuals: true })
      sendSuccess(res, enrollments)
    } catch (err) { next(err) }
  },
)

/* ────────────────────────────────────────────────────────────────────────────
   GET /admin/courses/:id/students — who is in this course, and how they got in
   ────────────────────────────────────────────────────────────────────────────
   The reverse of /users/:id/enrollments, which was the only direction that
   existed: enrolments could be listed per student but never per course, so
   "who is on this course" had no answer short of a database query.

   `source` is read from the enrolment, not recomputed here. Deriving it at
   read time would mean re-guessing on every request the thing that is only
   knowable at write time — and would quietly disagree with the stored value
   the moment the two rules drifted. Rows written before the field exists read
   as 'unknown' until scripts/backfill-enrollment-source.ts has run.
──────────────────────────────────────────────────────────────────────────── */
router.get('/courses/:id/students', requireAnyAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')

      const courseId = String(req.params['id'] ?? '')
      if (!Types.ObjectId.isValid(courseId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid course ID' } })
        return
      }

      /* Tenancy first: a course belonging to another academy must not leak its
         roster, and the roster is the part that names real people. */
      const course = await CourseModel.findById(courseId)
        .select('title organizationId program').lean() as
          { title?: string; organizationId?: unknown; program?: string } | null
      if (!course) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Course not found' } })
        return
      }
      if (!isFullAdmin(req.user!.role)) {
        const sameOrg = !course.organizationId
          || String(course.organizationId) === String(req.user!.organizationId ?? '')
        if (!sameOrg) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'This course belongs to another academy.' } })
          return
        }
      }

      const page    = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
      const perPage = Math.min(100, Math.max(1, parseInt(String(req.query['per_page'] ?? '25'), 10) || 25))
      const search  = String(req.query['search'] ?? '').trim()
      const source  = String(req.query['source'] ?? '').trim()

      const match: Record<string, unknown> = { courseId: new Types.ObjectId(courseId) }
      if (source && source !== 'all') match['source'] = source

      const pipeline: import('mongoose').PipelineStage[] = [
        { $match: match },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'student' } },
        /* An enrolment whose user has been deleted has nothing to show, so it
           cannot appear as a row — but it is still counted by the course's
           enrolledCount, and dropping it silently would make the list
           disagree with the tile above it with no explanation. It is counted
           separately instead and reported as `orphaned`. */
        { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      ]

      /* Search runs after the join because it looks at the student, not the
         enrolment. */
      if (search) {
        const rx = search.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        pipeline.push({ $match: { $or: [
          { 'student.name':  { $regex: rx, $options: 'i' } },
          { 'student.email': { $regex: rx, $options: 'i' } },
        ] } })
      }

      pipeline.push(
        { $sort: { enrolledAt: -1 } },
        { $facet: {
          rows: [
            { $match: { student: { $ne: null } } },
            { $skip: (page - 1) * perPage },
            { $limit: perPage },
            { $project: {
              _id: 1, source: 1, status: 1, enrolledAt: 1,
              /* Older rows pre-date the field and would otherwise reach the
                 UI as undefined. */
              progressPercent: { $ifNull: ['$progressPercent', 0] },
              student: {
                id: '$student._id', name: '$student.name', email: '$student.email',
                phone: '$student.phone', avatarUrl: '$student.avatarUrl',
                enrollmentStatus: '$student.enrollmentStatus', isActive: '$student.isActive',
              },
            } },
          ],
          total: [{ $match: { student: { $ne: null } } }, { $count: 'n' }],
        } },
      )

      /* ── The chip counts and the orphan tally describe the COURSE, so they
            run on their own pipeline rather than inside the facet above.

            Sharing the facet meant they inherited `source` and `search`, and
            the chips are what you click to CHANGE the source: filtering to
            Purchased rebuilt the row as "All 2 · Purchased 2", the Unknown
            chip vanished, and there was no way back to it. "All" also stopped
            meaning all. The orphan notice disappeared for the same reason,
            which is worse than it sounds — it is the explanation for why the
            list is shorter than the tile. ─────────────────────────────── */
      const overview: import('mongoose').PipelineStage[] = [
        { $match: { courseId: new Types.ObjectId(courseId) } },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'student' } },
        { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
        { $facet: {
          orphaned: [{ $match: { student: null } }, { $count: 'n' }],
          bySource: [
            { $match: { student: { $ne: null } } },
            { $group: { _id: '$source', n: { $sum: 1 } } },
          ],
        } },
      ]

      const [[agg], [counts]] = await Promise.all([
        EnrollmentModel.aggregate(pipeline),
        EnrollmentModel.aggregate(overview),
      ])
      const total = agg?.total?.[0]?.n ?? 0
      const bySource = Object.fromEntries(
        (counts?.bySource ?? []).map((b: { _id: string | null; n: number }) => [b._id ?? 'unknown', b.n]),
      )

      const totalPages = Math.max(1, Math.ceil(total / perPage))
      sendSuccess(res, {
        courseTitle: course.title ?? '',
        rows: agg?.rows ?? [],
        bySource,
        /* Enrolments pointing at deleted accounts. Surfaced rather than
           swallowed: they are why this list can be shorter than the
           course's enrolled count. */
        orphaned: counts?.orphaned?.[0]?.n ?? 0,
      }, undefined, 200, {
        total_count: total,
        page,
        per_page:    perPage,
        total_pages: totalPages,
        has_next:    page < totalPages,
        has_prev:    page > 1,
      })
    } catch (err) { next(err) }
  },
)

/* GET /admin/users/:id/orders — list a student's purchase history */
/* Tenancy is enforced by requireSameOrgUser — previously hand-rolled here,
   which made it a fifth copy of the same rule and one that missed the
   deleted-account case. */
router.get('/users/:id/orders', requireAdmin, requireSameOrgUser('id'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await orderSvc.listForUser(String(req.params['id'] ?? ''))
      sendSuccess(res, orders)
    } catch (err) { next(err) }
  },
)

/* POST /admin/users/:id/enrollments — enroll student in a course */
const enrollCreateSchema = z.object({ courseId: z.string().min(1) })

router.post('/users/:id/enrollments', requireAnyAdmin, requireSameOrgUser('id'), validate(enrollCreateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const userId   = req.params['id'] as string
      const courseId = (req.body as { courseId: string }).courseId
      if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(courseId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid ID' } })
        return
      }
      if (!isFullAdmin(req.user!.role)) {
        const scope = req.user!.categoryScope
        const ok = !!scope && await courseMatchesScope(courseId, scope) && await studentMatchesScope(userId, scope)
        if (!ok) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only enroll students who are in your own program into courses within your own program.' } })
          return
        }
      }
      /* Admin override — bypass published/paid checks; idempotent */
      const existing = await EnrollmentModel.findOne({
        userId:   new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
      }).populate('courseId', 'id title thumbnailUrl').lean({ virtuals: true })
      if (existing) {
        sendSuccess(res, existing, 'Already enrolled')
        return
      }
      const doc = await EnrollmentModel.create({
        userId:   new Types.ObjectId(userId),
        courseId: new Types.ObjectId(courseId),
        source:   'admin',
      })
      /* Keep the denormalised counter in step. It is maintained on the
         self-enrol and purchase paths but was never touched here, so every
         admin enrolment left the catalogue's student count one short. */
      await CourseModel.updateOne({ _id: new Types.ObjectId(courseId) }, { $inc: { enrolledCount: 1 } })
      const populated = await EnrollmentModel.findById(doc._id)
        .populate('courseId', 'id title thumbnailUrl')
        .lean({ virtuals: true })
      sendSuccess(res, populated, 'Enrolled', 201)
    } catch (err) { next(err) }
  },
)

/* DELETE /admin/enrollments/:id — remove an enrollment */
router.delete('/enrollments/:id', requireAnyAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
      const existing = await EnrollmentModel.findById(req.params['id']).select('courseId userId').lean()
      if (!existing) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Enrollment not found' } })
        return
      }
      /* TENANCY FIRST (P-11). The programme check below is skipped entirely by
         isFullAdmin — which includes the org-scoped `admin` role — so without
         this a Dubai admin could revoke a Bangalore student's paid access by
         id. Same shape as N-11: a guard that exempts `admin` before academy is
         ever considered. */
      if (!(await callerMayAccessUser(req, existing.userId))) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Enrollment not found' } })
        return
      }
      if (!isFullAdmin(req.user!.role)) {
        const scope = req.user!.categoryScope
        const ok = !!scope
          && await courseMatchesScope(String(existing.courseId), scope)
          && await studentMatchesScope(String(existing.userId), scope)
        if (!ok) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only manage enrollments within your own program.' } })
          return
        }
      }
      await EnrollmentModel.findByIdAndDelete(req.params['id'])
      /* Down as well as up: nothing decremented this counter anywhere, so it
         could only ever grow. `existing` was already loaded above for the
         scope check, so the course id costs nothing here. */
      if (existing?.courseId) {
        await CourseModel.updateOne({ _id: existing.courseId }, { $inc: { enrolledCount: -1 } })
      }
      sendSuccess(res, null, 'Enrollment removed')
    } catch (err) { next(err) }
  },
)

/* PATCH /admin/enrollments/:id — update blocked lessons for one enrollment */
const enrollmentUpdateSchema = z.object({
  blockedLessons: z.array(z.string()),
})

router.patch('/enrollments/:id', requireAnyAdmin, validate(enrollmentUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { EnrollmentModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const existing = await EnrollmentModel.findById(req.params['id']).select('courseId userId').lean()
      if (!existing) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Enrollment not found' } })
        return
      }
      /* TENANCY FIRST (P-11) — see the DELETE route above. blockedLessons is
         what gates module-level access, so this is a write to another
         academy's access control, not just to a record. */
      if (!(await callerMayAccessUser(req, existing.userId))) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Enrollment not found' } })
        return
      }
      if (!isFullAdmin(req.user!.role)) {
        const scope = req.user!.categoryScope
        const ok = !!scope
          && await courseMatchesScope(String(existing.courseId), scope)
          && await studentMatchesScope(String(existing.userId), scope)
        if (!ok) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only manage enrollments within your own program.' } })
          return
        }
      }
      const { blockedLessons } = req.body as { blockedLessons: string[] }
      const blockedObjectIds = blockedLessons
        .filter((id: string) => Types.ObjectId.isValid(id))
        .map((id: string) => new Types.ObjectId(id))
      const enrollment = await EnrollmentModel.findByIdAndUpdate(
        req.params['id'],
        { blockedLessons: blockedObjectIds },
        { new: true },
      ).populate('courseId', 'id title thumbnailUrl').lean({ virtuals: true })
      sendSuccess(res, enrollment)
    } catch (err) { next(err) }
  },
)

/* ─── Reviews (admin-only) ────────────────────────── */
router.get   ('/reviews', requirePermission('reviews','list'),     requireAdmin, ctrl.listReviews)
router.delete('/reviews/:id', requirePermission('reviews','delete'), requireAdmin, audit('review.delete', 'Review', r => String(r.params['id'] ?? '')), ctrl.deleteReview)

/* Who may reach a class recording.
   
   A recording IS the class, after the fact — and watching it is arguably the
   more sensitive of the two, because it is reviewable at leisure. So the gate
   is the SAME set that decides who may enter the live room, imported rather
   than restated so the two cannot drift apart.
   
   That deliberately excludes `support`: support staff handle tickets in the
   LMS, while their meeting-side duties live in the meeting platform under its
   own customer_service tier. A role that may not walk into a classroom has no
   business reviewing the tape of one. */
async function requireClassroomAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { ADMIN_OBSERVER_ROLES } = await import('@/services/liveClassJoin.service.ts')
  if (!ADMIN_OBSERVER_ROLES.has(req.user!.role)) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Class recordings are not available for your role.' },
    })
    return
  }
  next()
}

/* ─── Class recordings ────────────────────────────────────────────────────
   Every recorded live class in one place. super_admin sees all academies;
   everyone else is scoped to their own, matching every other admin listing.

   The URL is NOT stored — see cltWebhook.service.ts. A separate call mints a
   short-lived link at play time, so a stale presign can never be served.
──────────────────────────────────────────────────────────────────────────── */
router.get('/recordings', requireAnyAdmin, requireClassroomAccess, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { page, per_page } = parsePagination(req.query as Record<string, unknown>)

    const filter: Record<string, unknown> = { cltRecordingId: { $exists: true } }
    const orgId = req.user!.organizationId
    if (req.user!.role !== 'super_admin' && orgId && Types.ObjectId.isValid(orgId)) {
      /* CLASSES THIS ACADEMY IS SERVED BY, not only the ones it owns — the
         same widening the console list, the calendar and the bookings roster
         already carry. Strict ownership meant a guest academy could send its
         students into a shared class, mark their attendance, and then not be
         able to review the recording of the hour they sat in. The recording is
         the class; whoever may see the class may see it. */
      andFilter(filter, servedClassFilter(orgId))
    }
    const search = String((req.query as Record<string, string>)['search'] ?? '').trim()
    if (search) filter['title'] = { $regex: search, $options: 'i' }

    /* Programme scope, mirroring assertAdminMayObserve: a sub_admin who may not
       ENTER a JURA class must not be able to WATCH it afterwards either. The
       recording is the class. Scope lives on the course, so this resolves the
       caller's programme to a course id set first. */
    const scope = req.user!.categoryScope
    if (scope) {
      const { CourseModel } = await import('@/models/schema.ts')
      const scoped = await CourseModel.find({ program: scope }).select('_id').lean()
      const ids = scoped.map(c => c._id)
      /* The guest door's course counts as "this programme" here too, for the
         reason set out on the same narrowing in liveClass.repository.ts: a
         guest academy's programme-scoped admin holds their OWN course and never
         the host's, so asking only about `courseId` hid every shared class from
         them. Composed under $and, because `title` search and the status terms
         are assigned above and an assignment to $or would drop them. */
      andFilter(filter, CROSS_ORG_CLASSES_ENABLED
        ? { $or: [{ courseId: { $in: ids } }, { 'guestCohorts.courseId': { $in: ids } }] }
        : { courseId: { $in: ids } })
    }

    const [docs, totalCount] = await Promise.all([
      LiveClassModel.find(filter)
        .sort({ endedAt: -1, scheduledStart: -1 })
        .skip((page - 1) * per_page).limit(per_page)
        .populate('instructorId', 'name email')
        .populate('courseId', 'title slug')
        .lean(),
      LiveClassModel.countDocuments(filter),
    ])

    const rows = (docs as any[]).map(d => ({
      id:              String(d._id),
      title:           d.title,
      scheduledStart:  d.scheduledStart,
      endedAt:         d.endedAt ?? null,
      durationMins:    d.durationMins,
      recordingSecs:   d.recordingDurationSecs ?? null,
      cltRecordingId:  d.cltRecordingId,
      course:          d.courseId ? { id: String(d.courseId._id), title: d.courseId.title } : null,
      instructor:      d.instructorId ? { id: String(d.instructorId._id), name: d.instructorId.name } : null,
      organizationId:  d.organizationId ? String(d.organizationId) : null,
    }))
    sendSuccess(res, rows, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
  } catch (err) { next(err) }
})

/* Mint a short-lived playback URL. Authorisation happens HERE — reaching CLT
   at all means this LMS admin was allowed to watch. */
router.post('/recordings/:id/playback', requireAnyAdmin, requireClassroomAccess,
  /* Audited: who watched which class recording is worth being able to answer. */
  audit('recording.view', 'LiveClass', r => String(r.params['id'] ?? '')),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { LiveClassModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const id = String(req.params['id'] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid id' } }); return
      }
      const live = await LiveClassModel.findById(id).lean() as any
      if (!live?.cltRecordingId) {
        res.status(404).json({ success: false, error: { code: 'NO_RECORDING', message: 'This class has no recording.' } }); return
      }
      /* Org scoping, same rule as the listing: a non-super admin must not pull
         a recording from another academy by guessing an id. */
      const orgId = req.user!.organizationId
      if (req.user!.role !== 'super_admin' && orgId && live.organizationId
          && String(live.organizationId) !== String(orgId)) {
        res.status(403).json({ success: false, error: { code: 'WRONG_ACADEMY', message: 'That class belongs to another academy.' } }); return
      }

      /* And the programme wall. Without it the listing hid other programmes
         while this endpoint still served them to anyone who guessed an id —
         a filter is not a permission. */
      const scope = req.user!.categoryScope
      if (scope && live.courseId) {
        const { CourseModel } = await import('@/models/schema.ts')
        const course = await CourseModel.findById(String(live.courseId)).select('program').lean()
        if (!course || (course as { program?: string }).program !== scope) {
          res.status(403).json({ success: false, error: { code: 'OUT_OF_SCOPE', message: 'That class belongs to another programme.' } }); return
        }
      }

      const { requestPlaybackUrl } = await import('@/services/clt.service.ts')
      try {
        const out = await requestPlaybackUrl(live.cltRecordingId)
        sendSuccess(res, out, 'Playback link issued')
      } catch (err: any) {
        res.status(503).json({ success: false, error: { code: 'CLT_UNAVAILABLE', message: err?.message ?? 'Could not reach the meeting platform.' } })
      }
    } catch (err) { next(err) }
  })

/* ─── Sections + Lessons (admin + own-course instructor) ─── */
const sectionCreateSchema = z.object({
  title:       z.string().min(1).max(255).trim(),
  description: z.string().max(1000).optional(),
})
const sectionUpdateSchema = z.object({
  title:       z.string().min(1).max(255).trim().optional(),
  description: z.string().max(1000).optional(),
  order:       z.coerce.number().int().min(0).optional(),
})
const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

const lessonCreateSchema = z.object({
  sectionId:    z.string().min(1),
  title:        z.string().min(1).max(255).trim(),
  type:         z.enum(['video', 'article', 'quiz']).optional(),
  contentUrl:   z.string().url().or(z.literal('')).optional(),
  contentBody:  z.string().max(20000).optional(),
  durationMins: z.coerce.number().int().min(0).max(60 * 60).optional(),
  isFree:       z.boolean().optional(),
})
const lessonUpdateSchema = lessonCreateSchema
  .omit({ sectionId: true })
  .partial()
  .extend({ order: z.coerce.number().int().min(0).optional() })
const lessonMoveSchema = z.object({
  sectionId: z.string().min(1),
})

router.get   ('/courses/:id/outline',                     ctrl.getOutline)
router.get   ('/courses/:courseId/sections',              ctrl.listSections)
router.post  ('/courses/:courseId/sections',              validate(sectionCreateSchema),  ctrl.createSection)
router.patch ('/sections/:id',                            validate(sectionUpdateSchema),  ctrl.updateSection)
router.delete('/sections/:id',                            ctrl.deleteSection)
router.put   ('/courses/:courseId/sections/reorder',      validate(reorderSchema),        ctrl.reorderSections)

router.post  ('/lessons',                                 validate(lessonCreateSchema),   ctrl.createLesson)
router.patch ('/lessons/:id',                             validate(lessonUpdateSchema),   ctrl.updateLesson)
router.delete('/lessons/:id',                             ctrl.deleteLesson)
router.post  ('/lessons/:id/move',                        validate(lessonMoveSchema),     ctrl.moveLesson)
router.put   ('/sections/:sectionId/lessons/reorder',     validate(reorderSchema),        ctrl.reorderLessons)

/* ─── Live classes ────────────────────────────────── */
/* THE LANGUAGES A CLASS MAY BE TAUGHT IN — and the gate, not a suggestion:
   both the create and update validators below are z.enum over this, so a
   value missing from here cannot be saved however many pickers offer it.

   Tamil is new here and was overdue: admin/src/lib/languages.ts and the
   offline-class modal have both offered it for a while, so choosing Tamil
   produced a 400 from a dropdown that showed it as a normal option.

   "Hindi/English" is a bilingual class rather than a third language. It is
   one stored value on purpose — a class is delivered one way and a student
   filtering for it wants that one thing. The slash is safe: language is
   never a path segment anywhere, and the one key it is joined into
   (groupKeyOf in the client) separates on '|'. */
const LIVE_LANGUAGES = [
  'English', 'Hindi/English', 'Hindi', 'Malayalam', 'Tamil', 'Arabic', 'Urdu',
] as const
/* ── CROSS-ACADEMY COHORTS ──────────────────────────────────────────────
   One class, more than one academy. Each entry is a DOOR: the academy whose
   students may come in, the course of THEIRS they must be enrolled in, and
   optionally the module of that course. Entitlement never compares a value
   from one door against a value from another.

   These two fields were missing from this schema for the whole of phase 2, and
   validate() assigns result.data over the body on a NON-STRICT object — so zod
   STRIPPED them and the route answered 201 having quietly created a
   single-academy class. No error, no log, and four green suites, because every
   one of them authored cohorts through the service or the model rather than
   over HTTP.

   Only SHAPE is checked here. Everything that needs the database — does the
   academy exist, is that course really its course, is that module really that
   course's, is this cohort secretly the host's own academy — lives in
   #assertCohortsUsable in liveClass.service.ts, which zod cannot reach. */
const guestCohortSchema = z.object({
  organizationId: z.string().min(1),
  courseId:       z.string().min(1),
  sectionId:      z.string().optional(),
  /* Coerced like durationMins and sessionCapacity below, because a number
     input hands back a string. .int().min(0) still refuses -1 and 2.9 —
     coercion widens what is ACCEPTED, not what is ALLOWED. */
  seatFloor:      z.coerce.number().int().min(0).max(500),
})

/* Ten is not a technical limit, it is a sanity bound: a class shared with more
   academies than that is a data-entry accident, not a timetable. */
const cohortsField  = z.array(guestCohortSchema).max(10).optional()
const overflowField = z.coerce.number().int().min(0).max(500).optional()

/* The two rules that have to see more than one field at once, so cannot sit on
   a single member. Applied to create AND update — a rule enforced in only one
   of the two is a rule that holds until the first edit. */
const withCohortRules = (o: z.ZodTypeAny) => o
  /* An overflow with nobody to share it with is a number that reaches the
     service and is dropped: create() only enters the allocation branch when
     there is at least one cohort. Refusing it beats repeating the exact
     silent-discard bug this change exists to fix. */
  .refine((v: any) => !(v.overflowSeats != null && !(v.guestCohorts ?? []).length),
    { path: ['overflowSeats'],
      message: 'Overflow seats need at least one guest academy to share them with' })
  /* An in-person class is a room in a building. Admitting another academy's
     students to it is not something anyone chose, so it is refused rather than
     assumed. */
  .refine((v: any) => !(v.isOnline === false && (v.guestCohorts ?? []).length),
    { path: ['guestCohorts'],
      message: 'An in-person class cannot be shared with another academy' })

const liveCreateSchema = withCohortRules(z.object({
  courseId:        z.string().min(1),
  title:           z.string().min(3).max(255).trim(),
  description:     z.string().max(2000).optional(),
  scheduledStart:  z.string().datetime().or(z.string().refine(s => !isNaN(Date.parse(s)), 'Invalid date')),
  durationMins:    z.coerce.number().int().min(5).max(600),
  type:            z.enum(['external', 'internal']).default('external'),
  /* Which in-app engine backs an `internal` class. Omitted means 'mux', so
     every existing caller keeps its current behaviour. */
  provider:        z.enum(['mux', 'livekit']).optional(),
  /* meetingUrl is now auto-generated for external sessions — omit from create requests */
  instructorId:    z.string().optional(),
  sectionId:       z.string().optional(),
  /* 500 is the schema's own ceiling (schema.ts sessionCapacity max). Accepting
     10000 here only pushed the refusal down into Mongoose, where it surfaced as
     a validation error rather than a field-level message. */
  sessionCapacity: z.coerce.number().int().min(1).max(500).optional(),
  language:        z.enum(LIVE_LANGUAGES).default('English'),
  /* Offline / in-person support */
  isOnline:        z.boolean().optional(),
  location:        z.string().max(500).optional(),
  room:            z.string().max(100).optional(),
  guestCohorts:    cohortsField,
  overflowSeats:   overflowField,
}))
const liveUpdateSchema = withCohortRules(z.object({
  title:           z.string().min(3).max(255).trim().optional(),
  description:     z.string().max(2000).optional(),
  scheduledStart:  z.string().refine(s => !isNaN(Date.parse(s)), 'Invalid date').optional(),
  durationMins:    z.coerce.number().int().min(5).max(600).optional(),
  meetingUrl:      z.string().url().max(2048).optional(),
  recordingUrl:    z.string().url().max(2048).optional().or(z.literal('')),
  status:          z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
  /* 500 is the schema's own ceiling (schema.ts sessionCapacity max). Accepting
     10000 here only pushed the refusal down into Mongoose, where it surfaced as
     a validation error rather than a field-level message. */
  sessionCapacity: z.coerce.number().int().min(1).max(500).optional(),
  mentorNotes:     z.string().max(5000).optional(),
  courseId:        z.string().optional(),
  sectionId:       z.string().optional(),
  instructorId:    z.string().optional(),
  language:          z.enum(LIVE_LANGUAGES).optional(),
  /* Offline / in-person support */
  isOnline:          z.boolean().optional(),
  location:          z.string().max(500).optional(),
  room:              z.string().max(100).optional(),
  rescheduleReason:  z.string().max(2000).optional(),
  guestCohorts:      cohortsField,
  overflowSeats:     overflowField,
}))

router.get   ('/courses/:courseId/live-classes',          live.adminListForCourse)
router.get   ('/live-classes',                            live.adminListAll)
router.get   ('/live-classes/:id',                        live.adminGetById)
router.post  ('/live-classes', requirePermission('live-classes','create'),                            validate(liveCreateSchema), audit('liveclass.create', 'LiveClass', undefined, r => ({ title: r.body.title, scheduledStart: r.body.scheduledStart })), live.adminCreate)
const liveRepeatSchema = z.object({ weeks: z.coerce.number().int().min(1).max(52) })
/* Repeat MINTS CLASSES, so it needs the same permission as create. It carried
   only validate() while its three siblings above and below all carry the
   matrix guard, so a custom role explicitly DENIED live-class creation could
   still produce up to 52 of them by repeating one it was allowed to see. */
router.post  ('/live-classes/:id/repeat',                 requirePermission('live-classes','create'), validate(liveRepeatSchema), audit('liveclass.repeat', 'LiveClass', r => String(r.params['id'] ?? ''), r => ({ weeks: r.body.weeks })), live.adminRepeat)
router.patch ('/live-classes/:id', requirePermission('live-classes','update'),                        validate(liveUpdateSchema), audit('liveclass.update', 'LiveClass', r => String(r.params['id'] ?? '')), live.adminUpdate)
router.delete('/live-classes/:id', requirePermission('live-classes','delete'),                        audit('liveclass.delete', 'LiveClass', r => String(r.params['id'] ?? '')), live.adminDelete)
router.post  ('/live-classes/:id/start',                  live.adminStart)
router.post  ('/live-classes/:id/end',                    live.adminEnd)
router.post  ('/live-classes/:id/recreate',               live.adminRecreate)
router.get   ('/live-classes/:id/stream-credentials',     ctrl.guardStreamCredentials, live.adminGetStreamCredentials)

/* POST /admin/live-classes/:id/handoff — the ADMIN portal's door into a class.

   The same handler the student router mounts, but reached through this
   router's `authenticateAdmin`, so it resolves the admin/instructor session.
   Splitting it by mount is what stops the two portals' cookies competing —
   see the handler. */
router.post ('/live-classes/:id/handoff',                 issueClassHandoff)

/* ─── Admin book-for-student (offline classes only) ──── */
const bookForStudentSchema = z.object({
  liveClassId: z.string().min(1),
  studentId:   z.string().min(1),
})

router.post('/bookings/book-for-student', requireAnyAdmin, validate(bookForStudentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel, UserModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { NotificationService } = await import('@/services/notification.service.ts')

    const { liveClassId, studentId } = req.body as { liveClassId: string; studentId: string }

    if (!Types.ObjectId.isValid(liveClassId) || !Types.ObjectId.isValid(studentId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid liveClassId or studentId' } }); return
    }

    const session = await LiveClassModel.findById(liveClassId).lean()
    if (!session) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }

    /* Tenancy on BOTH sides (P-14) — the session and the student. Without it a
       Dubai admin could consume a seat in a Bangalore class and email a
       student in an academy they do not administer. */
    if (!(await callerMayManageSession(req, liveClassId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }

    if ((session as any).isOnline !== false) {
      res.status(400).json({ success: false, error: { code: 'ONLINE_CLASS', message: 'Admin booking is only available for offline (in-person) classes' } }); return
    }

    if (session.status === 'cancelled' || session.status === 'ended') {
      res.status(400).json({ success: false, error: { code: 'SESSION_UNAVAILABLE', message: 'Session is no longer available for booking' } }); return
    }

    if (new Date(session.scheduledStart) <= new Date()) {
      res.status(400).json({ success: false, error: { code: 'BOOKING_CLOSED', message: 'Booking is closed — this class has already started' } }); return
    }

    const student = await UserModel.findById(studentId).lean()
    if (!student || (student as any).role !== 'student') {
      res.status(404).json({ success: false, error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' } }); return
    }
    if (!(await callerMayAccessUser(req, studentId))) {
      res.status(404).json({ success: false, error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' } }); return
    }

    /* ENROLMENT AND MODULE, ASKED OF ONE DOOR — the same helper the student's
       own booking route uses, so an admin booking on someone's behalf can never
       admit a student their own request would have been refused. Note the
       subject is the STUDENT, not the admin: it is the student's enrolment and
       the student's blocked modules that decide. */
    /* THE STUDENT'S academy, not the admin's — an admin of one academy can book
       a seat for a student of another on a shared class, and it is the student
       who has to be entitled. Same reasoning as the student's own route: with
       more than one door, the academy is what selects it, and without it the
       resolver would admit them through whichever door happened to yield an
       enrolment first. */
    const entitlement = await resolveClassEntitlement(
      session, studentId,
      (student as { organizationId?: unknown }).organizationId
        ? String((student as { organizationId?: unknown }).organizationId) : null,
      'active',
    )
    if (!entitlement.ok) {
      const refusal = entitlement.code === 'MODULE_BLOCKED'
        ? { code: 'MODULE_BLOCKED', message: 'Student does not have access to this module' }
        : { code: 'NOT_ENROLLED', message: 'Student is not enrolled in this course' }
      res.status(403).json({ success: false, error: refusal }); return
    }

    /* Capacity fast-check — the authoritative check is the atomic seat
       reservation below, which is what actually enforces the cap. */
    if (session.bookedCount >= session.sessionCapacity) {
      res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
    }

    const existing = await ClassBookingModel.findOne({
      userId:      new Types.ObjectId(studentId),
      liveClassId: new Types.ObjectId(liveClassId),
    }).lean()

    let bookingDoc
    if (existing) {
      if (existing.status === 'cancelled') {
        /* Reserve the seat atomically — the cap is re-evaluated inside the
           filter, so concurrent bookings can never oversell the session. */
        const reserved = await reserveSeat(liveClassId, entitlement.door?.organizationId ?? null)
        if (reserved === null) {
          res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
        }
        /* The status:'cancelled' term makes the transition conditional, so
           two concurrent re-books cannot both succeed and leak a seat. */
        let rebooked
        try {
          rebooked = await ClassBookingModel.updateOne({ _id: existing._id, status: 'cancelled' }, {
            status: 'booked', bookedAt: new Date(), cancelledAt: undefined,
            ...seatStampFrom(reserved, entitlement.door),
            reminderDayBeforeSent: false, reminderDayOfSent: false,
            reminderPreSessionSent: false, reminder5MinSent: false, reminderAtTimeSent: false,
          })
        } catch (err) {
          /* Re-book failed — give the reserved seat back, to the pool it came from */
          await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
          throw err
        }
        if (rebooked.modifiedCount === 0) {
          /* Another request re-booked it first — give the seat back */
          await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
          res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'Student already has a booking for this session' } }); return
        }
        bookingDoc = await ClassBookingModel.findById(existing._id).lean({ virtuals: true })
      } else {
        res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'Student already has a booking for this session' } }); return
      }
    } else {
      /* Reserve the seat atomically — the cap is re-evaluated inside the
         filter, so concurrent bookings can never oversell the session. */
      const reserved = await reserveSeat(liveClassId, entitlement.door?.organizationId ?? null)
      if (reserved === null) {
        res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
      }

      let booking
      try {
        booking = await ClassBookingModel.create({
          userId:      new Types.ObjectId(studentId),
          liveClassId: new Types.ObjectId(liveClassId),
          status:      'booked',
          bookedAt:    new Date(),
          ...seatStampFrom(reserved, entitlement.door),
        })
      } catch (err) {
        /* Booking row not created — give the reserved seat back */
        await releaseSeat({ liveClassId, ...seatStampFrom(reserved, entitlement.door) })
        throw err
      }

      bookingDoc = await booking.populate([
        { path: 'liveClassId', select: 'id title scheduledStart durationMins meetingUrl type' },
      ])
    }

    sendSuccess(res, bookingDoc, 'Booking created for student', 201)

    /* Post-booking: notify + email student (fire-and-forget) */
    const notifSvc = new NotificationService()
    /* Awaited, and the STUDENT's academy. This was a bare toLocaleString: no
       timeZone, so it took the server's (Asia/Dubai, pinned in
       config/timezone.ts), and no tag, so nothing said which clock it meant.
       An admin of one academy can book a seat for a student of another on a
       shared class, so the reader is routinely not in the server's zone. The
       warm has to be awaited here too — orgSlugFor is synchronous and a
       fire-and-forget warm loses the race on the first request after boot. */
    await ensureOrgSlugs()
    const dateLabel = academyClock(session.scheduledStart,
      orgSlugFor((student as { organizationId?: unknown }).organizationId)).full
    const joinUrl = (session as any).meetingUrl ?? `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/live-classes/${liveClassId}/watch`

    notifSvc.create(studentId, {
      kind: 'booking-confirmed', title: `Booking confirmed: ${session.title}`,
      body: `Your seat is confirmed for ${session.title} on ${dateLabel}.`, link: SCHEDULE_LINK,
    }).catch(() => {/* non-fatal */})

    import('@/services/email.service.ts').then(({ sendBookingConfirmation }) => {
      sendBookingConfirmation(
        (student as any).email, (student as any).name, session.title, session.scheduledStart,
        /* The STUDENT's academy, not the admin's: an admin of one academy can
           book a seat for a student of another on a shared class. */
        orgSlugFor((student as any).organizationId),
      )
        .catch(() => {/* non-fatal */})
    }).catch(() => {/* non-fatal */})

  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'Student already has a booking for this session' } }); return
    }
    next(err)
  }
})

/* ─── Quiz management (admin + own-course instructor) ─── */
const quizUpsertSchema = z.object({
  passPercent: z.coerce.number().int().min(0).max(100).optional(),
  timeLimit:   z.coerce.number().int().min(1).optional(),
  questions:   z.array(z.object({
    text:          z.string().min(1).max(2000).trim(),
    type:          z.enum(['mcq', 'true_false', 'short']),
    choices:       z.array(z.string().max(500)).default([]),
    correctAnswer: z.string().min(1),
    points:        z.coerce.number().int().min(1).optional(),
    explanation:   z.string().max(2000).optional(),
  })).min(1),
})

const assignUpsertSchema = z.object({
  title:        z.string().min(1).max(255).trim(),
  instructions: z.string().min(1).max(20000),
  dueDate:      z.string().datetime().optional(),
  maxScore:     z.coerce.number().int().min(1).optional(),
})

const gradeSchema = z.object({
  grade:    z.coerce.number().min(0),
  feedback: z.string().max(5000).optional(),
})

/* GET quiz for a lesson */
router.get('/lessons/:lessonId/quiz', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    const quiz = await quizSvc.getByLesson(lessonId)
    sendSuccess(res, quiz ?? null)
  } catch (err) { next(err) }
})

/* PUT (upsert) quiz for a lesson */
router.put('/lessons/:lessonId/quiz', validate(quizUpsertSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    const quiz = await quizSvc.upsert(lessonId, req.body)
    sendSuccess(res, quiz, 'Quiz saved', 200)
  } catch (err) { next(err) }
})

/* DELETE quiz for a lesson */
router.delete('/lessons/:lessonId/quiz', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    await quizSvc.deleteByLesson(lessonId)
    sendSuccess(res, null, 'Quiz deleted')
  } catch (err) { next(err) }
})

/* Quiz analytics per course */
router.get('/courses/:courseId/quiz-analytics', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const courseId = String(req.params['courseId'] ?? '')
    const data = await quizSvc.analyticsForCourse(courseId)
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

/* ─── Exam management (admin + own-course instructor) ───
   One proctored, timed exam per course. Authorization reuses the same
   course-editable check as quizzes/sections, so it inherits org + ownership
   scoping. Answer keys are visible here (unlike the student routes). */
const examQuestionSchema = z.object({
  id:            z.string().optional(),
  text:          z.string().min(1).max(4000).trim(),
  type:          z.enum(['mcq', 'true_false', 'short', 'essay']),
  choices:       z.array(z.string().max(1000)).optional(),
  correctAnswer: z.string().max(1000).optional(),
  order:         z.coerce.number().int().min(0),
  maxMarks:      z.coerce.number().min(0).max(1000),
  explanation:   z.string().max(2000).optional(),
})

const examUpsertSchema = z.object({
  title:           z.string().min(1).max(200).trim(),
  instructions:    z.string().max(4000).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  passPercent:     z.coerce.number().int().min(0).max(100),
  availableFrom:   z.string().datetime().nullable().optional(),
  availableTo:     z.string().datetime().nullable().optional(),
  maxViolations:   z.coerce.number().int().min(1).max(100),
  antiCheat: z.object({
    blockCopyPaste:    z.boolean(),
    blockRightClick:   z.boolean(),
    screenshotSuspend: z.boolean(),
    tabSwitchSuspend:  z.boolean(),
  }),
  isPublished:     z.boolean(),
  questions:       z.array(examQuestionSchema).min(1),
})

/* GET the exam for a course (admin view — with answer keys). null if none. */
router.get('/courses/:courseId/exam', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const courseId = String(req.params['courseId'] ?? '')
    await sectionSvc.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
    const exam = await examSvc.getForCourse(courseId)
    sendSuccess(res, exam ?? null)
  } catch (err) { next(err) }
})

/* PUT (create or replace) the exam for a course. */
router.put('/courses/:courseId/exam', validate(examUpsertSchema), audit('exam.upsert', 'Exam'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const courseId = String(req.params['courseId'] ?? '')
    await sectionSvc.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
    const exam = await examSvc.upsertForCourse(courseId, req.body)
    sendSuccess(res, exam, 'Exam saved', 200)
  } catch (err) { next(err) }
})

/* DELETE the exam for a course (and its attempts + proctor logs). */
router.delete('/courses/:courseId/exam', audit('exam.delete', 'Exam'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const courseId = String(req.params['courseId'] ?? '')
    await sectionSvc.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
    await examSvc.deleteForCourse(courseId)
    sendSuccess(res, null, 'Exam deleted')
  } catch (err) { next(err) }
})

/* GET every student's attempt on an exam (attempts table / grading queue). */
router.get('/exams/:examId/attempts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const examId = String(req.params['examId'] ?? '')
    const exam = await examSvc.getRaw(examId)
    await sectionSvc.assertCourseEditable(String(exam.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
    const attempts = await examSvc.listAttempts(examId)
    sendSuccess(res, attempts)
  } catch (err) { next(err) }
})

/* GET one attempt in full — answers vs. the key + the proctoring activity log. */
router.get('/exams/:examId/attempts/:attemptId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const examId = String(req.params['examId'] ?? '')
    const exam = await examSvc.getRaw(examId)
    await sectionSvc.assertCourseEditable(String(exam.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
    const detail = await examSvc.getAttemptDetail(examId, String(req.params['attemptId'] ?? ''))
    sendSuccess(res, detail)
  } catch (err) { next(err) }
})

const examGradeSchema = z.object({
  grades: z.array(z.object({
    questionId:   z.string().min(1),
    marksAwarded: z.coerce.number().min(0).max(1000),
    feedback:     z.string().max(2000).optional(),
  })).min(1),
})

/* POST per-question marks + feedback; recomputes total + pass. */
router.post('/exams/:examId/attempts/:attemptId/grade', validate(examGradeSchema), audit('exam.grade', 'ExamAttempt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const examId = String(req.params['examId'] ?? '')
    const exam = await examSvc.getRaw(examId)
    await sectionSvc.assertCourseEditable(String(exam.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
    const result = await examSvc.gradeAttempt(examId, String(req.params['attemptId'] ?? ''), req.body.grades, req.user!.id)
    sendSuccess(res, result, 'Grades saved')
  } catch (err) { next(err) }
})

/* POST reset — deletes the attempt + its logs so the student can retake. */
router.post('/exams/:examId/attempts/:attemptId/reset', audit('exam.reset', 'ExamAttempt'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const examId = String(req.params['examId'] ?? '')
    const exam = await examSvc.getRaw(examId)
    await sectionSvc.assertCourseEditable(String(exam.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
    await examSvc.resetAttempt(examId, String(req.params['attemptId'] ?? ''))
    sendSuccess(res, null, 'Attempt reset')
  } catch (err) { next(err) }
})

/* ─── Assignment management ────────────────────────── */
router.get('/lessons/:lessonId/assignment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    const assignment = await assignSvc.getByLesson(lessonId)
    sendSuccess(res, assignment ?? null)
  } catch (err) { next(err) }
})

router.put('/lessons/:lessonId/assignment', validate(assignUpsertSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    const assignment = await assignSvc.upsert(lessonId, {
      ...req.body,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
    })
    sendSuccess(res, assignment, 'Assignment saved', 200)
  } catch (err) { next(err) }
})

/* List submissions for grading */
router.get('/lessons/:lessonId/assignment/submissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    await sectionSvc.assertLessonEditable(lessonId, req.user!.id, req.user!.role)
    const submissions = await assignSvc.listSubmissions(lessonId)
    sendSuccess(res, submissions)
  } catch (err) { next(err) }
})

/* Grade a submission */
router.patch('/submissions/:id/grade', validate(gradeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { AssignmentSubmissionModel } = await import('@/models/schema.ts')
    const submissionId = String(req.params['id'] ?? '')
    const existing = await AssignmentSubmissionModel.findById(submissionId).select('courseId').lean()
    if (!existing) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }); return
    }
    await sectionSvc.assertCourseEditable(String(existing.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
    const submission = await assignSvc.grade(
      submissionId,
      req.user!.id,
      req.body as { grade: number; feedback?: string },
    )
    sendSuccess(res, submission, 'Submission graded')
  } catch (err) { next(err) }
})

/* ─── Revenue analytics (admin-only) ──────────────── */
const revenueQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
})

router.get('/analytics/revenue', requireAdmin, validate(revenueQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Number(req.query['days'] ?? 30)
    const series = await orderSvc.revenueTimeseries(days, req.user!.organizationId)
    sendSuccess(res, series)
  } catch (err) { next(err) }
})

/* ─── Orders (admin-only) ──────────────────────────── */
const ordersQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
  status:   z.enum(['pending', 'paid', 'refunded', 'cancelled', 'all']).default('all'),
  /* Pinned to the Order schema's own enum so an unknown value is refused here
     rather than quietly matching nothing and reading as "this gateway has
     recorded no orders" — the exact wrong answer for this screen. */
  gateway:  z.enum(['stripe', 'razorpay', 'tabby', 'abzer', 'tamara', 'all']).default('all'),
})

router.get('/orders', requireAdmin, requirePermission('orders','list'), validate(ordersQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, per_page, status, gateway } = req.query as any
    const { docs, totalCount } = await orderSvc.adminList(
      Number(page ?? 1), Number(per_page ?? 20), String(status ?? 'all'),
      req.user!.organizationId, String(gateway ?? 'all'),
    )
    sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, Number(page ?? 1), Number(per_page ?? 20)))
  } catch (err) { next(err) }
})

/* Which gateways have recorded orders, and what each took.

   Declared BEFORE /orders/:id/refund so 'by-gateway' cannot be read as an
   order id. */
router.get('/orders/by-gateway', requireAdmin, requirePermission('orders','list'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await orderSvc.gatewayBreakdown(req.user!.organizationId))
    } catch (err) { next(err) }
  })

router.post('/orders/:id/refund', requireAdmin, requirePermission('orders','update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { Types } = await import('mongoose')
    const orderId   = String(req.params['id'] ?? '')
    if (!Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid order ID' } }); return
    }
    /* Tenancy — a real gateway refund must never be issued against another
       org's order. super_admin is unrestricted; orders that predate
       organizationId stay refundable. */
    const orgId = req.user!.organizationId
    if (req.user!.role !== 'super_admin' && orgId && Types.ObjectId.isValid(orgId)) {
      const { OrderModel } = await import('@/models/schema.ts')
      const owned = await OrderModel.findOne({
        _id: new Types.ObjectId(orderId),
        $or: [
          { organizationId: new Types.ObjectId(orgId) },
          { organizationId: null },
          { organizationId: { $exists: false } },
        ],
      }).select('_id').lean()
      if (!owned) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } }); return
      }
    }
    await orderSvc.refund(orderId)
    sendSuccess(res, null, 'Order refunded')
  } catch (err) { next(err) }
})

/* ─── Coupons (admin-only) ──────────────────────────── */
const couponCreateSchema = z.object({
  code:          z.string().min(2).max(50).trim(),
  discountType:  z.enum(['percent', 'fixed']),
  discountValue: z.coerce.number().positive(),
  maxUses:       z.coerce.number().int().min(0).default(0),
  expiresAt:     z.string().datetime().optional(),
  appliesTo:     z.array(z.string()).default([]),
})
const couponUpdateSchema = couponCreateSchema.partial().extend({
  isActive:  z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

router.get('/coupons', requireAdmin, requirePermission('coupons','list'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
    const { docs, totalCount } = await couponSvc.list(page, per_page, req.user!.organizationId)
    sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
  } catch (err) { next(err) }
})

router.post('/coupons', requireAdmin, requirePermission('coupons','create'), validate(couponCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coupon = await couponSvc.create({ ...req.body, organizationId: req.user!.organizationId })
    sendSuccess(res, coupon, 'Coupon created', 201)
  } catch (err) { next(err) }
})

router.patch('/coupons/:id', requireAdmin, requirePermission('coupons','update'), validate(couponUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coupon = await couponSvc.update(String(req.params['id'] ?? ''), req.body, req.user!.organizationId)
    sendSuccess(res, coupon, 'Coupon updated')
  } catch (err) { next(err) }
})

router.delete('/coupons/:id', requireAdmin, requirePermission('coupons','delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await couponSvc.remove(String(req.params['id'] ?? ''), req.user!.organizationId)
    sendSuccess(res, null, 'Coupon deleted')
  } catch (err) { next(err) }
})

/* Validate a coupon code (student-facing, no auth required — just info) */
router.get('/coupons/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code     = String(req.query['code']     ?? '')
    const courseId = String(req.query['courseId'] ?? '')
    const coupon   = await couponSvc.validate(code, courseId)
    /* Return only non-sensitive fields */
    sendSuccess(res, {
      code:          coupon.code,
      discountType:  coupon.discountType,
      discountValue: coupon.discountValue,
    })
  } catch (err) { next(err) }
})


/* ─────────────────────────────────────────────────────
   MENTOR AVAILABILITY
   GET  /admin/mentors/:id/availability  — fetch slots
   PUT  /admin/mentors/:id/availability  — replace all slots
─────────────────────────────────────────────────────── */
const availabilitySlotSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'),
}).refine(d => d.startTime < d.endTime, { message: 'startTime must be before endTime', path: ['endTime'] })

const availabilityUpdateSchema = z.object({
  slots: z.array(availabilitySlotSchema).max(21, 'Max 3 slots per day (7 days × 3)'),
}).refine(data => {
  const counts: Record<number, number> = {}
  for (const s of data.slots) {
    counts[s.dayOfWeek] = (counts[s.dayOfWeek] ?? 0) + 1
    if ((counts[s.dayOfWeek] as number) > 3) return false
  }
  return true
}, { message: 'Maximum 3 slots per day of week' })

router.get('/mentors/:id/availability', requireInstructor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MentorAvailabilityModel } = await import('@/models/schema.ts')
    const mentorId = String(req.params['id'] ?? '')
    // Instructors can only read their own availability
    if (req.user!.role === 'instructor' && req.user!.id !== mentorId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot view another mentor\'s availability' } }); return
    }
    /* The self-check above only binds instructors — every other staff role
       fell through to any mentor in either academy (P-17). */
    if (req.user!.id !== mentorId && !(await callerMayAccessUser(req, mentorId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mentor not found' } }); return
    }
    const avail = await MentorAvailabilityModel.findOne({ mentorId }).lean({ virtuals: true })
    sendSuccess(res, avail ?? { mentorId, slots: [] })
  } catch (err) { next(err) }
})

/* GET /admin/mentors/:id/meetings — what has been booked with this mentor.

   Guarded exactly like the availability routes beside it: an instructor sees
   their own and nobody else's, and any other staff role is held to whichever
   academies they may reach. A meeting names an outside client by name and
   email, which is somebody's contact detail and not a thing to leave open to
   whoever guesses an id.

   These are booked from the Root portal, so without this an instructor would
   learn about their own week only from the email they were sent. */
router.get('/mentors/:id/meetings', requireInstructor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MentorMeetingModel } = await import('@/models/schema.ts')
    const mentorId = String(req.params['id'] ?? '')
    if (req.user!.role === 'instructor' && req.user!.id !== mentorId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot view another mentor\'s meetings' } }); return
    }
    if (req.user!.id !== mentorId && !(await callerMayAccessUser(req, mentorId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mentor not found' } }); return
    }

    /* Defaults to what is still to come. A mentor opening this wants to know
       what is in front of them; the past is a different question. */
    const from = typeof req.query['from'] === 'string' ? new Date(req.query['from']) : new Date()
    const to = typeof req.query['to'] === 'string'
      ? new Date(req.query['to'])
      : new Date(Date.now() + 60 * 864e5)

    const meetings = await MentorMeetingModel.find({
      mentorId,
      scheduledStart: { $gte: from, $lte: to },
      cancelledAt: null,
    }).sort({ scheduledStart: 1 }).lean()

    sendSuccess(res, meetings.map(m => ({
      id: String(m._id),
      title: m.title,
      kind: m.kind,
      startsAt: new Date(m.scheduledStart).toISOString(),
      durationMins: m.durationMins,
      /* The mentor's own view, so the full list with addresses: they are the
         one person who may need to reach the people they are meeting. */
      attendees: (m.attendees ?? []).map(a => ({ name: a.name, email: a.email ?? '' })),
      meetingUrl: m.meetingUrl ?? '',
      notes: m.notes ?? '',
      bookedByEmail: m.bookedByEmail,
    })))
  } catch (err) { next(err) }
})

router.put('/mentors/:id/availability', requireInstructor, validate(availabilityUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MentorAvailabilityModel } = await import('@/models/schema.ts')
    const mentorId = String(req.params['id'] ?? '')
    // Instructors can only update their own availability
    if (req.user!.role === 'instructor' && req.user!.id !== mentorId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot edit another mentor\'s availability' } }); return
    }
    /* PUT REPLACES the whole schedule, so an unscoped staff role could wipe a
       neighbouring academy's mentor calendar with no undo (P-17). */
    if (req.user!.id !== mentorId && !(await callerMayAccessUser(req, mentorId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mentor not found' } }); return
    }
    const { slots } = req.body as { slots: Array<{ dayOfWeek: number; startTime: string; endTime: string }> }
    const avail = await MentorAvailabilityModel.findOneAndUpdate(
      { mentorId },
      { mentorId, slots },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean({ virtuals: true })
    sendSuccess(res, avail, 'Availability updated')
  } catch (err) { next(err) }
})

/* Own availability — instructor shortcut (GET/PUT /availability/me) */
/* These are registered on the instructor sub-router in instructor.routes.ts if it exists,
   but we also expose them here so admin portal can use the same endpoints */
router.get('/availability/me', requireInstructor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MentorAvailabilityModel } = await import('@/models/schema.ts')
    const mentorId = req.user!.id
    const avail = await MentorAvailabilityModel.findOne({ mentorId }).lean({ virtuals: true })
    sendSuccess(res, avail ?? { mentorId, slots: [] })
  } catch (err) { next(err) }
})

router.put('/availability/me', requireInstructor, validate(availabilityUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MentorAvailabilityModel } = await import('@/models/schema.ts')
    const mentorId = req.user!.id
    const { slots } = req.body as { slots: Array<{ dayOfWeek: number; startTime: string; endTime: string }> }
    const avail = await MentorAvailabilityModel.findOneAndUpdate(
      { mentorId },
      { mentorId, slots },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean({ virtuals: true })
    sendSuccess(res, avail, 'Availability updated')
  } catch (err) { next(err) }
})

/* ─────────────────────────────────────────────────────
   ADMIN BOOKING ROSTER
   GET  /admin/bookings — list all bookings (filter by liveClassId, userId)
   PATCH /admin/bookings/:id/attendance — mark attended/missed
─────────────────────────────────────────────────────── */
const bookingQuerySchema = z.object({
  liveClassId:  z.string().optional(),
  userId:       z.string().optional(),
  status:       z.enum(['booked', 'attended', 'missed', 'cancelled']).optional(),
  instructorId: z.string().optional(),
  courseId:     z.string().optional(),
  language:     z.string().optional(),
  /* Parseable dates only. These are handed straight to `new Date()` and then
     into a Mongo range query; an unparseable string becomes an Invalid Date,
     which Mongoose rejects with a CastError, which is not a registered error
     class — so `?dateFrom=notadate` answered 500 "An unexpected error
     occurred" instead of telling the caller the date was wrong. */
  dateFrom:     z.string().refine(s => !Number.isNaN(Date.parse(s)), 'Invalid date').optional(),
  dateTo:       z.string().refine(s => !Number.isNaN(Date.parse(s)), 'Invalid date').optional(),
  /* Free-text across the student (name/email) and the session title. Used to
     live only in the browser, over the ONE page already loaded — so searching a
     student whose booking sat on page 2 answered "No bookings found" for a
     booking that plainly exists. */
  q:            z.string().trim().min(2).max(120).optional(),
  /* The actionable slice of `booked`: sessions that have already run and were
     never marked. Deliberately NOT a member of the status enum — it is a
     status AND a tense, and no single stored field carries both. */
  needsMarking: z.enum(['true']).optional(),
  /* Delivery. Same story as `q`: the toggle filtered the loaded page only.
     In-person is isOnline === false; online is anything else, because older
     rows predate the field. */
  isOnline:     z.enum(['true', 'false']).optional(),
  /* scheduledStart lives on LiveClass, not on the booking, so ordering by it
     needs an aggregate — see the two paths in GET /bookings. It matters because
     the console GROUPS BY SESSION DAY: ordered by bookedAt, a day's seats are
     scattered across pages, so the same date heading appears on page 1 and
     page 3 with a different count each time. */
  sort:         z.enum(['-bookedAt', 'bookedAt', 'status', 'scheduledStart', '-scheduledStart']).default('-bookedAt'),
  page:         z.coerce.number().int().min(1).default(1),
  per_page:     z.coerce.number().int().min(1).max(200).default(50),
})

/* Both ends of a day range, built the same way.

   dateFrom went through `new Date('2026-09-17')` — UTC midnight — while dateTo
   used setHours(23,59,59,999), which is the SERVER's local midnight. East of
   UTC the two boundaries disagreed by the offset, so early-morning classes fell
   through the gap between one day's end and the next day's start. */
function dayRangeBounds(from?: string, to?: string): { $gte?: Date; $lte?: Date } {
  const out: { $gte?: Date; $lte?: Date } = {}
  const dateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (from) out.$gte = dateOnly(from) ? new Date(`${from}T00:00:00.000Z`) : new Date(from)
  if (to)   out.$lte = dateOnly(to)   ? new Date(`${to}T23:59:59.999Z`)   : new Date(to)
  return out
}

/* A user-supplied string going into a RegExp is a wildcard until it is escaped:
   ".*" would match every student on the platform. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* The ONE place the bookings scope is computed.

   The list and the stats endpoint must apply IDENTICAL organisation,
   instructor and programme scoping. A second hand-rolled copy is exactly how
   the courseId bypass got in, so there is deliberately only one.

   Returns null when the caller asked for something outside their scope; both
   routes answer that as an empty result rather than a 403, which would confirm
   the resource exists. */
async function buildBookingFilter(
  req: Request,
  q: z.infer<typeof bookingQuerySchema>,
): Promise<Record<string, any> | null> {
  const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')

  /* ── Step 1: Build live-class filter (instructor scope + date + courseId) ── */
  const lcFilter: Record<string, any> = {}

  // Instructors only see their own classes
  const isInstructor = req.user!.role === 'instructor'
  if (isInstructor) {
    lcFilter['instructorId'] = new Types.ObjectId(req.user!.id)
  } else if (q.instructorId && Types.ObjectId.isValid(q.instructorId)) {
    lcFilter['instructorId'] = new Types.ObjectId(q.instructorId)
  }

  /* Org isolation — scoped users only see their own academy's classes.

     NOT stacked on top of the instructor clause above. That clause already
     narrows to sessions naming the caller, and assignment is narrower than the
     academy, so adding this one can only subtract rows that are genuinely
     theirs — which emptied the roster, the stats strip and the CSV export for
     a LENT instructor's borrowing-academy class. See instructorOwnsSession in
     utils/tenancy.ts.

     Kept for every other role, including when an admin filters by some other
     instructor via q.instructorId: there the academy is still the only wall.

     RESOLVED, NOT READ BLIND. This used to read req.user!.organizationId
     directly, and when that field was absent it added NO org clause at all —
     handing the caller an unscoped roster of BOTH academies, with names and
     emails, through the list, the stats strip and the CSV export. That is the
     literal N-07 shape. A caller with no record is refused outright; a caller
     genuinely without an academy stays unscoped, which is rule 3b and
     deliberate. */
  let callerOrgId: string | null = null
  if (!isInstructor) {
    const caller = await callerOrgForRead(req)
    if (caller.gone) return null
    callerOrgId = caller.org
    if (caller.org && Types.ObjectId.isValid(caller.org)) {
      /* WIDEN: classes this academy OWNS, plus shared classes that name it as a
         guest cohort. Composed under $and, never by assigning $or — the
         free-text search below assigns filter.$or and the status buckets in
         liveClass.repository.ts assign query.$or, and a second assignment
         silently deletes the first. That is the P-04 shape. */
      andFilter(lcFilter, servedClassFilter(caller.org))
    }
  }

  /* A COURSE IS JUDGED AGAINST THE CALLER'S OWN DOOR, NEVER THE HOST'S.

     Both course clauses below used to be written straight onto
     `lcFilter.courseId`, which is the class's HOST course — the one belonging
     to the academy that scheduled it. A guest academy reaches the same class
     through its OWN course, named in `guestCohorts[].courseId`, and nothing
     requires the two to share a programme (liveClass.service.ts says so in as
     many words: the cohort course's programme "is a hint for the picker and
     can never be the check"). So the class was widened into scope at :2124 and
     then dropped again one clause later, and a Bangalore admin who picked
     their own course from the dropdown — or who is simply programme-scoped —
     got an empty roster, a zero stats strip and an empty CSV for a class their
     own students are sitting in, with no way to mark that cohort present.

     Same two-arm shape as liveClass.repository.ts's categoryCourseFilter, and
     the guest arm carries the same feature gate for the same reason: with the
     switch off a guest academy must not reach the class at all, and a filter
     that widens while entitlement refuses produces a row that is visible and
     unbookable. An instructor caller keeps callerOrgId === null and so keeps
     today's host-only behaviour byte for byte. */
  const courseDoorFilter = (clause: unknown): Record<string, unknown> =>
    CROSS_ORG_CLASSES_ENABLED && callerOrgId && Types.ObjectId.isValid(callerOrgId)
      ? { $or: [
          { courseId: clause },
          { guestCohorts: { $elemMatch: {
            organizationId: new Types.ObjectId(callerOrgId),
            courseId: clause,
          } } },
        ] }
      : { courseId: clause }

  // Programme-scoped admins (sub_admin) only see their program's bookings
  const scope = (req.user as any)?.categoryScope as string | undefined
  let scopedCourseIds: MongoTypes.ObjectId[] | null = null
  if (scope) {
    const { CourseModel } = await import('@/models/schema.ts')
    const scopedCourses = await CourseModel.find({ program: scope }, '_id').lean()
    scopedCourseIds = scopedCourses.map((c: any) => c._id)
    andFilter(lcFilter, courseDoorFilter({ $in: scopedCourseIds }))
  }

  /* Narrow to one course — but INTERSECT with the programme scope, never
     replace it. This used to apply the scope only `if (!q.courseId)` and then
     assign straight over `lcFilter.courseId`, so a programme-scoped sub_admin
     who passed another programme's course id got that course's full roster,
     with every student's name and email. Same rule as the liveClassId guard
     below (P-04): "more specific" has to mean narrower, never wider. */
  if (q.courseId && Types.ObjectId.isValid(q.courseId)) {
    const requested = new Types.ObjectId(q.courseId)
    const inScope   = !scopedCourseIds || scopedCourseIds.some(id => String(id) === String(requested))
    if (!inScope) return null   // out of scope → caller sees an empty result
    /* Composed under $and rather than assigned over the programme clause, which
       is what keeps "more specific means narrower" true now that both clauses
       are $or shapes: assigning would delete the programme scope outright. The
       inScope guard above has already proved the request is inside it, so the
       intersection is the same set it was, one door wider. */
    andFilter(lcFilter, courseDoorFilter(requested))
  }

  if (q.language) {
    lcFilter['language'] = q.language
  }

  /* In-person is isOnline === false. Online is "not false" rather than true,
     because rows created before the field existed have it unset. */
  if (q.isOnline === 'false')     lcFilter['isOnline'] = false
  else if (q.isOnline === 'true') lcFilter['isOnline'] = { $ne: false }

  // For cancelled bookings the date range applies to cancelledAt (not scheduledStart)
  if ((q.dateFrom || q.dateTo) && q.status !== 'cancelled') {
    lcFilter['scheduledStart'] = dayRangeBounds(q.dateFrom, q.dateTo)
  }

  /* Spread the existing bound rather than assigning over it: both this and the
     date range above write `scheduledStart`, and an overwrite would silently
     drop whichever ran first — widening the result instead of narrowing it. */
  if (q.needsMarking === 'true') {
    lcFilter['scheduledStart'] = { ...(lcFilter['scheduledStart'] as object ?? {}), $lt: new Date() }
  }

  /* ── Step 2: Resolve live-class IDs if needed ── */
  const filter: Record<string, any> = {}
  /* organizationId comes back too, so the seat narrowing below can tell a class
     the caller OWNS from one they are merely a guest on. An unstamped seat
     belongs to the host, and only the host may see it. */
  let ownedLcIds: unknown[] = []
  if (Object.keys(lcFilter).length > 0) {
    const matchingLcs = await LiveClassModel.find(lcFilter, '_id organizationId').lean()
    filter['liveClassId'] = { $in: matchingLcs.map((l: any) => l._id) }
    if (callerOrgId) {
      ownedLcIds = matchingLcs
        .filter((l: any) => String(l.organizationId ?? '') === String(callerOrgId))
        .map((l: any) => l._id)
    }
  }

  /* Narrow to one session — but INTERSECT with the scoped set, never replace
     it (P-04). This used to assign straight over `filter['liveClassId']`,
     discarding the organisation and instructor scoping resolved above, so
     passing another academy's session id returned its full roster with every
     student's name and email. "More specific" has to mean narrower. */
  if (q.liveClassId && Types.ObjectId.isValid(q.liveClassId)) {
    const requested = new Types.ObjectId(q.liveClassId)
    const scoped    = filter['liveClassId'] as { $in?: unknown[] } | undefined
    const inScope   = !scoped?.$in || scoped.$in.some(id => String(id) === String(requested))
    if (!inScope) return null   // out of scope → caller sees an empty result
    filter['liveClassId'] = requested
  }
  /* NARROW: on a shared class, each academy sees ONLY ITS OWN SEATS — and that
     includes the academy that owns the class.

     Without this, the feature reintroduces N-07 verbatim. The booking query has
     no organisation term of its own, it populates name, email and avatar, and
     it feeds the list, the stats strip AND the CSV export. One shared class
     would put every guest academy's student, by name and email, into the host's
     roster and download in a single request.

     Strictly narrower than today and a no-op on every existing row: no foreign
     student can hold a seat yet, and an unstamped seat is the host's own.

     THE ASSIGNED INSTRUCTOR IS THE ONE EXCEPTION, and they are excluded above
     by isInstructor — they already see the whole room through
     instructorOwnsSession, because assignment is narrower than the academy.
     Somebody has to be able to see everyone in the class they are running. It
     is the only cross-academy PII flow this feature accepts, it is one person
     per class, and it is a judgement call rather than a derivation. */
  if (!isInstructor && callerOrgId && Types.ObjectId.isValid(callerOrgId)) {
    const oid = new Types.ObjectId(callerOrgId)
    filter['$and'] = [
      ...((filter['$and'] as unknown[]) ?? []),
      { $or: [
        /* Seats explicitly stamped with this academy's door. */
        { seatOrganizationId: oid },
        /* An UNSTAMPED seat is the host's: it was taken before the class was
           ever shared, or on a class that has no allocation at all — which is
           every booking that exists today. So it is visible only on classes
           this caller OWNS. Matching it unconditionally would have shown a
           guest academy's admin the host's entire legacy roster, which is the
           leak this narrowing exists to prevent, reintroduced by the fix. */
        { seatOrganizationId: { $exists: false }, liveClassId: { $in: ownedLcIds } },
      ] },
    ]
  }

  if (q.userId && Types.ObjectId.isValid(q.userId)) filter['userId'] = new Types.ObjectId(q.userId)
  if (q.status) filter['status'] = q.status

  /* needsMarking IS `booked`, narrowed to the past by the lcFilter above.
     Pairing it with any other status is a contradiction, so answer empty
     rather than letting one of the two quietly win. */
  if (q.needsMarking === 'true') {
    if (q.status && q.status !== 'booked') return null
    filter['status'] = 'booked'
  }

  // Cancelled bookings: apply date range to cancelledAt instead of scheduledStart
  if (q.status === 'cancelled' && (q.dateFrom || q.dateTo)) {
    filter['cancelledAt'] = dayRangeBounds(q.dateFrom, q.dateTo)
  }

  /* Free-text search, server-side so it sees the whole result set and not
     just the page the browser happens to hold. Matches the student's name or
     email, OR the session title. The title arm is intersected with lcFilter
     first, so a search can only ever narrow what the caller may already see —
     it can never reach outside their organisation or programme scope. */
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i')
    const [people, titled] = await Promise.all([
      UserModel.find({ $or: [{ name: rx }, { email: rx }] }, '_id').limit(1000).lean(),
      LiveClassModel.find({ ...lcFilter, title: rx }, '_id').lean(),
    ])
    filter['$or'] = [
      { userId:      { $in: people.map((u: any) => u._id) } },
      { liveClassId: { $in: titled.map((l: any) => l._id) } },
    ]
  }

  return filter
}

router.get('/bookings', requireInstructor, requirePermission('bookings','list'), validate(bookingQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const q = req.query as unknown as z.infer<typeof bookingQuerySchema>

    const filter = await buildBookingFilter(req, q)
    if (!filter) {
      sendSuccess(res, [], undefined, 200,
        buildPaginationMeta(0, Number(q.page) || 1, Number(q.per_page) || 50))
      return
    }

    /* ── Step 3: Fetch bookings with rich populate ── */
    const page     = Number(q.page)     || 1
    const per_page = Number(q.per_page) || 50
    const skip     = (page - 1) * per_page

    /* One spec, used by both ordering paths below, so they can never drift into
       returning differently-shaped rows. */
    const POPULATE = [
      { path: 'userId', select: 'id name email avatarUrl' },
      {
        path:     'liveClassId',
        select:   'id title scheduledStart durationMins language courseId sectionId instructorId isOnline location room',
        populate: [
          { path: 'courseId',     select: 'id title' },
          { path: 'sectionId',    select: 'id title' },
          { path: 'instructorId', select: 'id name avatarUrl' },
        ],
      },
    ] as any

    const byStart = q.sort === 'scheduledStart' || q.sort === '-scheduledStart'

    let docs: any[]
    let total: number

    if (byStart) {
      /* scheduledStart is on the joined class, so the ordering has to happen in
         an aggregate. Only ids are ordered and paged here; the rows themselves
         are fetched through the same populate spec as the ordinary path, rather
         than rebuilding that projection out of $lookup stages. */
      const dir = q.sort === 'scheduledStart' ? 1 : -1
      const ordered = await ClassBookingModel.aggregate([
        { $match: filter },
        { $lookup: {
            from:     'liveclasses',
            let:      { lc: '$liveClassId' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$lc'] } } },
              { $project: { scheduledStart: 1 } },
            ],
            as: 'lc',
        } },
        { $addFields: { _start: { $first: '$lc.scheduledStart' } } },
        /* _id breaks ties. Two seats on the SAME session share a start time, so
           without it Mongo may order them differently between one page and the
           next — which silently drops some rows from a paginated walk and
           repeats others. The CSV export walks every page, so that would have
           produced a file with duplicates and holes. */
        { $sort: { _start: dir, _id: 1 } },
        { $skip: skip }, { $limit: per_page },
        { $project: { _id: 1 } },
      ])

      const ids = ordered.map((o: any) => o._id)
      const fetched = ids.length
        ? await ClassBookingModel.find({ _id: { $in: ids } }).populate(POPULATE).lean({ virtuals: true })
        : []
      /* $in does not preserve the order it was given, so restore the one the
         aggregate decided. */
      const byId = new Map(fetched.map((d: any) => [String(d._id), d]))
      docs  = ids.map((i: any) => byId.get(String(i))).filter(Boolean)
      total = await ClassBookingModel.countDocuments(filter)
    } else {
      const [rows, count] = await Promise.all([
        ClassBookingModel.find(filter)
          .populate(POPULATE)
          .sort(q.sort === 'bookedAt' ? { bookedAt: 1 } : q.sort === 'status' ? { status: 1, bookedAt: -1 } : { bookedAt: -1 })
          .skip(skip).limit(per_page)
          .lean({ virtuals: true }),
        ClassBookingModel.countDocuments(filter),
      ])
      docs  = rows
      total = count
    }

    const withId = (d: any) => ({ ...d, id: d.id ?? String(d._id) })
    /* sendSuccess, not res.json.

       The populate above pulls avatarUrl for the student AND for the session's
       instructor. Those are stored as pub-*.r2.dev URLs, and that bucket is
       private now, so the browser gets a 401 and the avatar falls back to an
       initial. sendSuccess is what rewrites them onto the /assets proxy; a raw
       res.json skips it and the failure is silent -- the JSON looks right and
       only the picture is missing. */
    /* buildPaginationMeta rather than a hand-rolled object: the raw res.json
       this replaces omitted has_next / has_prev, so this endpoint was quietly
       returning a different meta shape from every paginated route beside it.
       The type checker only noticed once it went through the typed helper. */
    sendSuccess(res, docs.map(withId), undefined, 200, buildPaginationMeta(total, page, per_page))
  } catch (err) { next(err) }
})

/* ── Stats for the CURRENT filter, not the current page ───
   The console's stats strip, its row counter and its CSV were all computed from
   the array the browser held — one page, capped at per_page — so a filter
   matching 2,340 bookings proudly reported "150", and paging forward reported
   "150" again. total_count was already in the response meta and simply never
   read. This returns the real figures for the whole filtered set in one $group,
   using the SAME scope builder as the list so the two can never disagree. */
router.get('/bookings/stats', requireInstructor, requirePermission('bookings', 'list'),
  validate(bookingQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const q = req.query as unknown as z.infer<typeof bookingQuerySchema>

    const empty = { total: 0, booked: 0, upcoming: 0, unmarked: 0, attended: 0, missed: 0, cancelled: 0, attendanceRate: 0 }
    const filter = await buildBookingFilter(req, q)
    if (!filter) { sendSuccess(res, empty); return }

    /* `booked` is a status, not a tense: a seat stays `booked` forever if nobody
       ever marks attendance. Counting all of them as "upcoming" made a console
       full of un-marked past sessions look perfectly healthy, which is exactly
       backwards — those are the rows that need an admin. So split the bucket on
       the session's own start time. `scheduledStart` lives on the class, not the
       booking, so join it in; the projection keeps that join to one field. */
    const now = new Date()
    const grouped = await ClassBookingModel.aggregate([
      { $match: filter },
      { $lookup: {
          from:     'liveclasses',
          let:      { lc: '$liveClassId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$lc'] } } },
            { $project: { scheduledStart: 1 } },
          ],
          as: 'lc',
      } },
      /* $gt against a missing start date is false, so a class row without one
         lands in the past bucket rather than escaping both. (A booking whose
         class was deleted outright never reaches here — buildBookingFilter
         resolves class ids up front, so it is already out of the filter.) */
      { $group: {
          _id: {
            status: '$status',
            future: { $gt: [{ $first: '$lc.scheduledStart' }, now] },
          },
          n: { $sum: 1 },
      } },
    ])

    const sum = (pred: (id: any) => boolean) =>
      grouped.reduce((acc: number, g: any) => acc + (pred(g._id) ? g.n : 0), 0)

    const by       = (s: string) => sum(id => id.status === s)
    const attended = by('attended')
    const missed   = by('missed')
    /* Of the seats whose outcome is actually known. Dividing by `total` would
       drag the rate down with every future booking that simply has not happened
       yet, which reads as a collapsing attendance rate. */
    const decided  = attended + missed
    sendSuccess(res, {
      total:     grouped.reduce((s: number, g: any) => s + g.n, 0),
      booked:    by('booked'),
      /* booked === upcoming + unmarked, always. */
      upcoming:  sum(id => id.status === 'booked' && id.future === true),
      unmarked:  sum(id => id.status === 'booked' && id.future !== true),
      attended,
      missed,
      cancelled: by('cancelled'),
      attendanceRate: decided ? Math.round((attended / decided) * 100) : 0,
    })
  } catch (err) { next(err) }
})

/* ── Cancel a booking on a student's behalf ───────────────
   There was no admin path to cancel a booking anywhere in the product: the
   only cancel is DELETE /bookings/:id, which is student-only and matches on
   {_id, userId}. So a seat taken by mistake, or by a student who has since lost
   access, could never be released and the session stayed full.

   Mirrors the student route exactly — atomic booked→cancelled so a repeated
   cancel releases the seat once, then a floor-guarded decrement — and reuses
   the attendance route's tenancy rule (404 across an academy boundary, never a
   403 that would confirm the id exists elsewhere). */
router.patch('/bookings/:id/cancel', requireInstructor, requirePermission('bookings', 'update'),
  audit('booking.cancel', 'ClassBooking', r => String(r.params['id'] ?? '')),
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel, UserModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')

    const existing = await ClassBookingModel.findById(id)
      .select('liveClassId userId status seatPoolKind seatOrganizationId').lean()
    /* The seat guard, not the session guard: a guest academy must be able to
       release its OWN student's seat on a shared class. Managing the class
       itself stays with the owner. */
    if (!existing || !(await callerMayManageSeat(req, existing))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } }); return
    }
    if (existing.status !== 'booked') {
      res.status(400).json({ success: false, error: { code: 'CANNOT_CANCEL', message: 'Only active bookings can be cancelled' } }); return
    }

    const cancelled = await ClassBookingModel.updateOne(
      { _id: id, status: 'booked' },
      { status: 'cancelled', cancelledAt: new Date() },
    )
    if (cancelled.modifiedCount === 0) {
      res.status(400).json({ success: false, error: { code: 'CANNOT_CANCEL', message: 'Only active bookings can be cancelled' } }); return
    }

    /* Back to the pool the seat was TAKEN from, read off the booking row —
       never re-derived, because the student's door may have changed since. */
    await releaseSeat(existing as any)

    sendSuccess(res, null, 'Booking cancelled')

    /* Tell the student, non-blocking — an admin cancelling silently is how a
       student turns up to a class they no longer hold a seat for. */
    void (async () => {
      try {
        const [student, lc] = await Promise.all([
          /* organizationId, or the academy clock below has nothing to resolve
             and silently renders in the server's zone — the cache warmed a few
             lines down was being queried for a field that never arrived. */
          UserModel.findById(existing.userId).select('name email organizationId').lean(),
          LiveClassModel.findById(existing.liveClassId).select('title scheduledStart').lean(),
        ])
        const title = (lc as any)?.title ?? 'Session'
        const start = (lc as any)?.scheduledStart ? new Date((lc as any).scheduledStart) : null
        /* Warmed BEFORE the first orgSlugFor read below, not after it.
           orgSlugFor is synchronous and answers undefined from a cold cache,
           so a warm that runs later in the handler leaves the bell rendering
           in the default zone on the first request after every boot — and the
           mail two lines further on rendering correctly, disagreeing with it. */
        await ensureOrgSlugs()

        /* In-app notification FIRST, and unconditionally. The student path
           (afterBookingCancelled in bookings.routes.ts) always creates one, and
           this path created none at all — so a seat released by an admin left no
           trace in the bell, and a student with no working mailbox had no way to
           learn about it. It also does not depend on a mail server being up. */
        const dateLabel = start
          /* The STUDENT's academy, not the server's. This was pinned to Dubai
             with timeStyle 'short', which emits no zone at all, so a Bangalore
             student read a Dubai time and nothing said so. */
          ? academyClock(start, orgSlugFor((student as { organizationId?: unknown }).organizationId)).full
          : 'its scheduled date'
        const { NotificationService: NotifSvc } = await import('@/services/notification.service.ts')
        await new NotifSvc().create(String(existing.userId), {
          kind:  'booking-cancelled',
          title: `Booking cancelled: ${title}`,
          body:  `Your booking for ${title} on ${dateLabel} has been cancelled.`,
          link:  SCHEDULE_LINK,
        }).catch(() => { /* non-fatal */ })

        if (!student || !(student as any).email) return
        const { sendCancelledNotification } = await import('@/services/email.service.ts')
        /* The raw Date, NOT a formatted string. This argument is typed
           `Date | string` and the template re-parses it with new Date()
           (email.service.ts:1238). A localized label like "Thursday, September
           17, 2026 at 10:00 PM" is not a parseable date, so the mail went out
           reading "your scheduled class on Invalid Date at Invalid Date has
           been cancelled". The type accepted it; only the output showed it. */
        await sendCancelledNotification(
          (student as any).email,
          (student as any).name ?? '',
          title,
          start ?? new Date(),
          orgSlugFor((student as any).organizationId),
        )
      } catch {
        /* Non-fatal: the seat is already released and the caller already has
           its 200. A failed courtesy email must not undo a completed cancel. */
      }
    })()
  } catch (err) { next(err) }
})

const attendanceUpdateSchema = z.object({
  status: z.enum(['attended', 'missed']),
})

/* ── Mark a whole selection at once ─────────────────────
   Attendance could only be set one seat at a time, so a session that ran with
   thirty students meant thirty clicks — which is why so many past sessions were
   simply never marked (see the `unmarked` bucket in /bookings/stats).

   Not a loop over the single-seat route: that would re-run the tenancy check
   per booking, and a partial failure halfway through would leave the roster
   split between marked and unmarked with no way to tell where it stopped. */
const bulkAttendanceSchema = z.object({
  /* Capped so one request cannot be turned into an unbounded scan. The UI
     selects at most a page. */
  ids:    z.array(z.string()).min(1).max(200),
  status: z.enum(['attended', 'missed']),
})

router.patch('/bookings/bulk-attendance', requireInstructor, requirePermission('bookings', 'update'),
  validate(bulkAttendanceSchema),
  audit('booking.bulkAttendance', 'ClassBooking', () => 'bulk'),
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { ids, status } = req.body as { ids: string[]; status: 'attended' | 'missed' }

    const valid = [...new Set(ids)].filter(i => Types.ObjectId.isValid(i)).map(i => new Types.ObjectId(i))
    if (valid.length === 0) { sendSuccess(res, { updated: 0, skipped: ids.length }, 'Nothing to update'); return }

    const docs = await ClassBookingModel.find(
      { _id: { $in: valid } },
      '_id liveClassId status seatOrganizationId',
    ).lean()

    /* Memoise per (SESSION, SEAT ACADEMY), not per session.

       Keying on the session alone was correct while one class had one roster.
       On a shared class it decides once for the first row it happens to see and
       applies that answer to every other row of the same class — so one
       academy's admin would sweep the OTHER academy's students into attendance
       on the strength of a permission they never had for those seats. The key
       has to carry everything the decision depends on. */
    const bySeatScope = new Map<string, boolean>()
    for (const d of docs) {
      const key = `${String((d as any).liveClassId ?? '')}:${String((d as any).seatOrganizationId ?? '')}`
      if (!bySeatScope.has(key)) bySeatScope.set(key, await callerMayManageSeat(req, d as never))
    }

    /* Only seats that are still undecided. Sweeping a CANCELLED seat back to
       'attended' would resurrect a booking the student released and re-consume
       the capacity that was given back — and 'attended' feeds the 2x-attendance
       cap, so it can lock them out of a class they never took. Out-of-scope ids
       are skipped rather than refused, matching the 404-not-403 rule: the
       response must not confirm that an id exists in another academy. */
    const allowed = docs
      .filter(d => bySeatScope.get(
        `${String((d as any).liveClassId ?? '')}:${String((d as any).seatOrganizationId ?? '')}`,
      ) === true && (d as any).status === 'booked')
      .map(d => (d as any)._id)

    /* `status: 'booked'` repeated in the filter, so a seat cancelled between
       the read above and this write is still not swept up. */
    const result = allowed.length
      ? await ClassBookingModel.updateMany({ _id: { $in: allowed }, status: 'booked' }, { status })
      : { modifiedCount: 0 }
    const updated = result.modifiedCount ?? 0

    sendSuccess(res, { updated, skipped: ids.length - updated },
      updated === 0 ? 'Nothing to update' : `Marked ${updated} ${status}`)
  } catch (err) { next(err) }
})

router.patch('/bookings/:id/attendance', requireInstructor, requirePermission('bookings','update'), validate(attendanceUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')
    const { status } = req.body as { status: 'attended' | 'missed' }

    /* Tenancy + ownership before the write (P-05). Attendance is not cosmetic:
       'attended' feeds the 2×-attendance cap in POST /bookings, so a forged
       mark can lock a student out of a class they never took — and the
       response carries their name and email. Answers 404 across an academy
       boundary so the endpoint never confirms the id exists elsewhere. */
    const existing = await ClassBookingModel.findById(id)
      .select('liveClassId seatOrganizationId').lean()
    /* The seat guard: a guest academy marks its own students present. */
    if (!existing || !(await callerMayManageSeat(req, existing))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } }); return
    }

    /* status: 'booked' IN THE FILTER, the guard the bulk sibling already has.
       Without it, marking a CANCELLED seat 'attended' resurrects a booking the
       student released — the seat was given back at cancel, and this hands it
       out again without taking it from any pool, so the room ends up holding
       more seats than it has. 'attended' also feeds the attendance history, so
       it can credit a class the student never took. */
    /* findOneAndUpdate, NOT findByIdAndUpdate. This was written as
       findByIdAndUpdate with the filter object passed where the ID goes, forced
       past the compiler with `as never` — and mongoose pulls `_id` out of that
       object and DISCARDS everything else, so the status clause above was never
       applied. Measured: a seat stored as 'cancelled' came back as a document
       and was written to 'attended'. The `as never` is the tell; a cast whose
       only job is to silence an argument-type error is usually silencing the
       bug as well.

       Everything the comment above describes therefore happened: a released
       seat was resurrected without being taken from any pool, so the room held
       more seats than it has, and the student was credited with a class they
       never took — which then counts against the 2x-attendance cap on their
       next booking. */
    const booking = await ClassBookingModel.findOneAndUpdate(
      { _id: id, status: { $in: ['booked', 'attended', 'missed'] } },
      { status },
      { new: true },
    ).populate('userId', 'id name email').lean({ virtuals: true })
    if (!booking) {
      res.status(400).json({
        success: false,
        error: { code: 'CANNOT_MARK', message: 'Only a live booking can be marked. This seat was cancelled.' },
      }); return
    }
    sendSuccess(res, { ...(booking as any), id: (booking as any).id ?? String((booking as any)._id) }, 'Attendance updated')
  } catch (err) { next(err) }
})

/* ─────────────────────────────────────────────────────
   REPORTS
   GET /admin/reports/attendance?from=&to=
─────────────────────────────────────────────────────── */
router.get('/reports/attendance', requireInstructor, requirePermission('reports','read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { from, to } = req.query as Record<string, string>
    const filter: Record<string, any> = {}
    if (from || to) {
      filter['bookedAt'] = {}
      if (from) filter['bookedAt']['$gte'] = new Date(from)
      if (to)   filter['bookedAt']['$lte'] = new Date(to)
    }
    /* Resolved ONCE, above both scopes. The class scope below used to read
       req.user!.organizationId blind while the row scope resolved the same
       academy through callerOrgForRead, so on a token minted without the field
       the two disagreed: the class set went unscoped while the rows did not.
       One resolution, one answer. */
    const reportCaller = await callerOrgForRead(req)
    if (reportCaller.gone) { sendSuccess(res, []); return }

    /* Scope the sessions this caller may report on, then resolve to ids.
       Org isolation was here; the INSTRUCTOR scope was not (P-13), so an
       instructor received every student's attendance across the whole academy
       — name, email and per-session counts — where /admin/bookings correctly
       narrows them to their own classes. Reports is admin-only in the sidebar,
       so this closes the direct-API path without changing any screen. */
    const lcScope: Record<string, unknown> = {}
    const reportingInstructor = req.user!.role === 'instructor'
    if (reportingInstructor) {
      lcScope['instructorId'] = new Types.ObjectId(req.user!.id)
    }
    /* Same reasoning as buildBookingFilter: the instructor clause above is
       already the narrower of the two, so stacking the academy on top only
       drops a LENT instructor's own borrowing-academy sessions and silently
       under-reports their students. Every other role keeps the academy.

       WIDEN to classes this academy owns OR is named a guest cohort on — the
       widen half of the split buildBookingFilter does at :2124, which the
       comment below already claimed to match while implementing only the
       narrow half. Owner equality alone meant a shared class was not in the
       candidate set at all for the guest academy, and the per-seat clause
       below is composed under $and so it can only subtract: it could never
       re-admit a class this line had already removed. The guest academy's own
       attendance on every shared class was silently missing from its own
       report and its CSV, with the rate computed off the short total.

       servedClassFilter is called WITHOUT includeUnowned, so classes with no
       academy stay excluded exactly as owner equality excluded them, and its
       guest arm is gated on the feature switch — off means byte-identical. */
    if (!reportingInstructor) {
      andFilter(lcScope, servedClassFilter(reportCaller.org))
    }
    if (Object.keys(lcScope).length > 0) {
      const scopedClassIds = await LiveClassModel.find(lcScope, '_id').lean()
      filter['liveClassId'] = { $in: scopedClassIds.map((l: any) => l._id) }
    }

    /* NARROW THE ROWS, not only the classes — the same split buildBookingFilter
       applies, and for the same reason. This report returns student names and
       emails and offers a CSV, so on a shared class it would hand the host
       academy every guest academy's student. Scoping the CLASS set is not
       enough once one class has two rosters.

       An unstamped seat is the host's, so it is only included for a caller who
       owns the class — the same rule, and the same reason: matching it
       unconditionally would show a guest academy the host's legacy roster.
       `owned` therefore stays strict owner equality even though the class
       scope above is now the wider "serves this academy" set. */
    if (!reportingInstructor && reportCaller.org && Types.ObjectId.isValid(reportCaller.org)) {
      const oid = new Types.ObjectId(reportCaller.org)
      const owned = await LiveClassModel.find({ organizationId: oid }, '_id').lean()
      filter['$and'] = [
        ...((filter['$and'] as unknown[]) ?? []),
        { $or: [
          { seatOrganizationId: oid },
          { seatOrganizationId: { $exists: false }, liveClassId: { $in: owned.map((l: any) => l._id) } },
        ] },
      ]
    }
    const bookings = await ClassBookingModel.find(filter)
      .populate('userId', 'id name email')
      .populate('liveClassId', 'id title scheduledStart')
      .lean({ virtuals: true })
    // Aggregate per student
    const byStudent: Record<string, { user: any; total: number; attended: number; missed: number; booked: number }> = {}
    for (const b of bookings) {
      const u = b.userId as any
      const uid = String(u.id ?? u._id)
      if (!byStudent[uid]) byStudent[uid] = { user: { ...u, id: uid }, total: 0, attended: 0, missed: 0, booked: 0 }
      byStudent[uid].total++
      if (b.status === 'attended') byStudent[uid].attended++
      else if (b.status === 'missed') byStudent[uid].missed++
      else if (b.status === 'booked') byStudent[uid].booked++
    }
    sendSuccess(res, Object.values(byStudent))
  } catch (err) { next(err) }
})


/* ─────────────────────────────────────────────────────
   REPORTS — Mentor Schedule
   GET /admin/reports/mentor-schedule?from=&to=&mentorId=
─────────────────────────────────────────────────────── */
router.get('/reports/mentor-schedule', requireInstructor, requirePermission('reports','read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { LiveClassModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { from, to, mentorId } = req.query as Record<string, string>

    const filter: Record<string, any> = {}
    if (req.user!.organizationId && Types.ObjectId.isValid(req.user!.organizationId)) {
      filter['organizationId'] = new Types.ObjectId(req.user!.organizationId)
    }
    if (from || to) {
      filter['scheduledStart'] = {}
      if (from) filter['scheduledStart']['$gte'] = new Date(from)
      if (to)   filter['scheduledStart']['$lte'] = new Date(to)
    }
    if (mentorId && Types.ObjectId.isValid(mentorId)) {
      filter['instructorId'] = new Types.ObjectId(mentorId)
    }

    const sessions = await LiveClassModel.find(filter)
      .populate('instructorId', 'id name email')
      .lean({ virtuals: true })

    // Group by instructor
    const mentorMap = new Map<string, {
      mentor: { id: string; name: string; email: string }
      assigned: number
      conducted: number
      cancelled: number
      completionPct: number
    }>()

    for (const s of sessions) {
      const inst = s.instructorId as any
      if (!inst) continue
      const key = String(inst._id ?? inst.id)
      if (!mentorMap.has(key)) {
        mentorMap.set(key, { mentor: { id: key, name: inst.name, email: inst.email }, assigned: 0, conducted: 0, cancelled: 0, completionPct: 0 })
      }
      const row = mentorMap.get(key)!
      row.assigned++
      if (s.status === 'ended') row.conducted++
      if (s.status === 'cancelled') row.cancelled++
    }

    const results = Array.from(mentorMap.values()).map(row => ({
      ...row,
      completionPct: row.assigned > 0 ? Math.round((row.conducted / row.assigned) * 100) : 0,
    }))

    sendSuccess(res, results)
  } catch (err) { next(err) }
})

/* ─────────────────────────────────────────────────────
   HOMEWORK — Session homework for live classes
   POST   /admin/live-classes/:id/homework       — create homework
   GET    /admin/live-classes/:id/homework       — list homework for session
   GET    /admin/live-classes/:id/homework/submissions — all submissions
   PATCH  /admin/homework/:id                    — update homework
   DELETE /admin/homework/:id                    — delete homework
   PATCH  /admin/homework-submissions/:id/grade  — grade a submission
─────────────────────────────────────────────────────── */
const homeworkCreateSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  dueDate:     z.string().datetime().optional(),
})

const homeworkUpdateSchema = homeworkCreateSchema.partial()

const gradeHomeworkSchema = z.object({
  grade:    z.number().min(0).max(100),
  feedback: z.string().max(2000).optional(),
})

/* Ownership: the session's own mentor manages its homework; everyone else
   falls back to the course-level check (full admins pass, instructors must
   own the course). Returns false when the session cannot be resolved so the
   caller can answer 404. */
async function assertLiveClassEditable(liveClassId: string, req: Request): Promise<boolean> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const { Types }          = await import('mongoose')
  if (!Types.ObjectId.isValid(liveClassId)) return false
  const session = await LiveClassModel.findById(liveClassId).select('courseId instructorId').lean()
  if (!session) return false
  if (String(session.instructorId) === req.user!.id) return true
  await sectionSvc.assertCourseEditable(String(session.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
  return true
}

/* ─────────────────────────────────────────────────────
   seatScopedUserIds(req, liveClassId)
   ─────────────────────────────────────────────────────
   WHOSE STUDENTS MAY THIS CALLER SEE IN THIS ROOM?

   On a shared class one room has two rosters, so scoping the CLASS is no
   longer enough — the three sibling surfaces that return student PII on a
   live class each narrow per SEAT for exactly that reason: the roster
   (buildBookingFilter), the attendance report, and the feedback route below.
   This is that one narrowing, extracted, so the fourth surface cannot drift
   away from the other three the way it already did once.

   Homework carries no academy of its own — HomeworkSubmission is homeworkId,
   userId and the submission fields, and nothing else — so the cohort has to be
   resolved through the seat the student holds on this class. A student with no
   seat row could not have attended, and an unstamped seat is the host's: it
   was taken before the class was ever shared, so it is matched only for the
   academy that OWNS the room.

   The surface this was missing from leaked the opposite way from the rest of
   this feature's bugs. `assertLiveClassEditable` resolves tenancy through the
   HOST course, and a host-academy `admin` passes that unconditionally, so
   GET /live-classes/:id/homework/submissions handed the host every guest
   academy's student by name and email.

   Returns null when no narrowing applies: super_admin is never scoped (rule
   1), a caller with no academy on record is unscoped (rule 3b), and the
   instructor sees the whole room by design — it is the one cross-academy PII
   flow this feature accepts, because somebody has to be able to see everyone
   in the class they are running. The instructor escape is `role ===
   'instructor'` rather than `instructorOwnsSession` purely to match the
   feedback route exactly; both are broader than assignment, and tightening
   the pair together belongs in its own pass. */
async function seatScopedUserIds(
  req: Request,
  liveClassId: string,
): Promise<{ gone: true } | { gone: false; userIds: unknown[] | null }> {
  const { LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')
  const { Types } = await import('mongoose')

  const caller = await callerOrgForRead(req)
  if (caller.gone) return { gone: true }
  if (req.user!.role === 'super_admin' || req.user!.role === 'instructor') return { gone: false, userIds: null }
  if (!caller.org || !Types.ObjectId.isValid(caller.org)) return { gone: false, userIds: null }
  if (!Types.ObjectId.isValid(liveClassId)) return { gone: false, userIds: [] }

  const oid  = new Types.ObjectId(caller.org)
  const lcId = new Types.ObjectId(liveClassId)
  const cls  = await LiveClassModel.findById(lcId).select('organizationId').lean()
  const ownsClass = String((cls as { organizationId?: unknown } | null)?.organizationId ?? '') === String(oid)
  const mine = await ClassBookingModel.find(
    ownsClass
      ? { liveClassId: lcId, $or: [{ seatOrganizationId: oid }, { seatOrganizationId: { $exists: false } }] }
      : { liveClassId: lcId, seatOrganizationId: oid },
    'userId',
  ).lean()
  return { gone: false, userIds: mine.map((b: any) => b.userId) }
}

/* Same check, resolved through a homework document → live class → course. */
async function assertHomeworkEditable(homeworkId: string, req: Request): Promise<boolean> {
  const { SessionHomeworkModel } = await import('@/models/schema.ts')
  const { Types }                = await import('mongoose')
  if (!Types.ObjectId.isValid(homeworkId)) return false
  const hw = await SessionHomeworkModel.findById(homeworkId).select('liveClassId').lean()
  if (!hw) return false
  return assertLiveClassEditable(String(hw.liveClassId), req)
}

router.post('/live-classes/:id/homework', requireRole('super_admin', 'admin', 'instructor'), validate(homeworkCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const liveClassId = String(req.params['id'] ?? '')
    if (!(await assertLiveClassEditable(liveClassId, req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }
    const { title, description, dueDate } = req.body as { title: string; description: string; dueDate?: string }
    const hw = await SessionHomeworkModel.create({
      liveClassId,
      assignedBy: req.user!.id,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
    })
    sendSuccess(res, hw, 'Homework created', 201)
  } catch (err) { next(err) }
})

router.get('/live-classes/:id/homework', requireRole('super_admin', 'admin', 'instructor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const liveClassId = String(req.params['id'] ?? '')
    if (!(await assertLiveClassEditable(liveClassId, req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }
    const list = await SessionHomeworkModel.find({ liveClassId }).populate('assignedBy', 'id name').lean({ virtuals: true })
    sendSuccess(res, (list as any[]).map(d => ({ ...d, id: d.id ?? String(d._id) })))
  } catch (err) { next(err) }
})

router.get('/live-classes/:id/homework/submissions', requireRole('super_admin', 'admin', 'instructor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel, HomeworkSubmissionModel } = await import('@/models/schema.ts')
    const liveClassId = String(req.params['id'] ?? '')
    if (!(await assertLiveClassEditable(liveClassId, req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }
    const homeworks = await SessionHomeworkModel.find({ liveClassId }).lean({ virtuals: true })
    const hwIds = homeworks.map(h => h._id)
    /* NARROWED PER SEAT, like the roster, the attendance report and the
       feedback route. These rows are populated with the student's name and
       email, and the gate above resolves tenancy through the HOST course — so
       on a shared class this handed the host academy's admin every guest
       academy's student. */
    const seats = await seatScopedUserIds(req, liveClassId)
    if (seats.gone) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
    }
    const subFilter: Record<string, unknown> = { homeworkId: { $in: hwIds } }
    if (seats.userIds) subFilter['userId'] = { $in: seats.userIds }
    const submissions = await HomeworkSubmissionModel.find(subFilter)
      .populate('userId', 'id name email')
      .populate('homeworkId', 'id title')
      .populate('gradedBy', 'id name')
      .lean({ virtuals: true })
    sendSuccess(res, (submissions as any[]).map(d => ({ ...d, id: d.id ?? String(d._id) })))
  } catch (err) { next(err) }
})

router.patch('/homework/:id', requireRole('super_admin', 'admin', 'instructor'), validate(homeworkUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')
    if (!(await assertHomeworkEditable(id, req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Homework not found' } }); return
    }
    const { title, description, dueDate } = req.body as { title?: string; description?: string; dueDate?: string }
    const update: Record<string, unknown> = {}
    if (title       !== undefined) update['title']       = title
    if (description !== undefined) update['description'] = description
    if (dueDate     !== undefined) update['dueDate']     = new Date(dueDate)
    const hw = await SessionHomeworkModel.findByIdAndUpdate(id, update, { new: true }).lean({ virtuals: true })
    if (!hw) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Homework not found' } }); return }
    sendSuccess(res, hw, 'Homework updated')
  } catch (err) { next(err) }
})

router.delete('/homework/:id', requireRole('super_admin', 'admin', 'instructor'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { SessionHomeworkModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')
    if (!(await assertHomeworkEditable(id, req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Homework not found' } }); return
    }
    await SessionHomeworkModel.findByIdAndDelete(id)
    sendSuccess(res, null, 'Homework deleted')
  } catch (err) { next(err) }
})

router.patch('/homework-submissions/:id/grade', requireRole('super_admin', 'admin', 'instructor'), validate(gradeHomeworkSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { HomeworkSubmissionModel, SessionHomeworkModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')
    const existing = await HomeworkSubmissionModel.findById(id).select('homeworkId userId').lean()
    if (!existing || !(await assertHomeworkEditable(String(existing.homeworkId), req))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }); return
    }
    /* THE SAME SEAT SCOPE THE LIST APPLIES, because the gate above is the same
       host-course gate and a row this caller may not READ is not one they may
       grade. Without it the host academy's admin could write a grade and
       written feedback onto a guest academy's student — reaching, by id, the
       rows the list no longer shows them. 404 rather than 403, so the reply
       never confirms the submission exists on the other academy's roster. */
    const hw = await SessionHomeworkModel.findById(String(existing.homeworkId)).select('liveClassId').lean()
    const seats = await seatScopedUserIds(req, String((hw as { liveClassId?: unknown } | null)?.liveClassId ?? ''))
    if (seats.gone || (seats.userIds && !seats.userIds.some(u => String(u) === String(existing.userId)))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }); return
    }
    const { grade, feedback } = req.body as { grade: number; feedback?: string }
    const sub = await HomeworkSubmissionModel.findByIdAndUpdate(
      id,
      { grade, feedback, status: 'graded', gradedAt: new Date(), gradedBy: req.user!.id },
      { new: true },
    ).populate('userId', 'id name email').lean({ virtuals: true })
    if (!sub) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }); return }
    sendSuccess(res, sub, 'Submission graded')
  } catch (err) { next(err) }
})

/* GET /admin/live-classes/:id/feedback — feedback summary for a session */
router.get('/live-classes/:id/feedback', requireInstructor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassFeedbackModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const liveClassId = String(req.params['id'] ?? '')
    if (!Types.ObjectId.isValid(liveClassId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid id' } }); return
    }
    /* Tenancy + ownership (P-12). Every other by-id live-class route runs this
       gate; this one was missed, so any instructor in either academy could read
       a colleague's session feedback — with the reviewing students' names and
       email addresses attached. */
    if (!(await callerMayManageSession(req, liveClassId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return
    }
    /* NARROWED THE SAME WAY THE ROSTER IS. These rows carry the reviewing
       students' names, emails and avatars, and on a shared class one class has
       two cohorts — so scoping the CLASS is no longer enough. Each academy
       reads the feedback of its own students only.

       Feedback carries no seat stamp of its own, so the cohort is resolved
       through the seat the student holds on this class. A student with no seat
       row could not have attended, and their feedback is treated as the
       host's — the same rule an unstamped seat gets.

       The resolution itself now lives in seatScopedUserIds beside the homework
       routes, which needed the identical block. One implementation rather than
       three copies, because the copy that was never written is what let the
       submissions endpoint hand the host every guest academy's student. */
    const fbSeats = await seatScopedUserIds(req, liveClassId)
    if (fbSeats.gone) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return
    }
    const fbFilter: Record<string, unknown> = { liveClassId: new Types.ObjectId(liveClassId) }
    if (fbSeats.userIds) fbFilter['userId'] = { $in: fbSeats.userIds }
    const docs = await ClassFeedbackModel.find(fbFilter)
      .populate('userId', 'id name email avatarUrl')
      .sort({ createdAt: -1 })
      .lean({ virtuals: true })
    const avg = docs.length > 0 ? docs.reduce((s, d: any) => s + d.rating, 0) / docs.length : null
    /* Also avatar-bearing: userId is populated with avatarUrl above. */
    sendSuccess(res, { feedbacks: docs, averageRating: avg ? Math.round(avg * 10) / 10 : null, count: docs.length })
  } catch (err) { next(err) }
})

/* ── Roles & Permissions ──────────────────────────────────────────────── */

const roleCreateSchema = z.object({
  name:        z.string().min(1).max(80).trim(),
  description: z.string().max(500).optional(),
})

const roleUpdateSchema = roleCreateSchema.partial()

const resourcePermissionSchema = z.object({
  resource:    z.string(),
  create:      z.boolean().optional(),
  read:        z.boolean().optional(),
  update:      z.boolean().optional(),
  delete:      z.boolean().optional(),
  list:        z.boolean().optional(),
  list_basic:  z.boolean().optional(),
  impersonate: z.boolean().optional(),
})

const permissionsBodySchema = z.object({
  permissions: z.array(resourcePermissionSchema),
})

const assignRoleSchema = z.object({
  roleId: z.string().nullable(),
})

/* Role/permission management is platform-wide, not org-scoped — an org-scoped
   Admin editing or deleting a custom role, or reassigning any user's role,
   would affect every organization. Restrict to super_admin. */
router.get   ('/roles',                      requireRole('super_admin'), roleCtrl.list)
router.post  ('/roles',                      requireRole('super_admin'), validate(roleCreateSchema), roleCtrl.create)
router.patch ('/roles/:id',                  requireRole('super_admin'), validate(roleUpdateSchema), roleCtrl.update)
router.patch ('/roles/:id/permissions',      requireRole('super_admin'), validate(permissionsBodySchema), roleCtrl.updatePermissions)
router.delete('/roles/:id',                  requireRole('super_admin'), roleCtrl.delete)
router.patch ('/users/:userId/assign-role',  requireRole('super_admin'), validate(assignRoleSchema), roleCtrl.assignRole)
/* NOTE: impersonation is registered ONCE, at POST /users/:id/impersonate above
   (~line 300) — the audited, TTL-bounded handler in AdminController. A second
   registration used to sit here pointing at RolesController.impersonate; Express
   matches the first, so it was unreachable code that nonetheless implemented
   different rules for the most sensitive endpoint in the system (P-25). Removed
   rather than left for a future edit to accidentally activate. */

export default router
