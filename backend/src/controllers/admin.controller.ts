import type { Request, Response, NextFunction } from 'express'
import { CourseService, CourseError } from '@/services/course.service.ts'
import { CategoryService } from '@/services/category.service.ts'
import { UserService } from '@/services/user.service.ts'
import { ReviewService } from '@/services/review.service.ts'
import { AdminService } from '@/services/admin.service.ts'
import { SectionService } from '@/services/section.service.ts'
import { LessonService } from '@/services/lesson.service.ts'
import { LessonRepository } from '@/repositories/lesson.repository.ts'
import { SectionRepository } from '@/repositories/section.repository.ts'
import { sendSuccess, buildPaginationMeta, parsePagination } from '@/utils/response.ts'
import { toCourseDTO } from '@/utils/courseDTO.ts'
import { instructorOwnsSession } from '@/utils/tenancy.ts'
import { signAccessToken, toSeconds } from '@/utils/jwt.ts'
import type { UserRole } from '@/types/index.ts'

/* Long enough to open a tab, far too short to pass around. The impersonation
   session itself still runs for IMPERSONATION_EXPIRES_IN. */
const HANDOFF_TTL_MS = 60_000

export class AdminController {
  private readonly courseService   = new CourseService()
  private readonly categoryService = new CategoryService()
  private readonly userService     = new UserService()
  private readonly reviewService   = new ReviewService()
  private readonly admin           = new AdminService()
  private readonly sectionService  = new SectionService()
  private readonly lessonService   = new LessonService()
  private readonly lessonRepo      = new LessonRepository()
  private readonly sectionRepo     = new SectionRepository()

  /* ── Course author must be teachable-by and reachable-by the caller (B-04) ──
     `instructorId` came straight off the request body for any admin role, with
     nothing checking that the person named teaches at the caller's academy. It
     was not exploitable — assertSameOrganization blocks the assignee from
     editing a course in the other academy, so they gained nothing — but the
     catalogue would then credit an instructor from the wrong academy, and a
     nonexistent id produced a course whose author never resolves.

     super_admin is unscoped, matching every other tenancy guard, and a caller
     with no academy of their own stays unscoped too — the same `{org} OR
     {null}` convention the rest of the admin routes use. */
  private async assertAssignableInstructor(req: Request, instructorId: string): Promise<void> {
    const { Types } = await import('mongoose')
    if (!Types.ObjectId.isValid(instructorId)) {
      throw new CourseError('INVALID_INSTRUCTOR', 'Invalid instructor id.', 400)
    }
    const { UserModel } = await import('@/models/schema.ts')
    const target = await UserModel.findById(instructorId).select('role organizationId isActive').lean()
    if (!target) {
      throw new CourseError('INSTRUCTOR_NOT_FOUND', 'That instructor does not exist.', 404)
    }
    if ((target as { isActive?: boolean }).isActive === false) {
      throw new CourseError('INSTRUCTOR_INACTIVE', 'That account is disabled and cannot be assigned a course.', 400)
    }
    if (req.user!.role === 'super_admin') return

    const callerOrg = req.user!.organizationId
    const targetOrg = (target as { organizationId?: unknown }).organizationId
    if (!callerOrg || !targetOrg) return
    if (String(callerOrg) !== String(targetOrg)) {
      throw new CourseError('INSTRUCTOR_OTHER_ORG', 'That instructor belongs to another academy.', 403)
    }
  }

