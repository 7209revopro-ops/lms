import { Router } from 'express'
import { z } from 'zod'
import { AdminController } from '@/controllers/admin.controller.ts'
import { AuthController } from '@/controllers/auth.controller.ts'
import { LiveClassController } from '@/controllers/liveClass.controller.ts'
import { RolesController } from '@/controllers/roles.controller.ts'
import { authenticateAdmin, requireRole, requireAdmin, requireAnyAdmin, requireInstructor, requireCourseAuthor, injectCategoryScope, requirePermission } from '@/middleware/auth.middleware.ts'
import { issueClassHandoff } from '@/controllers/classHandoff.controller.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { env } from '@/config/env.ts'
import { authRateLimit, refreshRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { QuizService } from '@/services/quiz.service.ts'
import { AssignmentService } from '@/services/assignment.service.ts'
import { SectionService } from '@/services/section.service.ts'
import { OrderService } from '@/services/order.service.ts'
import { CouponService } from '@/services/coupon.service.ts'
import { requireSameOrgUser, callerMayAccess } from '@/utils/tenancy.ts'
import { documentRef } from '@/utils/documentRef.ts'
import { UserService } from '@/services/user.service.ts'
import { adminListDevices, adminApproveDevice, adminRevokeDevice } from '@/services/device.service.ts'
import { sendSuccess, buildPaginationMeta, parsePagination } from '@/utils/response.ts'
import { toSafeUser } from '@/models/types.ts'
import { audit } from '@/middleware/audit.middleware.ts'
import type { Request, Response, NextFunction } from 'express'

const router     = Router()
const ctrl       = new AdminController()
const live       = new LiveClassController()
const authCtrl   = new AuthController()
const roleCtrl   = new RolesController()
const quizSvc    = new QuizService()
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

/* Second login step for admin accounts with 2FA enabled — the challenge
   handed back by /auth/login plus the 6-digit authenticator code. */
const adminLoginTwoFactorSchema = z.object({
  challengeToken: z.string().min(20, 'Challenge token is required'),
  code:           z.string().trim().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be 6 digits'),
})

router.post('/auth/login',   authRateLimit, validate(adminLoginSchema), authCtrl.adminLogin)
router.post('/auth/login/2fa', authRateLimit, validate(adminLoginTwoFactorSchema), authCtrl.adminLoginTwoFactor)
router.post('/auth/refresh', refreshRateLimit, authCtrl.adminRefresh)
router.post('/auth/logout',  authRateLimit, authCtrl.adminLogout)
router.get ('/auth/me',      authenticateAdmin, authCtrl.me)

/* Admin routes are open to admins and instructors. Per-resource
   ownership checks inside the controllers reject instructors who
   try to mutate courses they don't own. */
router.use(authenticateAdmin, requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor'), injectCategoryScope)

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
  avatarUrl:  z.string().url().or(z.literal('')).optional(),
  headline:   z.string().max(255).optional(),
  bio:        z.string().max(2000).optional(),
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
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user!.role === 'admin' && (req.body as any).role === 'super_admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only super admins can grant super admin access.' } })
      return
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
router.post  ('/users/:id/impersonate', requirePermission('users','impersonate'), requireRole('super_admin'), audit('user.impersonate', 'User', r => String(r.params['id'] ?? '')), ctrl.impersonateUser)

/* Client-portal impersonation — same guards as above, separate action so the
   audit trail distinguishes "acted inside the admin panel as them" from
   "browsed the student app as them". */
router.post  ('/users/:id/impersonate-client', requirePermission('users','impersonate'), requireRole('super_admin'), audit('user.impersonate.client', 'User', r => String(r.params['id'] ?? '')), ctrl.impersonateClient)

