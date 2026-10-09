/* ─────────────────────────────────────────────────────
   Course access, for the commission portal
   ─────────────────────────────────────────────────────
   The admin's Edit Student → Course Access (admin/src/components/users/
   EditStudentModal.tsx; routes/admin.routes.ts POST /users/:id/enrollments
   and PATCH /enrollments/:id) in Tetra Commission too (the user, 2026-10-06):
   a CS puts their student on a Forex course and opens or locks its modules
   one by one — when approving their request (portalEnrolmentRequests.service.ts)
   or any time after. Which students somebody may do this for is the portal's
   to say; it names the student by address.

     POST /service/students/course-access                { email }
     POST /service/students/course-access/give           { email, courses: [{ courseId, locked }], byName, byEmail }
     POST /service/students/course-access/:enrolmentId   { email, locked, byName, byEmail }

   Forex only (the user's choice): the published Forex courses of the
   student's own academy, and of their courses only the Forex ones. Giving a
   course is the admin's override — paid or not — made as the admin's is
   (source 'admin', the course's count kept in step), with the modules picked
   locked and every other one open; a course they are already on is left as
   it is. Locking is the admin's too: Enrollment.blockedLessons, which holds
   MODULE (section) ids, so every place that refuses a locked module enforces
   it — changed one module at a time, so nothing else in that list (an id from
   before it held modules, a lock the fee rule adds meanwhile) is lost. A
   module the fee locked (paymentAccess.service.ts) can be opened here (the
   user's choice — a CS may too); a later payment only ever opens more.
   Courses are never taken off a student here (the user's choice): locking
   every module does it without losing their progress. Each change is audited,
   from the person's own LMS staff account, else the shared
   PORTAL_SUPPORT_USER_EMAIL one with their address on it.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { UserModel, CourseModel, SectionModel, EnrollmentModel, OrganizationModel, AuditLogModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'
import { deskAccountFor } from '@/services/portalActivity.service.ts'
import { logger } from '@/utils/logger.ts'

/** The programme the portal looks after: Forex. */
export const FOREX = '4x-trading'
const MAX_COURSES = 20

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const idOf = (v: unknown) => String(v ?? '')
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '')
const oid = (id: string) => new Types.ObjectId(id)

function oneEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email must be one address')
  return email
}

/** A student, as much of them as these need. */
export type CourseStudent = { _id: unknown; name?: string; email?: string; isActive?: boolean; enrollmentStatus?: string; organizationId?: unknown }
type Module = { id: string; title: string }

async function studentByEmail(email: unknown): Promise<CourseStudent> {
  const student = await UserModel.findOne({ email: oneEmail(email), role: 'student' })
    .select('_id name email isActive enrollmentStatus organizationId').lean() as CourseStudent | null
  if (!student) throw new PortalError('NOT_FOUND', 'This student has no account in the LMS', 404)
  return student
}

/** The Forex courses a student can be put on: published, in their own academy. */
const forexCoursesFor = (student: CourseStudent): Record<string, unknown> => ({
  status: 'published',
  program: FOREX,
  /* Their academy's own, or one shared by both academies. */
  $or: [{ organizationId: student.organizationId ?? { $exists: false } }, { sharedAcademies: true }],
})

/** Each course's modules, in the order the student sees them — as the fee rule counts them (paymentAccess.service.ts). */
async function modulesOf(courseIds: unknown[]): Promise<Map<string, Module[]>> {
  const out = new Map<string, Module[]>()
  if (!courseIds.length) return out
  const rows = await SectionModel.find({ courseId: { $in: courseIds } })
    .sort({ order: 1, createdAt: 1, _id: 1 }).select('_id courseId title').lean() as unknown as { _id: unknown; courseId: unknown; title?: string }[]
  for (const r of rows) {
    const list = out.get(idOf(r.courseId)) ?? []
    list.push({ id: idOf(r._id), title: r.title ?? '' })
    out.set(idOf(r.courseId), list)
  }
  return out
}

type EnrolmentRow = {
  _id: unknown; courseId: unknown; status?: string; source?: string; progressPercent?: number
  enrolledAt?: Date; createdAt?: Date; blockedLessons?: unknown[]; paymentAccess?: { status?: string; invoiceId?: string }
}

/**
 * Their Forex courses, each module open or locked, and the Forex courses of
 * their academy they are not on yet, with the modules each has.
 */
