import { Types } from 'mongoose'
import type { Request, Response, NextFunction } from 'express'
import { toStudentProgram, type StudentProgram } from '@/utils/programVocabulary.ts'
import { resolveCallerOrg } from '@/utils/tenancy.ts'
import { CROSS_ORG_CLASSES_ENABLED } from '@/utils/featureFlags.ts'

/* ─────────────────────────────────────────────────────
   Department isolation — one implementation  (plan.md §10)
   ─────────────────────────────────────────────────────
   Delta runs four departments — Forex, Digital Marketing, AI and Jura. A
   department's sub_admin sees, and acts on, that department's data only, in
   every admin section. tenancy.ts draws the line between ACADEMIES; this
   module draws it between DEPARTMENTS inside one. The two compose: a query
   carries both clauses, under $and (tenancy.ts andFilter).

   FOUR RULES:

     1. Only sub_admin is scoped. super_admin, admin and support see every
        department of the academies tenancy lets them reach; instructors keep
        their ownership limits, enforced where they always were.

     2. FAIL CLOSED. A sub_admin whose program is missing or unknown reaches
        nothing — never everything. injectCategoryScope refuses them up front
        (NO_DEPARTMENT); everything here treats them as "no department" too,
        for the routes that never pass through it.

     3. Filter INSIDE the query, never after the read. Filtering a page of
        results in application code is how a list paginates another
        department's rows.

     4. A single record of another department answers 404 — the same answer
        tenancy gives across academies — so an id is never confirmed to exist.

   What makes a record a department's (plan.md §10.3):
     course              course.program  ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')
     live class, booking,
     recording, feedback the class's course — or, for a class shared INTO the
                         caller's academy, that academy's own cohort course
     assignment          its courseId
     student, instructor category, or any of categories
     applicant           the programmes named on the application
     support ticket      ticket.program; when empty, the student's departments
───────────────────────────────────────────────────── */

export type Department = StudentProgram

/** A refusal on department grounds — mapped by error.middleware.ts like the
    other domain errors, so a write path that just calls next(err) answers
    with its status instead of a 500. */
export class DepartmentError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 403) {
    super(message)
    this.name = 'DepartmentError'
  }
}

/** What the caller may reach: every department (null), one, or none. */
export const NO_DEPARTMENT = Symbol('no-department')
export type CallerDepartment = Department | typeof NO_DEPARTMENT | null

const DEPARTMENTS: readonly string[] = ['4x-trading', 'digital-marketing', 'ai', 'jura']

export function callerDepartment(req: Request): CallerDepartment {
  const u = req.user
  if (!u || u.role !== 'sub_admin') return null
  /* `program` on a live request. A request rebuilt from a stored actor — the
     timetable import replays its rows in the background as { id, role,
     organizationId, categoryScope } — carries only the scope, which
     injectCategoryScope derived from that same program; without this every
     imported row was refused as "no department". */
  const fromScope = typeof u.categoryScope === 'string' && DEPARTMENTS.includes(u.categoryScope)
    ? u.categoryScope as Department : undefined
  return toStudentProgram(u.program) ?? fromScope ?? NO_DEPARTMENT
}

/** True for a sub_admin — whose every read and write is confined. */
export function isDepartmentScoped(req: Request): boolean {
  return callerDepartment(req) !== null
}

/** May the caller see records of department `program`? */
export function mayAccessDepartment(req: Request, program: unknown): boolean {
  const d = callerDepartment(req)
  if (d === null) return true
  return d !== NO_DEPARTMENT && program === d
}

const MATCH_NOTHING = { _id: { $in: [] as Types.ObjectId[] } }

/* ── Clauses ───────────────────────────────────────────
   Each returns null when the caller is unscoped, so `andFilter(filter, …)`
   is a no-op for admins and costs them nothing. */

/** Courses of the caller's department. */
export function courseClause(req: Request): Record<string, unknown> | null {
  const d = callerDepartment(req)
  if (d === null) return null
  return d === NO_DEPARTMENT ? MATCH_NOTHING : { program: d }
}