/* ── Impersonation sessions (M-04) ────────────────────────────────────
   Impersonation is a session record now, not a bare token, so it can be
   listed and stopped. Reading the trail is deliberately broader than
   creating one: any full admin should be able to see who has been in which
   account, while only super_admin can start or stop a session.
──────────────────────────────────────────────────────────────────────── */
router.get('/impersonation-sessions', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ImpersonationSessionModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const { page, per_page } = parsePagination(req.query as Record<string, unknown>)

    /* Scoped like every other admin listing: an org admin sees their own
       academy's sessions, super_admin sees all. */
    const filter: Record<string, unknown> = {}
    const orgId = req.user!.organizationId
    if (req.user!.role !== 'super_admin' && orgId && Types.ObjectId.isValid(orgId)) {
      filter['organizationId'] = new Types.ObjectId(orgId)
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
router.delete('/impersonation-sessions/:id', requireRole('super_admin'),
  audit('user.impersonate.revoke', 'ImpersonationSession', r => String(r.params['id'] ?? '')),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ImpersonationSessionModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')
      const id = String(req.params['id'] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid session id' } }); return
      }
      const existing = await ImpersonationSessionModel.findById(id).select('_id').lean()
      if (!existing) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }); return
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

  if (!(await callerMayAccess(req, (live as { organizationId?: unknown }).organizationId))) {
    return false
  }

  if (req.user!.role !== 'instructor') return true

  const userId = String(req.user!.id)
  if (live.instructorId) return String(live.instructorId) === userId
  if (live.courseId) {
    const course = await CourseModel.findById(String(live.courseId)).select('instructorId').lean()
    return String((course as any)?.instructorId ?? '') === userId
  }
  return false
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
      filter['organizationId'] = new Types.ObjectId(orgId)
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
      filter['courseId'] = { $in: scoped.map(c => c._id) }
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
const LIVE_LANGUAGES = ['English', 'Arabic', 'Hindi', 'Malayalam', 'Urdu'] as const
const liveCreateSchema = z.object({
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
  sessionCapacity: z.coerce.number().int().min(1).max(10000).optional(),
  language:        z.enum(LIVE_LANGUAGES).default('English'),
  /* Offline / in-person support */
  isOnline:        z.boolean().optional(),
  location:        z.string().max(500).optional(),
  room:            z.string().max(100).optional(),
})
const liveUpdateSchema = z.object({
  title:           z.string().min(3).max(255).trim().optional(),
  description:     z.string().max(2000).optional(),
  scheduledStart:  z.string().refine(s => !isNaN(Date.parse(s)), 'Invalid date').optional(),
  durationMins:    z.coerce.number().int().min(5).max(600).optional(),
  meetingUrl:      z.string().url().max(2048).optional(),
  recordingUrl:    z.string().url().max(2048).optional().or(z.literal('')),
  status:          z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
  sessionCapacity: z.coerce.number().int().min(1).max(10000).optional(),
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
})

router.get   ('/courses/:courseId/live-classes',          live.adminListForCourse)
router.get   ('/live-classes',                            live.adminListAll)
router.get   ('/live-classes/:id',                        live.adminGetById)
router.post  ('/live-classes', requirePermission('live-classes','create'),                            validate(liveCreateSchema), audit('liveclass.create', 'LiveClass', undefined, r => ({ title: r.body.title, scheduledStart: r.body.scheduledStart })), live.adminCreate)
const liveRepeatSchema = z.object({ weeks: z.coerce.number().int().min(1).max(52) })
router.post  ('/live-classes/:id/repeat',                 validate(liveRepeatSchema), audit('liveclass.repeat', 'LiveClass', r => String(r.params['id'] ?? ''), r => ({ weeks: r.body.weeks })), live.adminRepeat)
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

    /* Enrollment gate — student must be enrolled in the session's course */
    let enrollment = null
    if (session.courseId) {
      const { EnrollmentModel } = await import('@/models/schema.ts')
      enrollment = await EnrollmentModel.findOne({
        userId:   new Types.ObjectId(studentId),
        courseId: session.courseId,
        status:   'active',
      }).lean()
      if (!enrollment) {
        res.status(403).json({ success: false, error: { code: 'NOT_ENROLLED', message: 'Student is not enrolled in this course' } }); return
      }
    }

    /* Module blocking — cannot book if student's section is blocked */
    if (enrollment && session.sectionId) {
      const blockedIds = ((enrollment as any).blockedLessons ?? []).map((id: any) => String(id))
      if (blockedIds.includes(String(session.sectionId))) {
        res.status(403).json({ success: false, error: { code: 'MODULE_BLOCKED', message: 'Student does not have access to this module' } }); return
      }
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
        const reserved = await LiveClassModel.updateOne(
          { _id: liveClassId, $expr: { $lt: ['$bookedCount', '$sessionCapacity'] } },
          { $inc: { bookedCount: 1 } },
        )
        if (reserved.modifiedCount === 0) {
          res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
        }
        /* The status:'cancelled' term makes the transition conditional, so
           two concurrent re-books cannot both succeed and leak a seat. */
        let rebooked
        try {
          rebooked = await ClassBookingModel.updateOne({ _id: existing._id, status: 'cancelled' }, {
            status: 'booked', bookedAt: new Date(), cancelledAt: undefined,
            reminderDayBeforeSent: false, reminderDayOfSent: false,
            reminderPreSessionSent: false, reminder5MinSent: false, reminderAtTimeSent: false,
          })
        } catch (err) {
          /* Re-book failed — give the reserved seat back */
          await LiveClassModel.updateOne({ _id: liveClassId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } })
          throw err
        }
        if (rebooked.modifiedCount === 0) {
          /* Another request re-booked it first — give the seat back */
          await LiveClassModel.updateOne({ _id: liveClassId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } })
          res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'Student already has a booking for this session' } }); return
        }
        bookingDoc = await ClassBookingModel.findById(existing._id).lean({ virtuals: true })
      } else {
        res.status(409).json({ success: false, error: { code: 'ALREADY_BOOKED', message: 'Student already has a booking for this session' } }); return
      }
    } else {
      /* Reserve the seat atomically — the cap is re-evaluated inside the
         filter, so concurrent bookings can never oversell the session. */
      const reserved = await LiveClassModel.updateOne(
        { _id: liveClassId, $expr: { $lt: ['$bookedCount', '$sessionCapacity'] } },
        { $inc: { bookedCount: 1 } },
      )
      if (reserved.modifiedCount === 0) {
        res.status(400).json({ success: false, error: { code: 'SESSION_FULL', message: 'This session is fully booked' } }); return
      }

      let booking
      try {
        booking = await ClassBookingModel.create({
          userId:      new Types.ObjectId(studentId),
          liveClassId: new Types.ObjectId(liveClassId),
          status:      'booked',
          bookedAt:    new Date(),
        })
      } catch (err) {
        /* Booking row not created — give the reserved seat back */
        await LiveClassModel.updateOne({ _id: liveClassId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } })
        throw err
      }

      bookingDoc = await booking.populate([
        { path: 'liveClassId', select: 'id title scheduledStart durationMins meetingUrl type' },
      ])
    }

    sendSuccess(res, bookingDoc, 'Booking created for student', 201)

    /* Post-booking: notify + email student (fire-and-forget) */
    const notifSvc = new NotificationService()
    const dateLabel = new Date(session.scheduledStart).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    const joinUrl = (session as any).meetingUrl ?? `${process.env['CLIENT_URL'] ?? 'http://localhost:3000'}/live-classes/${liveClassId}/watch`

    notifSvc.create(studentId, {
      kind: 'booking-confirmed', title: `Booking confirmed: ${session.title}`,
      body: `Your seat is confirmed for ${session.title} on ${dateLabel}.`, link: '/class-bookings',
    }).catch(() => {/* non-fatal */})

    import('@/services/email.service.ts').then(({ sendBookingConfirmation }) => {
      sendBookingConfirmation((student as any).email, (student as any).name, session.title, session.scheduledStart)
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
  page:         z.coerce.number().int().min(1).default(1),
  per_page:     z.coerce.number().int().min(1).max(200).default(50),
})