async function accessOf(student: CourseStudent) {
  const [enrolments, catalogue, academy] = await Promise.all([
    EnrollmentModel.find({ userId: student._id })
      .select('_id courseId status source progressPercent enrolledAt createdAt blockedLessons paymentAccess').lean() as unknown as Promise<EnrolmentRow[]>,
    CourseModel.find(forexCoursesFor(student)).select('_id title').sort({ title: 1 }).lean() as unknown as Promise<{ _id: unknown; title?: string }[]>,
    student.organizationId
      ? OrganizationModel.findById(student.organizationId).select('name').lean() as unknown as Promise<{ name?: string } | null>
      : Promise.resolve(null),
  ])
  const forexOn = new Map(
    (await CourseModel.find({ _id: { $in: enrolments.map(e => e.courseId) }, program: FOREX }).select('_id title').lean() as unknown as { _id: unknown; title?: string }[])
      .map(c => [idOf(c._id), c.title ?? '']),
  )
  const modules = await modulesOf([...[...forexOn.keys()].map(oid), ...catalogue.map(c => c._id)])
  const courses = enrolments.filter(e => forexOn.has(idOf(e.courseId))).map(e => {
    const blocked = new Set((e.blockedLessons ?? []).map(idOf))
    return {
      enrolmentId: idOf(e._id),
      courseId: idOf(e.courseId),
      title: forexOn.get(idOf(e.courseId)) ?? '',
      status: e.status ?? 'active',
      how: e.paymentAccess?.invoiceId ? 'finance' : (e.source ?? 'unknown'),
      /** What the fee opened, on a course finance put them on: paid, partial or unpaid. */
      access: e.paymentAccess?.status ?? null,
      progress: e.progressPercent ?? 0,
      enrolledAt: iso(e.enrolledAt ?? e.createdAt),
      modules: (modules.get(idOf(e.courseId)) ?? []).map(m => ({ ...m, locked: blocked.has(m.id) })),
    }
  }).sort((a, b) => a.title.localeCompare(b.title))
  const on = new Set(courses.map(c => c.courseId))
  return {
    student: {
      id: idOf(student._id),
      name: student.name ?? '',
      email: String(student.email ?? '').toLowerCase(),
      academy: academy?.name ?? '',
      /** Not let in yet: they open their courses once their request is approved (requireEnrollmentApproval). */
      approved: !student.enrollmentStatus || student.enrollmentStatus === 'approved',
      active: student.isActive !== false,
    },
    courses,
    /** The Forex courses of their academy they could be put on. */
    offered: catalogue.filter(c => !on.has(idOf(c._id))).map(c => ({
      courseId: idOf(c._id), title: c.title ?? '', modules: modules.get(idOf(c._id)) ?? [],
    })),
  }
}

/** The student's Forex courses, and the ones they could be put on. */
export async function courseAccessForPortal(input: { email: unknown }) {
  return accessOf(await studentByEmail(input.email))
}

/** Who did it, from the portal: their own LMS staff account, else the shared one with their address on it. */
export async function courseActorFor(byName: unknown, byEmail: unknown) {
  const by = {
    name: (typeof byName === 'string' ? byName.trim() : '').slice(0, 100),
    email: (typeof byEmail === 'string' ? byEmail.trim().toLowerCase() : '').slice(0, 200),
  }
  const account = await deskAccountFor(by.email)
  return { by, account, email: account.own ? account.email : (by.email || account.email), from: account.own ? 'own' as const : 'shared' as const }
}
type Actor = Awaited<ReturnType<typeof courseActorFor>>

async function audit(actor: Actor, student: CourseStudent, action: string, entityId: string, meta: Record<string, unknown>) {
  await AuditLogModel.create({
    actorId: actor.account.id,
    actorEmail: actor.email,
    actorRole: actor.account.role,
    action,
    entity: 'Enrollment',
    entityId,
    meta: { via: 'tetra-commission', byName: actor.by.name, byEmail: actor.by.email, from: actor.from, studentId: idOf(student._id), ...meta },
    userAgent: 'Tetra Commission',
    organizationId: student.organizationId,
  })
}

export type CoursePlan = { courseId: string; title: string; locked: string[]; modules: Module[] }

/**
 * The courses asked for, checked before anything changes, so a wrong one gives
 * nothing (and approves nobody): Forex, published, of their academy, each
 * locked module one of that course's. `undefined` is none asked for.
 */
export async function planCourses(student: CourseStudent, raw: unknown): Promise<CoursePlan[]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw bad('courses must be a list of { courseId, locked }')
  if (raw.length > MAX_COURSES) throw bad(`At most ${MAX_COURSES} courses at a time`)
  const picks = new Map<string, string[]>()
  for (const r of raw as { courseId?: unknown; locked?: unknown }[]) {
    const courseId = typeof r?.courseId === 'string' ? r.courseId : ''
    if (!Types.ObjectId.isValid(courseId)) throw bad('Each course needs its courseId')
    if (!Array.isArray(r.locked) || r.locked.some(x => typeof x !== 'string')) throw bad('Each course needs the modules to lock (locked) — an empty list opens them all')
    if (!picks.has(courseId)) picks.set(courseId, [...new Set(r.locked as string[])])
  }
  const ids = [...picks.keys()]
  const found = new Map(
    (await CourseModel.find({ _id: { $in: ids.map(oid) }, ...forexCoursesFor(student) }).select('_id title').lean() as unknown as { _id: unknown; title?: string }[])
      .map(c => [idOf(c._id), c.title ?? '']),
  )
  if (ids.some(id => !found.has(id))) throw bad('Only the published Forex courses of their academy can be given')
  const modules = await modulesOf(ids.map(oid))
  return ids.map(courseId => {
    const list = modules.get(courseId) ?? []
    const own = new Set(list.map(m => m.id))
    const locked = picks.get(courseId)!
    if (locked.some(id => !own.has(id))) throw bad(`Only ${found.get(courseId)}'s own modules can be locked on it`)
    return { courseId, title: found.get(courseId)!, locked, modules: list }
  })
}