/** Students and instructors who belong to the caller's department. */
export function memberClause(req: Request): Record<string, unknown> | null {
  const d = callerDepartment(req)
  if (d === null) return null
  if (d === NO_DEPARTMENT) return MATCH_NOTHING
  return { $or: [{ category: d }, { categories: d }] }
}

/* An applicant has no category until approved (signup writes categories: []),
   so the only department signal on a pending or rejected application is the
   programme the student PICKED: an option id ('forex-beginner', 'dm-seo',
   'ai-trading', 'jura-core' — client/src/lib/programs.ts) or, on rows written
   by an older form, the human label itself ('AI & Data Science', 'Digital
   Marketing'). Anchored at the start so 'AI Trading Automation' is AI, not
   Forex. */
const APPLICATION_PATTERN: Record<Department, RegExp> = {
  '4x-trading':        /^\s*forex/i,
  'digital-marketing': /^\s*(dm-|digital[\s_-]*marketing|social\s+media|seo\b)/i,
  'ai':                /^\s*(ai(?:[\s&:,-]|$)|data\s+science)/i,
  'jura':              /^\s*(jura|uae\s+labou?r)/i,
}

/** The departments an application names, from its programme picks. */
export function departmentsNamedBy(programs: readonly unknown[] | null | undefined): Department[] {
  const found = new Set<Department>()
  for (const raw of programs ?? []) {
    const v = String(raw ?? '')
    for (const [dep, re] of Object.entries(APPLICATION_PATTERN) as Array<[Department, RegExp]>) {
      if (re.test(v)) found.add(dep)
    }
  }
  return [...found]
}

/* The programme picks speak for an APPLICANT only. They stay on the record
   after approval, and an approved student's department is the one they were
   approved into (category / categories) — so a student approved into DM who
   had also ticked a Forex option must not stay visible to the Forex head, with
   their ID scans and devices. Listed, not `$ne: 'approved'`: a record read
   without its status then reaches nobody through this arm, instead of everyone. */
const APPLICANT_STATUSES = ['pending', 'rejected', 'cancelled'] as const

/** Members of the department, plus applicants who applied to it.
    `prefix` addresses the user through a join ('user.' after a $lookup). */
export function applicantClause(req: Request, prefix = ''): Record<string, unknown> | null {
  const d = callerDepartment(req)
  if (d === null) return null
  if (d === NO_DEPARTMENT) return MATCH_NOTHING
  return {
    $or: [
      { [`${prefix}category`]: d },
      { [`${prefix}categories`]: d },
      {
        [`${prefix}enrollmentStatus`]: { $in: [...APPLICANT_STATUSES] },
        [`${prefix}enrollmentApplication.programs`]: { $regex: APPLICATION_PATTERN[d] },
      },
    ],
  }
}

/* Students enrolled on one of the department's courses, once per request —
   the Students table already counts them as the department's
   (user.repository.ts studentIdsOnProgramCourses). */
const ENROLLED = Symbol('department-enrolled-students')

export async function departmentEnrolledStudentIds(req: Request): Promise<Types.ObjectId[] | null> {
  const ids = await departmentCourseIds(req)
  if (ids === null) return null
  if (!ids.length) return []
  const memo = (req as Request & { [ENROLLED]?: Types.ObjectId[] })[ENROLLED]
  if (memo) return memo
  const { EnrollmentModel } = await import('@/models/schema.ts')
  const students = await EnrollmentModel.distinct('userId', { courseId: { $in: ids } }) as unknown as Types.ObjectId[]
  ;(req as Request & { [ENROLLED]?: Types.ObjectId[] })[ENROLLED] = students
  return students
}

/** Every student the department can reach: members, applicants who applied
    to it, and students enrolled on its courses. */
export async function studentReachClause(req: Request, prefix = ''): Promise<Record<string, unknown> | null> {
  const base = applicantClause(req, prefix)
  if (base === null || base === MATCH_NOTHING) return base
  const enrolled = (await departmentEnrolledStudentIds(req)) ?? []
  const arms = [...(base['$or'] as Record<string, unknown>[])]
  if (enrolled.length) arms.push({ [`${prefix}_id`]: { $in: enrolled } })
  return { $or: arms }
}