router.get('/bookings', requireInstructor, requirePermission('bookings','list'), validate(bookingQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassBookingModel, LiveClassModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const q = req.query as unknown as z.infer<typeof bookingQuerySchema>

    /* ── Step 1: Build live-class filter (instructor scope + date + courseId) ── */
    const lcFilter: Record<string, any> = {}

    // Org isolation — scoped users only see their org's classes
    if (req.user!.organizationId && Types.ObjectId.isValid(req.user!.organizationId)) {
      lcFilter['organizationId'] = new Types.ObjectId(req.user!.organizationId)
    }

    // Instructors only see their own classes
    if (req.user!.role === 'instructor') {
      lcFilter['instructorId'] = new Types.ObjectId(req.user!.id)
    } else if (q.instructorId && Types.ObjectId.isValid(q.instructorId)) {
      lcFilter['instructorId'] = new Types.ObjectId(q.instructorId)
    }

    // Programme-scoped admins (sub_admin) only see their program's bookings
    const scope = (req.user as any)?.categoryScope as string | undefined
    if (scope) {
      const { CourseModel } = await import('@/models/schema.ts')
      const scopedCourses = await CourseModel.find({ program: scope }, '_id').lean()
      const scopedIds = scopedCourses.map((c: any) => c._id)
      if (!q.courseId) {
        lcFilter['courseId'] = { $in: scopedIds }
      }
    }

    if (q.courseId && Types.ObjectId.isValid(q.courseId)) {
      lcFilter['courseId'] = new Types.ObjectId(q.courseId)
    }

    if (q.language) {
      lcFilter['language'] = q.language
    }

    // For cancelled bookings the date range applies to cancelledAt (not scheduledStart)
    if (q.dateFrom || q.dateTo) {
      if (q.status !== 'cancelled') {
        lcFilter['scheduledStart'] = {}
        if (q.dateFrom) lcFilter['scheduledStart']['$gte'] = new Date(q.dateFrom)
        if (q.dateTo) {
          const end = new Date(q.dateTo)
          end.setHours(23, 59, 59, 999)
          lcFilter['scheduledStart']['$lte'] = end
        }
      }
    }

    /* ── Step 2: Resolve live-class IDs if needed ── */
    const filter: Record<string, any> = {}
    if (Object.keys(lcFilter).length > 0) {
      const matchingLcIds = await LiveClassModel.find(lcFilter, '_id').lean()
      filter['liveClassId'] = { $in: matchingLcIds.map((l: any) => l._id) }
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
      if (!inScope) {
        sendSuccess(res, [], undefined, 200,
          buildPaginationMeta(0, Number(q.page) || 1, Number(q.per_page) || 50))
        return
      }
      filter['liveClassId'] = requested
    }
    if (q.userId && Types.ObjectId.isValid(q.userId)) filter['userId'] = new Types.ObjectId(q.userId)
    if (q.status) filter['status'] = q.status

    // Cancelled bookings: apply date range to cancelledAt instead of scheduledStart
    if (q.status === 'cancelled' && (q.dateFrom || q.dateTo)) {
      const cf: Record<string, any> = {}
      if (q.dateFrom) cf['$gte'] = new Date(q.dateFrom)
      if (q.dateTo)   { const e = new Date(q.dateTo); e.setHours(23,59,59,999); cf['$lte'] = e }
      filter['cancelledAt'] = cf
    }

    /* ── Step 3: Fetch bookings with rich populate ── */
    const page     = Number(q.page)     || 1
    const per_page = Number(q.per_page) || 50
    const skip     = (page - 1) * per_page

    const [docs, total] = await Promise.all([
      ClassBookingModel.find(filter)
        .populate('userId', 'id name email avatarUrl')
        .populate({
          path:     'liveClassId',
          select:   'id title scheduledStart durationMins language courseId sectionId instructorId isOnline location room',
          populate: [
            { path: 'courseId',     select: 'id title' },
            { path: 'sectionId',    select: 'id title' },
            { path: 'instructorId', select: 'id name avatarUrl' },
          ],
        })
        .sort({ bookedAt: -1 })
        .skip(skip).limit(per_page)
        .lean({ virtuals: true }),
      ClassBookingModel.countDocuments(filter),
    ])

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

const attendanceUpdateSchema = z.object({
  status: z.enum(['attended', 'missed']),
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
    const existing = await ClassBookingModel.findById(id).select('liveClassId').lean()
    if (!existing || !(await callerMayManageSession(req, existing.liveClassId))) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } }); return
    }

    const booking = await ClassBookingModel.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    ).populate('userId', 'id name email').lean({ virtuals: true })
    if (!booking) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } }); return }
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
    /* Scope the sessions this caller may report on, then resolve to ids.
       Org isolation was here; the INSTRUCTOR scope was not (P-13), so an
       instructor received every student's attendance across the whole academy
       — name, email and per-session counts — where /admin/bookings correctly
       narrows them to their own classes. Reports is admin-only in the sidebar,
       so this closes the direct-API path without changing any screen. */
    const lcScope: Record<string, unknown> = {}
    if (req.user!.organizationId && Types.ObjectId.isValid(req.user!.organizationId)) {
      lcScope['organizationId'] = new Types.ObjectId(req.user!.organizationId)
    }
    if (req.user!.role === 'instructor') {
      lcScope['instructorId'] = new Types.ObjectId(req.user!.id)
    }
    if (Object.keys(lcScope).length > 0) {
      const scopedClassIds = await LiveClassModel.find(lcScope, '_id').lean()
      filter['liveClassId'] = { $in: scopedClassIds.map((l: any) => l._id) }
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
    const submissions = await HomeworkSubmissionModel.find({ homeworkId: { $in: hwIds } })
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
    const { HomeworkSubmissionModel } = await import('@/models/schema.ts')
    const id = String(req.params['id'] ?? '')
    const existing = await HomeworkSubmissionModel.findById(id).select('homeworkId').lean()
    if (!existing || !(await assertHomeworkEditable(String(existing.homeworkId), req))) {
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
    const docs = await ClassFeedbackModel.find({ liveClassId: new Types.ObjectId(liveClassId) })
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