/** Put them on the planned courses, each with its modules locked as picked; one they are already on is left as it is. */
export async function giveCourses(student: CourseStudent, plan: CoursePlan[], actor: Actor): Promise<{ given: string[]; already: string[] }> {
  const given: string[] = []
  const already: string[] = []
  for (const p of plan) {
    if (await EnrollmentModel.exists({ userId: student._id, courseId: oid(p.courseId) })) { already.push(p.title); continue }
    let enrolmentId: unknown
    try {
      enrolmentId = (await EnrollmentModel.create({
        userId: student._id,
        courseId: oid(p.courseId),
        source: 'admin',
        blockedLessons: p.locked.map(oid),
      }))._id
    } catch (err) {
      // One enrolment per student and course (a unique index): theirs already, left as it is.
      if ((err as { code?: number }).code === 11000) { already.push(p.title); continue }
      throw err
    }
    await CourseModel.updateOne({ _id: oid(p.courseId) }, { $inc: { enrolledCount: 1 } })
    await audit(actor, student, 'enrollment.create', idOf(enrolmentId), {
      courseId: p.courseId, course: p.title, modules: p.modules.length,
      locked: p.modules.filter(m => p.locked.includes(m.id)).map(m => m.title),
    })
    given.push(p.title)
  }
  if (given.length) {
    logger.info({ studentId: idOf(student._id), given, by: actor.by, from: actor.from }, '[course access] courses given from the commission portal')
  }
  return { given, already }
}

/** Put them on Forex courses — the admin's Add course, with the modules picked locked. */
export async function giveCoursesForPortal(input: { email: unknown; courses: unknown; byName: unknown; byEmail: unknown }) {
  const student = await studentByEmail(input.email)
  const plan = await planCourses(student, input.courses ?? [])
  if (!plan.length) throw bad('Pick at least one course')
  const result = await giveCourses(student, plan, await courseActorFor(input.byName, input.byEmail))
  return { ...result, ...(await accessOf(student)) }
}

/**
 * Open or lock a course's modules — the admin's module access: `locked` is
 * every module of the course that should be locked, the rest are opened.
 */
export async function setModuleAccessForPortal(input: { email: unknown; enrolmentId: unknown; locked: unknown; byName: unknown; byEmail: unknown }) {
  const student = await studentByEmail(input.email)
  const id = typeof input.enrolmentId === 'string' ? input.enrolmentId : ''
  const enrolment = Types.ObjectId.isValid(id)
    ? await EnrollmentModel.findOne({ _id: id, userId: student._id }).select('_id courseId blockedLessons').lean() as unknown as { _id: unknown; courseId: unknown; blockedLessons?: unknown[] } | null
    : null
  const course = enrolment
    ? await CourseModel.findOne({ _id: enrolment.courseId, program: FOREX }).select('_id title').lean() as unknown as { _id: unknown; title?: string } | null
    : null
  if (!enrolment || !course) throw new PortalError('NOT_FOUND', 'No such Forex course for this student', 404)
  if (!Array.isArray(input.locked) || input.locked.some(x => typeof x !== 'string')) throw bad('locked must be the modules to lock — an empty list opens them all')

  const modules = (await modulesOf([course._id])).get(idOf(course._id)) ?? []
  const own = new Set(modules.map(m => m.id))
  const wanted = new Set(input.locked as string[])
  if ([...wanted].some(m => !own.has(m))) throw bad(`Only ${course.title ?? 'this course'}'s own modules can be locked on it`)
  const before = new Set((enrolment.blockedLessons ?? []).map(idOf))
  const opened = modules.filter(m => before.has(m.id) && !wanted.has(m.id))
  const locked = modules.filter(m => !before.has(m.id) && wanted.has(m.id))
  if (opened.length || locked.length) {
    const actor = await courseActorFor(input.byName, input.byEmail)
    // Module by module, so a lock or an opening made meanwhile (a payment, the admin) is not undone.
    if (opened.length) await EnrollmentModel.updateOne({ _id: enrolment._id }, { $pull: { blockedLessons: { $in: opened.map(m => oid(m.id)) } } })
    if (locked.length) await EnrollmentModel.updateOne({ _id: enrolment._id }, { $addToSet: { blockedLessons: { $each: locked.map(m => oid(m.id)) } } })
    await audit(actor, student, 'enrollment.access', idOf(enrolment._id), {
      courseId: idOf(course._id), course: course.title ?? '', opened: opened.map(m => m.title), locked: locked.map(m => m.title),
    })
    logger.info({ studentId: idOf(student._id), course: course.title, opened: opened.length, locked: locked.length, by: actor.by, from: actor.from },
      '[course access] modules changed from the commission portal')
  }
  return {
    changed: opened.length + locked.length > 0,
    course: course.title ?? '',
    opened: opened.map(m => m.title),
    locked: locked.map(m => m.title),
    ...(await accessOf(student)),
  }
}