/** The same question about one loaded student. */
export async function mayAccessStudent(
  req: Request,
  user: { _id?: unknown; category?: string | null; categories?: string[] | null; enrollmentStatus?: string | null; enrollmentApplication?: { programs?: unknown[] } | null } | null | undefined,
): Promise<boolean> {
  if (mayAccessApplicant(req, user)) return true
  if (!user?._id || callerDepartment(req) === null) return false
  const enrolled = (await departmentEnrolledStudentIds(req)) ?? []
  return enrolled.some(id => String(id) === String(user._id))
}

/* ── The department's courses, once per request ───────
   Classes, bookings and assignments carry a courseId, not a programme, so
   scoping them means "courseId is one of the department's courses". Memoised
   on the request: a handler that scopes a list and then checks a record asks
   the database once. Deliberately NOT limited to the caller's academy — the
   academy clause rides on the main query (tenancy), and mixing the two here
   would make each depend on the other being applied. */
const COURSES = Symbol('department-course-ids')

export async function departmentCourseIds(req: Request): Promise<Types.ObjectId[] | null> {
  const d = callerDepartment(req)
  if (d === null) return null
  if (d === NO_DEPARTMENT) return []
  const memo = (req as Request & { [COURSES]?: Types.ObjectId[] })[COURSES]
  if (memo) return memo
  const { CourseModel } = await import('@/models/schema.ts')
  const rows = await CourseModel.find({ program: d }).select('_id').lean<Array<{ _id: Types.ObjectId }>>()
  const ids = rows.map(r => r._id)
  ;(req as Request & { [COURSES]?: Types.ObjectId[] })[COURSES] = ids
  return ids
}

/** `{ [field]: one of the department's courses }`, or null when unscoped. */
export async function courseIdClause(req: Request, field = 'courseId'): Promise<Record<string, unknown> | null> {
  const ids = await departmentCourseIds(req)
  return ids === null ? null : { [field]: { $in: ids } }
}

/* Live classes of the department, tied to the caller's OWN academy:

     · a class the caller's academy owns (or a legacy one owned by nobody)
       counts when its host course is the department's;
     · a class shared INTO the caller's academy counts when that academy's own
       cohort course is the department's.

   Both arms name the academy on purpose. Matching `guestCohorts.courseId`
   without it let a host academy's sub-admin list another department's class
   because a GUEST academy had put it in a matching course; matching the host
   course without the owner let a guest academy's sub-admin see a class whose
   host course matched while their own cohort course did not. */
export async function liveClassClause(req: Request): Promise<Record<string, unknown> | null> {
  const ids = await departmentCourseIds(req)
  if (ids === null) return null
  if (!ids.length) return MATCH_NOTHING
  /* With cross-academy classes switched off a class serves its owner only,
     so the host course is the whole answer (tenancy.ts servedClassFilter
     gates its guest arm the same way). */
  if (!CROSS_ORG_CLASSES_ENABLED) return { courseId: { $in: ids } }
  const org = await resolveCallerOrg(req)
  if (typeof org !== 'string' || !Types.ObjectId.isValid(org)) return { courseId: { $in: ids } }
  const oid = new Types.ObjectId(org)
  return {
    $or: [
      { courseId: { $in: ids }, organizationId: { $in: [oid, null] } },
      { guestCohorts: { $elemMatch: { organizationId: oid, courseId: { $in: ids } } } },
    ],
  }
}

/* ── Checks on one loaded record ───────────────────── */

export async function mayAccessCourseId(req: Request, courseId: unknown): Promise<boolean> {
  const d = callerDepartment(req)
  if (d === null) return true
  if (d === NO_DEPARTMENT || !courseId || !Types.ObjectId.isValid(String(courseId))) return false
  const { CourseModel } = await import('@/models/schema.ts')
  const c = await CourseModel.findById(String(courseId)).select('program').lean<{ program?: string }>()
  return !!c && c.program === d
}