  /* ─── Dashboard stats ─────────────────────────── */
  stats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await this.admin.getStats(req.user!.organizationId, req.user!.categoryScope))
    } catch (err) { next(err) }
  }

  /* ─── Courses (any status) ──────────────────────
     Admins see everything; instructors only see their own. */
  listCourses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q = req.query as Record<string, string | undefined>
      const TEACHING_STAFF = ['instructor']
      const scope = req.user!.categoryScope
      const isTeachingStaff = TEACHING_STAFF.includes(req.user!.role)
      const { docs, totalCount } = await this.courseService.listAdmin({
        page,
        perPage:        per_page,
        search:         q['search']?.trim() || undefined,
        status:         (q['status'] as 'draft' | 'published' | 'archived' | 'all' | undefined) ?? 'all',
        level:          q['level'] as 'beginner' | 'intermediate' | 'advanced' | undefined,
        category:       q['category']?.trim() || undefined,
        program:        isTeachingStaff ? (q['program'] as string | undefined) : (scope ?? (q['program'] as string | undefined)),
        free:           q['free'] === 'true',
        sort:           q['sort'] as 'popular' | 'rating' | 'newest' | 'price_lo' | 'price_hi' | undefined,
        instructorId:   isTeachingStaff ? req.user!.id : undefined,
        organizationId: req.user!.organizationId,
      })
      const counts = await Promise.all(docs.map(c => this.lessonRepo.countByCourse(c.id)))
      const dtos   = docs.map((c, i) => toCourseDTO(c, counts[i]))
      const meta   = buildPaginationMeta(totalCount, page, per_page)
      sendSuccess(res, dtos, undefined, 200, meta)
    } catch (err) { next(err) }
  }

  getCourse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const course = await this.courseService.getById(id)
      /* Instructors may only read their own courses. */
      await this.sectionService.assertCourseEditable(course.id, req.user!.id, req.user!.role, req.user!.categoryScope)
      const lessonCount = await this.lessonRepo.countByCourse(course.id)
      sendSuccess(res, toCourseDTO(course, lessonCount))
    } catch (err) { next(err) }
  }

  createCourse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as {
        title:         string
        slug:          string
        description?:  string
        thumbnailUrl?: string
        previewUrl?:   string
        price:         number
        priceAED?:     number
        priceINR?:     number
        isFree:        boolean
        status:        'draft' | 'published' | 'archived'
        level?:        'beginner' | 'intermediate' | 'advanced'
        language:      string
        tags?:         string[] | string
        categoryId?:   string
        instructorId?: string
        program?:      '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
        organizationId?: string
      }

      const tags = typeof dto.tags === 'string'
        ? dto.tags.split(',').map(t => t.trim()).filter(Boolean)
        : (dto.tags ?? [])

      /* Instructors can only author their own courses; admins may assign
         the course to any instructor (or default to themselves). */
      const isAdmin = ['super_admin', 'admin', 'sub_admin', 'support'].includes(req.user!.role)
      const instructorId = isAdmin
        ? (dto.instructorId ?? req.user!.id)
        : req.user!.id

      /* Only when an id was actually supplied — defaulting to the caller needs
         no check, and re-validating it would refuse a super_admin who has no
         academy of their own (B-04). */
      if (isAdmin && dto.instructorId) await this.assertAssignableInstructor(req, dto.instructorId)

      const scope = req.user!.categoryScope

      /* ── Which academy owns this course? ──────────────────────────────────
         The same trap as user creation: this used to be whatever
         `req.user.organizationId` happened to be, which for a super_admin is
         the topbar org switcher — and its default position, "All Orgs", sends
         no header. A course created from there belonged to no academy and so
         appeared in no academy's catalogue.

         A super_admin names the academy, falling back to the switcher. Anyone
         else gets their own and may not name another. The coupon service has
         refused the empty case for a while; courses now do the same. */
      const isSuper   = req.user!.role === 'super_admin'
      const callerOrg = req.user!.organizationId

      if (!isSuper && dto.organizationId && dto.organizationId !== callerOrg) {
        res.status(403).json({ success: false, error: {
          code: 'FORBIDDEN', message: 'You can only create courses in your own academy.',
        } })
        return
      }

      /* `||` not `??` — an unselected picker sends '' meaning "not chosen". */
      const organizationId = isSuper ? (dto.organizationId || callerOrg) : callerOrg

      if (!organizationId) {
        res.status(400).json({ success: false, error: {
          code: 'ORGANIZATION_REQUIRED', message: 'Select an academy for this course.',
        } })
        return
      }

      {
        const { Types } = await import('mongoose')
        const { OrganizationModel } = await import('@/models/schema.ts')
        if (!Types.ObjectId.isValid(organizationId)) {
          res.status(400).json({ success: false, error: {
            code: 'INVALID_ORGANIZATION', message: 'That is not a valid academy id.',
          } })
          return
        }
        if (!(await OrganizationModel.exists({ _id: organizationId }))) {
          res.status(404).json({ success: false, error: {
            code: 'ORGANIZATION_NOT_FOUND', message: 'That academy does not exist.',
          } })
          return
        }
      }

      const course = await this.courseService.create({
        title:          dto.title,
        slug:           dto.slug,
        description:    dto.description,
        thumbnailUrl:   dto.thumbnailUrl,
        previewUrl:     dto.previewUrl,
        price:          dto.price,
        priceAED:       dto.priceAED,
        priceINR:       dto.priceINR,
        isFree:         dto.isFree,
        status:         dto.status,
        level:          dto.level,
        language:       dto.language,
        tags,
        instructorId,
        categoryId:     dto.categoryId,
        program:        scope ?? dto.program,
        organizationId,
      })
      sendSuccess(res, toCourseDTO(course, 0), 'Course created', 201)
    } catch (err) { next(err) }
  }

  updateCourse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id  = String(req.params['id'] ?? '')
      await this.sectionService.assertCourseEditable(id, req.user!.id, req.user!.role, req.user!.categoryScope)
      const dto = req.body as Record<string, unknown>
      /* Instructors cannot reassign their course to a different author. */
      const isAdmin = ['super_admin', 'admin', 'sub_admin', 'support'].includes(req.user!.role)
      if (!isAdmin) delete dto['instructorId']
      else if (typeof dto['instructorId'] === 'string') {
        await this.assertAssignableInstructor(req, dto['instructorId'])
      }
      /* Category-scoped admins cannot override their program scope */
      const scope = req.user!.categoryScope
      if (scope) dto['program'] = scope
      const tags = typeof dto['tags'] === 'string'
        ? (dto['tags'] as string).split(',').map(t => t.trim()).filter(Boolean)
        : (dto['tags'] as string[] | undefined)
      const course = await this.courseService.update(id, { ...dto, tags } as Parameters<CourseService['update']>[1])
      const lessonCount = await this.lessonRepo.countByCourse(course.id)
      sendSuccess(res, toCourseDTO(course, lessonCount), 'Course updated')
    } catch (err) { next(err) }
  }

  deleteCourse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      await this.sectionService.assertCourseEditable(id, req.user!.id, req.user!.role, req.user!.categoryScope)
      await this.courseService.delete(id)
      sendSuccess(res, null, 'Course deleted')
    } catch (err) { next(err) }
  }

  /* ─── Categories CRUD ─────────────────────────── */
  listCategories = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { sendSuccess(res, await this.categoryService.listAll()) } catch (err) { next(err) }
  }

  createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const c = await this.categoryService.create(req.body)
      sendSuccess(res, c, 'Category created', 201)
    } catch (err) { next(err) }
  }

  updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const c = await this.categoryService.update(String(req.params['id'] ?? ''), req.body)
      sendSuccess(res, c, 'Category updated')
    } catch (err) { next(err) }
  }

  deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.categoryService.delete(String(req.params['id'] ?? ''))
      sendSuccess(res, null, 'Category deleted')
    } catch (err) { next(err) }
  }

  /* ─── Users ───────────────────────────────────── */
  listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q        = req.query as Record<string, string | undefined>
      const role             = q['role'] as UserRole | undefined
      const search           = q['search']?.trim() || undefined
      const category         = q['category'] as string | undefined
      const effectiveCategory = req.user!.categoryScope ? req.user!.categoryScope as string : category
      const status           = q['status'] as 'active' | 'inactive' | undefined
      const excludeStudents  = Boolean(q['exclude_students'])
      const enrollmentStatus = q['enrollmentStatus'] as 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined
      const { docs, totalCount } = await this.userService.listByRole(role, { page, perPage: per_page, search, category: effectiveCategory, status, excludeStudents, enrollmentStatus, organizationId: req.user!.organizationId })
      const meta = buildPaginationMeta(totalCount, page, per_page)
      sendSuccess(res, docs, undefined, 200, meta)
    } catch (err) { next(err) }
  }

  deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      await this.userService.adminDelete(id)
      sendSuccess(res, null, 'User deleted')
    } catch (err) { next(err) }
  }

  createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as {
        name:       string
        email:      string
        password:   string
        role:       UserRole
        bio?:       string
        headline?:  string
        category?:  '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
        program?:   'ai' | 'digital_marketing' | 'forex' | 'jura'
        avatarUrl?: string
      }
      const user = await this.userService.adminCreateUser({ ...dto, organizationId: req.user!.organizationId })
      sendSuccess(res, user, 'User created', 201)
    } catch (err) { next(err) }
  }

  /* ─── Reviews (global) ────────────────────────── */
  listReviews = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const { docs, totalCount } = await this.reviewService.listAll(page, per_page, req.user!.organizationId)
      const meta = buildPaginationMeta(totalCount, page, per_page)
      sendSuccess(res, docs, undefined, 200, meta)
    } catch (err) { next(err) }
  }

  deleteReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.reviewService.adminDelete(String(req.params['id'] ?? ''))
      sendSuccess(res, null, 'Review deleted')
    } catch (err) { next(err) }
  }

  /* ─── User actions ────────────────────────────── */
  impersonateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      /* NOT FROM INSIDE AN IMPERSONATION. The session row records
         `actorId: req.user!.id`, and during an impersonation that id is the
         account being impersonated, not the operator behind it — so a chained
         impersonation would write the wrong person into the one record that
         says who did this. (The audit log is fine: audit.middleware.ts
         prefers impersonatorId. The session row does not.) The self-check
         below compares against the same borrowed id, so without this an
         operator could even impersonate their own real account and appear in
         the trail as their target.

         Refused rather than corrected: an operator who needs to look at a
         second account can leave the first. */
      if (req.user!.impersonationId) {
        sendSuccess(res, null, 'Leave the current impersonation before starting another.', 409)
        return
      }
      const targetId = String(req.params['id'] ?? '')
      if (targetId === req.user!.id) {
        sendSuccess(res, null, 'Cannot impersonate yourself', 400)
        return
      }
      const target = await this.userService.findById(targetId)
      if (!target) { sendSuccess(res, null, 'User not found', 404); return }

      /* Impersonation gets its own budget rather than the session TTL (M-02).
         It is a bare Bearer token with no refresh counterpart, so inheriting a
         15-minute session TTL would strand the admin mid-task with 401s the
         client cannot recover from — /admin/auth/refresh renews the admin's
         cookie, not this token. Override with IMPERSONATION_EXPIRES_IN. */
      const ttl   = process.env['IMPERSONATION_EXPIRES_IN']?.trim() || '30m'

      /* A session ROW is created first, and the token merely names it (M-04).
         The token used to BE the session: nothing recorded who was
         impersonating, and "end impersonation" only meant the browser dropped
         its copy — anyone else holding that token kept full access to the
         account until it expired. Every request now re-checks this row, so
         revoking it ends the session for every holder at once. */
      const { ImpersonationSessionModel } = await import('@/models/schema.ts')
      const session = await ImpersonationSessionModel.create({
        actorId:        req.user!.id,
        actorEmail:     req.user!.email,
        targetId:       String(target._id),
        targetEmail:    target.email,
        /* THE ROW IS STAMPED WITH THE ACTOR'S ACADEMY, and the listing and
           revoke screens filter on it — so a row with no organizationId
           belongs to neither academy: no scoped listing shows it and no org
           admin can end it. That is only ever right for a super_admin, whose
           reach genuinely has no single owning academy. It cannot happen to
           anyone else, because the only route an admin or sub_admin can take
           here is guarded by requireImpersonableStudent, which 404s a caller
           whose own academy is unset before the handler is reached. */
        organizationId: req.user!.organizationId,
        expiresAt:      new Date(Date.now() + toSeconds(ttl) * 1000),
        ip:             (req.ip ?? req.socket?.remoteAddress) || undefined,
        userAgent:      req.headers['user-agent'] || undefined,
      })

      /* Audience 'admin' (L-06): this token is handed to the admin app and
         presented as a Bearer on its requests, which land on authenticateAdmin.
         Minting it as 'client' would make impersonation stop working the
         moment JWT_ENFORCE_AUDIENCE is switched on. */
      const token = await signAccessToken(
        { id: String(target._id), email: target.email, role: target.role },
        ttl,
        'admin',
        { actorId: req.user!.id, actorEmail: req.user!.email, sessionId: String(session._id) },
      )
      sendSuccess(res, {
        token,
        expiresIn:       toSeconds(ttl),
        impersonationId: String(session._id),
        user: { id: String(target._id), name: target.name, email: target.email, role: target.role, avatarUrl: target.avatarUrl },
      }, 'Impersonation token issued')
    } catch (err) { next(err) }
  }

  /* ─────────────────────────────────────────────────────
     POST /admin/users/:id/impersonate-client
     ─────────────────────────────────────────────────────
     Client-portal impersonation. Unlike impersonateUser above, the caller does
     NOT receive a token: the admin and client portals are separate origins and
     the auth cookies are host-only (M-21), so the admin app cannot set the
     client's cookie — and giving it one would be handing the browser a live
     student session in JS-reachable storage.

     Instead it gets a one-time CODE, opens the client app with it, and the
     client origin redeems it for its own httpOnly cookie. The code is a
     60-second, single-use pointer to the session row; the token itself is
     minted at redemption, so nothing that grants access is ever at rest.

     Students only. Impersonating staff through the client portal would be a
     category error — they have no student view — and the admin-side flow
     already covers that case.
  ───────────────────────────────────────────────────── */
  impersonateClient = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      /* NOT FROM INSIDE AN IMPERSONATION. The session row records
         `actorId: req.user!.id`, and during an impersonation that id is the
         account being impersonated, not the operator behind it — so a chained
         impersonation would write the wrong person into the one record that
         says who did this. (The audit log is fine: audit.middleware.ts
         prefers impersonatorId. The session row does not.) The self-check
         below compares against the same borrowed id, so without this an
         operator could even impersonate their own real account and appear in
         the trail as their target.

         Refused rather than corrected: an operator who needs to look at a
         second account can leave the first. */
      if (req.user!.impersonationId) {
        sendSuccess(res, null, 'Leave the current impersonation before starting another.', 409)
        return
      }
      const targetId = String(req.params['id'] ?? '')
      if (targetId === req.user!.id) {
        sendSuccess(res, null, 'Cannot impersonate yourself', 400)
        return
      }

      const target = await this.userService.findById(targetId)
      if (!target) { sendSuccess(res, null, 'User not found', 404); return }
      if (target.role !== 'student') {
        sendSuccess(res, null, 'Only student accounts can be viewed in the client portal', 400)
        return
      }
      /* Redemption refuses a disabled account anyway, but failing here means
         the admin is told now instead of being handed a link that dies when
         they click it. */
      if (target.isActive === false) {
        sendSuccess(res, null, 'This account is disabled and cannot be viewed', 400)
        return
      }

      const ttl = process.env['IMPERSONATION_EXPIRES_IN']?.trim() || '30m'

      const { ImpersonationSessionModel, ImpersonationHandoffModel } =
        await import('@/models/schema.ts')

      /* Same revocable session row as the admin-side flow, so the existing
         list / revoke / revoke-all screens govern these sessions too. */
      const session = await ImpersonationSessionModel.create({
        actorId:        req.user!.id,
        actorEmail:     req.user!.email,
        targetId:       String(target._id),
        targetEmail:    target.email,
        /* THE ROW IS STAMPED WITH THE ACTOR'S ACADEMY, and the listing and
           revoke screens filter on it — so a row with no organizationId
           belongs to neither academy: no scoped listing shows it and no org
           admin can end it. That is only ever right for a super_admin, whose
           reach genuinely has no single owning academy. It cannot happen to
           anyone else, because the only route an admin or sub_admin can take
           here is guarded by requireImpersonableStudent, which 404s a caller
           whose own academy is unset before the handler is reached. */
        organizationId: req.user!.organizationId,
        expiresAt:      new Date(Date.now() + toSeconds(ttl) * 1000),
        ip:             (req.ip ?? req.socket?.remoteAddress) || undefined,
        userAgent:      req.headers['user-agent'] || undefined,
      })

      /* Hashed at rest: the raw code is a bearer secret for its 60 seconds, and
         a database read should not yield one. */
      const { randomBytes, createHash } = await import('node:crypto')
      const code     = randomBytes(32).toString('hex')
      const codeHash = createHash('sha256').update(code).digest('hex')

      await ImpersonationHandoffModel.create({
        codeHash,
        sessionId: session._id,
        expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
      })

      const clientBase = (process.env['CLIENT_URL'] ?? '').replace(/\/+$/, '')
      sendSuccess(res, {
        code,
        expiresIn:       HANDOFF_TTL_MS / 1000,
        impersonationId: String(session._id),
        /* The admin app opens this; the code never touches the admin's storage. */
        clientUrl:       `${clientBase}/imp/enter?code=${code}`,
        user: { id: String(target._id), name: target.name, email: target.email },
      }, 'Impersonation handoff created')
    } catch (err) { next(err) }
  }

  updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const dto = req.body as { role?: UserRole; isActive?: boolean; isVerified?: boolean; name?: string; email?: string; category?: '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]; headline?: string; bio?: string; avatarUrl?: string; program?: 'ai' | 'digital_marketing' | 'forex' | 'jura'; sharedAcrossOrgs?: boolean }
      const user = await this.userService.adminUpdate(id, dto)
      sendSuccess(res, user, 'User updated')
    } catch (err) { next(err) }
  }

  /* ─── Enrollment requests ────────────────────── */

  listEnrollmentRequests = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q      = req.query as Record<string, string | undefined>
      const status = q['status'] ?? 'pending'
      const scope  = req.user!.categoryScope as string | undefined
      const role   = req.user!.role

      const orgId = req.user!.organizationId
      const filter: Record<string, unknown> = {
        role:             'student',
        enrollmentStatus: { $exists: true },
        /* Express-only members belong in the Express Members section, not in
           the request pipeline — EXCEPT the ones this pipeline put there.

           Rejecting a student flips signupType to 'express' on purpose, so
           they keep a browsing account. The blanket exclusion then hid them
           from the Rejected tab as well, which is the one place an admin goes
           to look at them: that tab rendered "No rejected requests" no matter
           how many there were, and the reason, the rejecting admin and the
           Re-approve button — all of which the table already knows how to
           draw — were unreachable.

           Wrapped in $and so it cannot be clobbered by the $or the approved
           tab assigns below. */
        $and: [{
          $or: [
            { signupType:       { $ne: 'express' } },
            { enrollmentStatus: { $in: ['rejected', 'cancelled'] } },
          ],
        }],
      }
      if (orgId) {
        const { Types: OTypes } = await import('mongoose')
        if (OTypes.ObjectId.isValid(orgId)) filter['organizationId'] = new OTypes.ObjectId(orgId)
      }

      // For approved tab: scoped admins only see students in their category
      if (status === 'approved' && scope) {
        filter['$or'] = [{ category: scope }, { categories: scope }]
      } else if (status === 'approved' && q['category']) {
        filter['$or'] = [{ category: q['category'] }, { categories: q['category'] }]
      }

      if (status === 'all') {
        // no enrollmentStatus filter — but still requires enrollmentStatus to exist (set above)
      } else if (status === 'rejected') {
        filter['enrollmentStatus'] = { $in: ['rejected', 'cancelled'] }
      } else {
        filter['enrollmentStatus'] = status
      }

      const projection = 'id name email avatarUrl category categories enrollmentStatus enrollmentApplication enrollmentCancellationReason rejectionReason approvedBy approvedByEmail approvedByName approvedByRole approvedAt rejectedByEmail rejectedAt isActive createdAt'

      const [docs, totalCount] = await Promise.all([
        UserModel.find(filter).select(projection).sort({ createdAt: -1 })
          .skip((page - 1) * per_page).limit(per_page).lean({ virtuals: true }),
        UserModel.countDocuments(filter),
      ])

      const mapped = (docs as any[]).map(d => ({
        ...d,
        id:         d.id ?? String(d._id),
        categories: d.categories ?? (d.category ? [d.category] : []),
        rejectionReason: d.rejectionReason ?? d.enrollmentCancellationReason,
      }))
      sendSuccess(res, mapped, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) { next(err) }
  }

  /* ─── Express Members ────────────────────────── */

  listExpressMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q       = req.query as Record<string, string | undefined>
      const status  = q['status'] ?? 'all'
      const search  = q['search']?.trim()

      const orgId2 = req.user!.organizationId
      const filter: Record<string, unknown> = {
        role:       'student',
        signupType: 'express',
      }
      if (orgId2) {
        const { Types: OTypes } = await import('mongoose')
        if (OTypes.ObjectId.isValid(orgId2)) filter['organizationId'] = new OTypes.ObjectId(orgId2)
      }

      if (status === 'active')  filter['isActive'] = true
      if (status === 'blocked') filter['isActive'] = false

      if (search) {
        const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        filter['$or'] = [{ name: re }, { email: re }]
      }

      const projection = 'id name email avatarUrl enrollmentApplication isActive createdAt signupType'
      const [docs, totalCount] = await Promise.all([
        UserModel.find(filter).select(projection).sort({ createdAt: -1 })
          .skip((page - 1) * per_page).limit(per_page).lean({ virtuals: true }),
        UserModel.countDocuments(filter),
      ])

      const mapped = (docs as any[]).map(d => ({
        id:        d.id ?? String(d._id),
        name:      d.name,
        email:     d.email,
        avatarUrl: d.avatarUrl,
        country:   d.enrollmentApplication?.homeCountry ?? null,
        isActive:  d.isActive,
        createdAt: d.createdAt,
      }))
      sendSuccess(res, mapped, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) { next(err) }
  }

  blockExpressMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')
      const userId = String(req.params['userId'] ?? '')

      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      const user = await UserModel.findOne({ _id: userId, signupType: 'express' }).select('isActive').lean()
      if (!user) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Express member not found' } }); return
      }

      const newActive = !user.isActive
      await UserModel.findByIdAndUpdate(userId, { $set: { isActive: newActive } })
      sendSuccess(res, { id: userId, isActive: newActive }, newActive ? 'Member unblocked' : 'Member blocked')
    } catch (err) { next(err) }
  }

  deleteExpressMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')
      const userId = String(req.params['userId'] ?? '')

      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      const user = await UserModel.findOne({ _id: userId, signupType: 'express' }).select('id').lean()
      if (!user) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Express member not found' } }); return
      }

      await UserModel.findByIdAndDelete(userId)
      sendSuccess(res, { id: userId }, 'Express member deleted')
    } catch (err) { next(err) }
  }

  approveEnrollment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')
      const { sendEnrollmentApproved } = await import('@/services/email.service.ts')

      const userId = String(req.params['userId'] ?? '')
      const scope  = req.user!.categoryScope as string | undefined
      const admin  = req.user!

      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      // Categories to assign: scoped admin uses their scope; full admins use body
      let assignCategories: string[] = (req.body as { categories?: string[] }).categories ?? []
      if (scope) assignCategories = [scope]
      if (!assignCategories.length) {
        res.status(400).json({ success: false, error: { code: 'MISSING_CATEGORIES', message: 'Select at least one category to assign.' } }); return
      }

      const existing = await UserModel.findById(userId).select('email name categories category enrollmentStatus signupType').lean()
      if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

      // Merge new categories with existing ones (avoid duplicates)
      const existingCats: string[] = (existing.categories as string[] | undefined) ?? (existing.category ? [existing.category as string] : [])
      const mergedCats  = [...new Set([...existingCats, ...assignCategories])]
      const primaryCat  = mergedCats[0]

      // Look up admin's full info for metadata
      const adminUser = await UserModel.findById(admin.id).select('name email role').lean()

      /* Re-approving has to undo the demotion, or it half-works in the worst
         way: enrollmentStatus flips to 'approved' while signupType stays
         'express', so the student vanishes from the Approved tab — express is
         excluded there — and stays listed as an Express Member. The admin sees
         a success toast and then cannot find the student anywhere.

         Only applied when this account is one we demoted. An express-born
         member approved through some other path keeps the type they signed up
         with; nothing here should silently promote them. */
      const wasRejected = ['rejected', 'cancelled']
        .includes(String((existing as { enrollmentStatus?: unknown }).enrollmentStatus ?? ''))

      await UserModel.findByIdAndUpdate(userId, {
        $set:   {
          enrollmentStatus: 'approved',
          ...(wasRejected && { signupType: 'full' }),
          categories:       mergedCats,
          category:         primaryCat,
          approvedBy:       admin.id,
          approvedByEmail:  adminUser?.email ?? '',
          approvedByName:   adminUser?.name ?? '',
          approvedByRole:   admin.role,
          approvedAt:       new Date(),
        },
        $unset: { enrollmentCancellationReason: '', rejectionReason: '' },
      })

      void sendEnrollmentApproved(existing.email, existing.name, mergedCats.join(', ')).catch(() => {})

      sendSuccess(res, { id: userId, enrollmentStatus: 'approved', categories: mergedCats }, 'Enrollment approved')
    } catch (err) { next(err) }
  }

  rejectEnrollment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')
      const { sendEnrollmentCancelled } = await import('@/services/email.service.ts')

      const userId = String(req.params['userId'] ?? '')
      const admin  = req.user!
      const role   = admin.role
      const { reason } = req.body as { reason: string }

      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      const existing = await UserModel.findById(userId).select('email name approvedBy').lean()
      if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

      // A programme-scoped admin can only revoke approved students in exactly
      // their own program. Pending / rejected users have no categories yet, so
      // any admin level can reject those.
      //
      // Gated on the RESOLVED scope rather than on role names. The three
      // legacy roles this used to name were sub_admin with the programme baked
      // into the role; reading the scope covers them and every sub_admin whose
      // programme is set, which is the same rule the comment above always
      // described.
      const isCategoryAdmin = !!(admin as { categoryScope?: string }).categoryScope
      if (isCategoryAdmin) {
        const studentCats: string[] = (existing as any).categories?.length
          ? (existing as any).categories
          : (existing as any).category ? [(existing as any).category] : []

        if (studentCats.length > 0) {
          const adminScope = (admin as any).categoryScope as string | undefined
          if (studentCats.length !== 1 || studentCats[0] !== adminScope) {
            const msg = studentCats.length > 1
              ? 'This student is enrolled in multiple programs. Remove the other programs first before revoking.'
              : `You can only revoke students in your own program (${adminScope}).`
            res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: msg } }); return
          }
        }
      }

      const adminUser = await UserModel.findById(admin.id).select('name email').lean()

      await UserModel.findByIdAndUpdate(userId, {
        $set: {
          enrollmentStatus:  'rejected',
          signupType:        'express',
          rejectionReason:   reason,
          rejectedBy:        admin.id,
          rejectedByEmail:   adminUser?.email ?? '',
          rejectedByName:    adminUser?.name ?? '',
          rejectedAt:        new Date(),
          categories:        [],
        },
        /* `fullRegistrationSubmittedAt` deliberately survives. It records that
           this person once completed the full form — a historical fact, not a
           current state — and erasing it left nothing to say a rejected
           account had ever been more than an express signup. Nothing filters
           on its absence. */
        $unset: {
          category:                    '',
          approvedBy:      '', approvedByEmail: '', approvedByName: '', approvedByRole: '', approvedAt: '',
        },
      })

      // Remove all course enrollments so the user loses access to all course content
      const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
      /* Read the affected courses BEFORE deleting: once the rows are gone
         there is nothing left to say which counters to bring down, and this
         path never decremented them at all. */
      const removed = await EnrollmentModel.find({ userId }, { courseId: 1 }).lean()
      await EnrollmentModel.deleteMany({ userId })
      if (removed.length) {
        await CourseModel.bulkWrite(
          removed.map(r => ({
            updateOne: { filter: { _id: r.courseId }, update: { $inc: { enrolledCount: -1 } } },
          })),
          { ordered: false },
        )
      }

      void sendEnrollmentCancelled(existing.email, existing.name, '', reason).catch(() => {})

      sendSuccess(res, { id: userId, enrollmentStatus: 'rejected' }, 'Enrollment rejected')
    } catch (err) { next(err) }
  }

  /* Keep for backward compat alias */
  cancelEnrollment = this.rejectEnrollment

  revokeToViewer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')

      const userId = String(req.params['userId'] ?? '')
      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      const existing = await UserModel.findById(userId).select('email name enrollmentStatus').lean()
      if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

      await UserModel.findByIdAndUpdate(userId, {
        $set:   { enrollmentStatus: 'pending', categories: [] },
        $unset: {
          category:    '',
          approvedBy: '', approvedByEmail: '', approvedByName: '', approvedByRole: '', approvedAt: '',
          rejectedBy: '', rejectedByEmail: '', rejectedByName: '', rejectedAt: '', rejectionReason: '',
        },
      })

      sendSuccess(res, { id: userId, enrollmentStatus: 'pending' }, 'Student reverted to viewer')
    } catch (err) { next(err) }
  }

  removeEnrollmentCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')

      const userId       = String(req.params['userId'] ?? '')
      const { category } = req.body as { category: string }
      const admin        = req.user!
      const adminScope   = (admin as any).categoryScope as string | undefined

      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      // Category-scoped admins can only remove students from their own program
      if (adminScope && category !== adminScope) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `You can only remove students from your own program (${adminScope}).` } }); return
      }

      const existing = await UserModel.findById(userId).select('email name categories category').lean()
      if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

      const existingCats: string[] = (existing.categories as string[] | undefined) ?? (existing.category ? [existing.category as string] : [])
      const updatedCats = existingCats.filter(c => c !== category)
      const primaryCat  = updatedCats[0] ?? null
      const newStatus   = updatedCats.length === 0 ? 'rejected' : 'approved'

      const adminUser = await UserModel.findById(admin.id).select('name email').lean()

      const updateDoc: Record<string, any> = {
        $set: { categories: updatedCats, category: primaryCat, enrollmentStatus: newStatus },
      }
      if (newStatus === 'rejected') {
        updateDoc.$set.rejectionReason  = `Access to the ${category} program was removed by an admin.`
        updateDoc.$set.rejectedBy       = admin.id
        updateDoc.$set.rejectedByEmail  = (adminUser as any)?.email ?? ''
        updateDoc.$set.rejectedByName   = (adminUser as any)?.name ?? ''
        updateDoc.$set.rejectedAt       = new Date()
        updateDoc.$unset = { approvedBy: '', approvedByEmail: '', approvedByName: '', approvedByRole: '', approvedAt: '' }
      }

      await UserModel.findByIdAndUpdate(userId, updateDoc)

      sendSuccess(res, { id: userId, enrollmentStatus: newStatus, categories: updatedCats }, 'Category removed')
    } catch (err) { next(err) }
  }

  updateStudentDocs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { UserModel } = await import('@/models/schema.ts')
      const { Types }     = await import('mongoose')

      const userId = String(req.params['userId'] ?? '')
      if (!Types.ObjectId.isValid(userId)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid user ID' } }); return
      }

      const { passportUrl, idDocUrl, photoUrl } = req.body as { passportUrl?: string; idDocUrl?: string; photoUrl?: string }
      const update: Record<string, unknown> = {}
      if (passportUrl !== undefined) update['enrollmentApplication.passportUrl'] = passportUrl
      if (idDocUrl    !== undefined) update['enrollmentApplication.idDocUrl']    = idDocUrl
      if (photoUrl    !== undefined) update['enrollmentApplication.photoUrl']    = photoUrl

      await UserModel.findByIdAndUpdate(userId, { $set: update })
      sendSuccess(res, { id: userId }, 'Documents updated')
    } catch (err) { next(err) }
  }

  /* ─── Sections ────────────────────────────────── */
  listSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const courseId = String(req.params['courseId'] ?? '')
      await this.sectionService.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
      const sections = await this.sectionService.list(courseId)
      sendSuccess(res, sections)
    } catch (err) { next(err) }
  }

  createSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const courseId = String(req.params['courseId'] ?? '')
      const { title, description } = req.body as { title: string; description?: string }
      await this.sectionService.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
      const section = await this.sectionService.create({ courseId, title, description })
      sendSuccess(res, section, 'Section created', 201)
    } catch (err) { next(err) }
  }

  updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const dto = req.body as { title?: string; description?: string; order?: number }
      /* Look up course to verify edit permission. */
      const section = await this.sectionRepo.findById(id)
      if (section) {
        await this.sectionService.assertCourseEditable(String(section.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      const updated = await this.sectionService.update(id, dto)
      sendSuccess(res, updated, 'Section updated')
    } catch (err) { next(err) }
  }

  deleteSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const section = await this.sectionRepo.findById(id)
      if (section) {
        await this.sectionService.assertCourseEditable(String(section.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      await this.sectionService.delete(id)
      sendSuccess(res, null, 'Section deleted')
    } catch (err) { next(err) }
  }

  reorderSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const courseId = String(req.params['courseId'] ?? '')
      const { ids } = req.body as { ids: string[] }
      await this.sectionService.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
      const sections = await this.sectionService.reorder(courseId, ids)
      sendSuccess(res, sections, 'Sections reordered')
    } catch (err) { next(err) }
  }

  /* ─── Lessons ─────────────────────────────────── */
  createLesson = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as Parameters<LessonService['create']>[0]
      /* Permission check via section → course */
      const section = await this.sectionRepo.findById(dto.sectionId)
      if (section) {
        await this.sectionService.assertCourseEditable(String(section.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      const lesson = await this.lessonService.create(dto)
      sendSuccess(res, lesson, 'Lesson created', 201)
    } catch (err) { next(err) }
  }

  updateLesson = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const existing = await this.lessonRepo.findById(id)
      if (existing) {
        await this.sectionService.assertCourseEditable(String(existing.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      const updated = await this.lessonService.update(id, req.body as Parameters<LessonService['update']>[1])
      sendSuccess(res, updated, 'Lesson updated')
    } catch (err) { next(err) }
  }

  deleteLesson = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params['id'] ?? '')
      const existing = await this.lessonRepo.findById(id)
      if (existing) {
        await this.sectionService.assertCourseEditable(String(existing.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      await this.lessonService.delete(id)
      sendSuccess(res, null, 'Lesson deleted')
    } catch (err) { next(err) }
  }

  reorderLessons = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sectionId = String(req.params['sectionId'] ?? '')
      const { ids } = req.body as { ids: string[] }
      const section = await this.sectionRepo.findById(sectionId)
      if (section) {
        await this.sectionService.assertCourseEditable(String(section.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      const lessons = await this.lessonService.reorderInSection(sectionId, ids)
      sendSuccess(res, lessons, 'Lessons reordered')
    } catch (err) { next(err) }
  }

  moveLesson = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const lessonId = String(req.params['id'] ?? '')
      const { sectionId } = req.body as { sectionId: string }
      const existing = await this.lessonRepo.findById(lessonId)
      if (existing) {
        await this.sectionService.assertCourseEditable(String(existing.courseId), req.user!.id, req.user!.role, req.user!.categoryScope)
      }
      const lesson = await this.lessonService.moveToSection(lessonId, sectionId)
      sendSuccess(res, lesson, 'Lesson moved')
    } catch (err) { next(err) }
  }

  /* ─── Course outline (sections + lessons in one call) ─── */
  getOutline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const courseId = String(req.params['id'] ?? '')
      await this.sectionService.assertCourseEditable(courseId, req.user!.id, req.user!.role, req.user!.categoryScope)
      const [sections, lessons] = await Promise.all([
        this.sectionRepo.findByCourseOrdered(courseId),
        this.lessonRepo.findByCourseOrdered(courseId),
      ])
      sendSuccess(res, { sections, lessons })
    } catch (err) { next(err) }
  }

  /* ─── Analytics extensions ────────────────────── */
  enrollmentsTimeseries = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const days = Math.min(180, Math.max(7, Number(req.query['days'] ?? 30)))
      const data = await this.admin.enrollmentsTimeseries(days, req.user!.organizationId)
      sendSuccess(res, data)
    } catch (err) { next(err) }
  }

  topCourses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = Math.min(20, Math.max(1, Number(req.query['limit'] ?? 5)))
      const data  = await this.admin.topCourses(limit, req.user!.organizationId, req.user!.categoryScope)
      sendSuccess(res, data)
    } catch (err) { next(err) }
  }

  completionStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { sendSuccess(res, await this.admin.completionStats(req.user!.organizationId)) } catch (err) { next(err) }
  }

  /* ─── Live-class stream credentials guard ─────── */
  /* The RTMP key lets whoever holds it broadcast into the session, so this
     route is gated on ownership rather than on a flat admin role.
     super_admin / admin pass through; every other caller (instructor,
     sub_admin, support, the category admins) must own the session — either
     assigned to it or owning its course. Mirrors the ownership rule already
     used by LiveClassController for the other per-session admin routes. */
  guardStreamCredentials = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = req.user!.role
      if (role === 'super_admin') { next(); return }

      const { LiveClassModel, CourseModel } = await import('@/models/schema.ts')
      const { Types } = await import('mongoose')

      const id = String(req.params['id'] ?? '')
      if (!Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid live class id' } }); return
      }
      const live = await LiveClassModel.findById(id).select('instructorId courseId organizationId').lean()
      if (!live) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return
      }

      /* Resolved first: the instructor this session names is the one person
         whose right to its stream key does not depend on which academy owns
         it. A LENT instructor broadcasting into the borrowing academy's class
         is the feature working, not a boundary crossing. See
         instructorOwnsSession in utils/tenancy.ts. */
      const owns = await instructorOwnsSession(req, live)

      /* Tenancy — the RTMP key IS the session. An admin of one academy must
         not be able to pull the other's stream key by id. Mirrors
         LiveClassController.#canManage, including the assigned-instructor
         carve-out: an instructor holding a colleague's id still gets the 404. */
      if (!owns) {
        const callerOrg = req.user!.organizationId
        const liveOrg   = (live as { organizationId?: unknown }).organizationId
        if (callerOrg && liveOrg && String(liveOrg) !== String(callerOrg)) {
          res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Live class not found' } }); return
        }
      }

      /* Non-teaching admin roles pass once tenancy is satisfied. */
      if (role !== 'instructor') { next(); return }

      if (!owns) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only fetch stream credentials for your own live classes.' } }); return
      }
      next()
    } catch (err) { next(err) }
  }
}
