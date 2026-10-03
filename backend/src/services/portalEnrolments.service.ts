/* ─────────────────────────────────────────────────────
   Students' LMS courses, for the commission portal
   ─────────────────────────────────────────────────────
   Tetra Commission (the commission portal) shows which LMS courses a student
   is on — under the Enrolled switch in its Students table and on the
   student's page — and how far along they are. It asks; nothing here changes.

     POST /service/enrolments { emails }   at most MAX_EMAILS at a time

   For each address: whether the LMS has an account with it, and each course
   they are on — the course, its academy and programme, when and how they were
   put on it (bought, given by an admin, a script, a finance invoice), how much
   of it the fee has opened, how many of its modules they can open and how many
   are locked, their progress, and whether they finished it (and hold the
   certificate) or dropped it. Both academies, oldest course first.
───────────────────────────────────────────────────── */
import { UserModel, EnrollmentModel, CourseModel, OrganizationModel, SectionModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'

const MAX_EMAILS = 500

export interface PortalCourse {
  enrolmentId: string
  courseId:    string
  title:       string
  slug:        string
  program:     string
  academy:     string
  status:      string              // active, completed or dropped
  progress:    number              // percent
  enrolledAt:  string
  completedAt: string
  certificate: boolean
  /** How they were put on it: purchase, free, admin, script, unknown — or finance, for a finance invoice. */
  how:         string
  /** How much of the fee is paid, which decides how much of the course is open: paid, partial, unpaid — "" when no fee gates it. */
  access:      string
  /** The course's modules, and how many of them this student cannot open — locked until the fee is paid, or by an admin by hand. */
  modules:     { total: number; unlocked: number; locked: number }
}

export interface PortalStudentCourses {
  email:   string
  exists:  boolean
  courses: PortalCourse[]
}

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : '')
const idOf = (v: unknown) => String(v ?? '')

export async function enrolmentsForPortal(input: { emails: unknown }): Promise<{ students: PortalStudentCourses[] }> {
  if (!Array.isArray(input.emails)) throw bad('emails must be a list of addresses')
  const wanted = [...new Set(input.emails.filter((e): e is string => typeof e === 'string').map(e => e.toLowerCase().trim()).filter(Boolean))]
  if (wanted.length > MAX_EMAILS) throw bad(`At most ${MAX_EMAILS} addresses at a time, and ${wanted.length} were asked for`)
  if (!wanted.length) return { students: [] }

  const users = await UserModel.find({ email: { $in: wanted } }).select('_id email').lean() as unknown as { _id: unknown; email: string }[]
  const enrolments = users.length
    ? await EnrollmentModel.find({ userId: { $in: users.map(u => u._id) } })
      .select('userId courseId status source progressPercent enrolledAt completedAt certificateId paymentAccess blockedLessons createdAt')
      .sort({ enrolledAt: 1, createdAt: 1 })
      .lean() as unknown as {
        _id: unknown; userId: unknown; courseId: unknown; status?: string; source?: string; progressPercent?: number
        enrolledAt?: Date; completedAt?: Date; certificateId?: string; paymentAccess?: { status?: string; invoiceId?: string }
        blockedLessons?: unknown[]; createdAt?: Date
      }[]
    : []
  const courseIds = [...new Set(enrolments.map(e => idOf(e.courseId)))]
  const courses = courseIds.length
    ? await CourseModel.find({ _id: { $in: courseIds } }).select('title slug program organizationId').lean() as unknown as { _id: unknown; title?: string; slug?: string; program?: string; organizationId?: unknown }[]
    : []
  const orgIds = [...new Set(courses.map(c => idOf(c.organizationId)).filter(Boolean))]
  const orgs = orgIds.length ? await OrganizationModel.find({ _id: { $in: orgIds } }).select('name').lean() as unknown as { _id: unknown; name?: string }[] : []
  const courseById = new Map(courses.map(c => [idOf(c._id), c]))
  const orgName = new Map(orgs.map(o => [idOf(o._id), o.name ?? '']))

  /* Every module of those courses — what the fee rule and the student's course
     page count. A student's locked modules are the ones in their enrolment's
     blockedLessons (module ids, despite the name); an id left there after its
     module was deleted is not a module, so it is not counted. */
  const sections = courseIds.length
    ? await SectionModel.find({ courseId: { $in: courseIds } }).select('_id courseId').lean() as unknown as { _id: unknown; courseId: unknown }[]
    : []
  const modulesOf = new Map<string, Set<string>>()
  for (const s of sections) {
    const set = modulesOf.get(idOf(s.courseId)) ?? new Set<string>()
    set.add(idOf(s._id))
    modulesOf.set(idOf(s.courseId), set)
  }

  const byUser = new Map<string, PortalCourse[]>()
  for (const e of enrolments) {
    const c = courseById.get(idOf(e.courseId))
    const all = modulesOf.get(idOf(e.courseId)) ?? new Set<string>()
    const locked = new Set((e.blockedLessons ?? []).map(idOf).filter(id => all.has(id))).size
    const list = byUser.get(idOf(e.userId)) ?? []
    list.push({
      enrolmentId: idOf(e._id),
      courseId:    idOf(e.courseId),
      title:       c?.title ?? '',
      slug:        c?.slug ?? '',
      program:     c?.program ?? '',
      academy:     orgName.get(idOf(c?.organizationId)) ?? '',
      status:      e.status ?? 'active',
      progress:    Math.round(Number(e.progressPercent) || 0),
      enrolledAt:  iso(e.enrolledAt ?? e.createdAt),
      completedAt: iso(e.completedAt),
      certificate: !!e.certificateId,
      // A finance invoice's enrolment is recorded as a purchase; the invoice is what says it came from finance.
      how:         e.paymentAccess?.invoiceId ? 'finance' : e.source ?? 'unknown',
      access:      e.paymentAccess?.status ?? '',
      modules:     { total: all.size, unlocked: all.size - locked, locked },
    })
    byUser.set(idOf(e.userId), list)
  }

  const userByEmail = new Map(users.map(u => [String(u.email).toLowerCase(), idOf(u._id)]))
  return {
    students: wanted.map(email => {
      const id = userByEmail.get(email)
      return { email, exists: !!id, courses: id ? byUser.get(id) ?? [] : [] }
    }),
  }
}