type ClassLike = { courseId?: unknown; organizationId?: unknown; guestCohorts?: Array<{ organizationId?: unknown; courseId?: unknown }> }

export async function mayAccessLiveClass(req: Request, live: ClassLike | null | undefined): Promise<boolean> {
  const d = callerDepartment(req)
  if (d === null) return true
  if (d === NO_DEPARTMENT || !live) return false
  const ids = (await departmentCourseIds(req)) ?? []
  const has = (v: unknown) => !!v && ids.some(i => String(i) === String((v as { _id?: unknown })?._id ?? v))
  if (!CROSS_ORG_CLASSES_ENABLED) return has(live.courseId)
  const org = await resolveCallerOrg(req)
  const callerOrg = typeof org === 'string' ? org : null
  const owner = live.organizationId ? String((live.organizationId as { _id?: unknown })?._id ?? live.organizationId) : null
  if (has(live.courseId) && (!callerOrg || !owner || owner === callerOrg)) return true
  return !!callerOrg && (live.guestCohorts ?? []).some(g =>
    String((g.organizationId as { _id?: unknown })?._id ?? g.organizationId) === callerOrg && has(g.courseId))
}

/** A student or instructor of the department. `viaEnrolment` also counts a
    student enrolled on one of its courses — the Students table's rule. */
export async function mayAccessMember(
  req: Request,
  user: { _id?: unknown; category?: string | null; categories?: string[] | null } | null | undefined,
  opts: { viaEnrolment?: boolean } = {},
): Promise<boolean> {
  const d = callerDepartment(req)
  if (d === null) return true
  if (d === NO_DEPARTMENT || !user) return false
  if (user.category === d || (user.categories ?? []).includes(d)) return true
  if (!opts.viaEnrolment || !user._id) return false
  const ids = (await departmentCourseIds(req)) ?? []
  if (!ids.length) return false
  const { EnrollmentModel } = await import('@/models/schema.ts')
  return !!(await EnrollmentModel.exists({ userId: user._id, courseId: { $in: ids } }))
}

/** A member of the department, or an applicant who applied to it. The
    caller must load `enrollmentStatus` — without it the programme picks count
    for nothing (APPLICANT_STATUSES). */
export function mayAccessApplicant(
  req: Request,
  user: { category?: string | null; categories?: string[] | null; enrollmentStatus?: string | null; enrollmentApplication?: { programs?: unknown[] } | null } | null | undefined,
): boolean {
  const d = callerDepartment(req)
  if (d === null) return true
  if (d === NO_DEPARTMENT || !user) return false
  if (user.category === d || (user.categories ?? []).includes(d)) return true
  if (!(APPLICANT_STATUSES as readonly string[]).includes(String(user.enrollmentStatus ?? ''))) return false
  return departmentsNamedBy(user.enrollmentApplication?.programs).includes(d)
}

/** The departments OTHER than the caller's that also have this student — by
    category, or by enrolment on one of their courses (the Students table's
    rule). Reject, revert, block and removing the last programme act on the
    whole account, so a department head may not take them on a student another
    department also has: they would act on that department's student too. */
export async function otherDepartmentsOf(
  req: Request,
  user: { _id?: unknown; category?: string | null; categories?: string[] | null } | null | undefined,
): Promise<string[]> {
  const d = callerDepartment(req)
  if (d === null || d === NO_DEPARTMENT || !user) return []
  const found = new Set<string>([...(user.categories ?? []), user.category ?? ''].filter(c => c && c !== d))
  if (user._id) {
    const { EnrollmentModel, CourseModel } = await import('@/models/schema.ts')
    const courseIds = await EnrollmentModel.distinct('courseId', { userId: user._id })
    if (courseIds.length) {
      const programs = await CourseModel.distinct('program', { _id: { $in: courseIds }, program: { $nin: [null, '', d] } })
      for (const p of programs) if (p) found.add(String(p))
    }
  }
  return [...found]
}

/** A department's sub_admin may only assign its own department's instructors
    (plan.md §10, R5) — themselves excepted. Throws a 403 for the error
    middleware, the way the class-create path reports its other refusals. */
export async function assertInstructorInDepartment(req: Request, instructorId: string): Promise<void> {
  if (!isDepartmentScoped(req) || instructorId === req.user?.id) return
  let inst: { category?: string; categories?: string[] } | null = null
  if (Types.ObjectId.isValid(instructorId)) {
    const { UserModel } = await import('@/models/schema.ts')
    inst = await UserModel.findById(instructorId).select('category categories').lean<{ category?: string; categories?: string[] }>()
  }
  if (!(await mayAccessMember(req, inst))) {
    throw new DepartmentError('INSTRUCTOR_OUTSIDE_DEPARTMENT', 'Pick an instructor from your own department.', 403)
  }
}

/* ── Route guards ──────────────────────────────────────
   No-ops for an unscoped caller — no read, no cost. For a sub_admin they load
   the addressed record and answer 404 when it is another department's. */

function notFound(res: Response, what: string): void {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `${what} not found` } })
}

type Guard = (req: Request, res: Response, next: NextFunction) => Promise<void>

function guard(what: string, param: string, allowed: (req: Request, id: string) => Promise<boolean>): Guard {
  return async (req, res, next) => {
    try {
      if (!isDepartmentScoped(req)) { next(); return }
      const id = String(req.params[param] ?? '')
      if (!Types.ObjectId.isValid(id) || !(await allowed(req, id))) { notFound(res, what); return }
      next()
    } catch (err) { next(err) }
  }
}

/** The course addressed by `:param` is the caller's department's. */
export function requireDepartmentCourse(param = 'id'): Guard {
  return guard('Course', param, (req, id) => mayAccessCourseId(req, id))
}

/** The live class addressed by `:param` is the caller's department's. */
export function requireDepartmentLiveClass(param = 'id'): Guard {
  return guard('Session', param, async (req, id) => {
    const { LiveClassModel } = await import('@/models/schema.ts')
    const live = await LiveClassModel.findById(id).select('courseId organizationId guestCohorts').lean<ClassLike>()
    return mayAccessLiveClass(req, live)
  })
}

/** The booking addressed by `:param` is on one of the department's classes. */
export function requireDepartmentBooking(param = 'id'): Guard {
  return guard('Booking', param, async (req, id) => {
    const { ClassBookingModel, LiveClassModel } = await import('@/models/schema.ts')
    const b = await ClassBookingModel.findById(id).select('liveClassId').lean<{ liveClassId?: unknown }>()
    if (!b?.liveClassId) return false
    const live = await LiveClassModel.findById(String(b.liveClassId)).select('courseId organizationId guestCohorts').lean<ClassLike>()
    return mayAccessLiveClass(req, live)
  })
}

/** The student or instructor addressed by `:param` belongs to the department.
    The caller always reaches their own record: a department head carries no
    instructor category of their own, and the mentor routes behind this have
    always let anyone read and set their own calendar (`req.user.id === id`). */
export function requireDepartmentMember(param = 'id'): Guard {
  return guard('User', param, async (req, id) => {
    if (id === req.user?.id) return true
    const { UserModel } = await import('@/models/schema.ts')
    const u = await UserModel.findById(id).select('category categories role').lean<{ _id: unknown; category?: string; categories?: string[]; role?: string }>()
    return mayAccessMember(req, u, { viaEnrolment: u?.role === 'student' })
  })
}

/** The applicant addressed by `:param` is one the department can reach: its
    member, an applicant who applied to it, or a student on one of its courses
    — the Students table's rule, so a row it shows is a row it can act on. */
export function requireDepartmentApplicant(param = 'id'): Guard {
  return guard('Request', param, async (req, id) => {
    const { UserModel } = await import('@/models/schema.ts')
    const u = await UserModel.findById(id).select('category categories enrollmentStatus enrollmentApplication.programs').lean<{ _id: unknown; category?: string; categories?: string[]; enrollmentStatus?: string; enrollmentApplication?: { programs?: unknown[] } }>()
    return mayAccessStudent(req, u)
  })
}
