import { Types } from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'
import { PROGRAMMES, programmeOf, type Programme } from '@/services/portalStudentReport.service.ts'

/* ─────────────────────────────────────────────────────────────
   Course progress (the user, 2026-10-29: "course wise filtering the
   students — which completed, and where they stop — in a separate tab in the
   student report"). For the Root portal's Reports → Students → Course
   progress. Read only.

   GET /service/course-progress?course=<id>&academy=dubai|bangalore&program=forex|digital|jura|none
   - courses: every course with a student enrolled (not dropped), how many and
     how many completed — in the academy and programme asked; the most first.
   - course: the one asked, else the one with the most students. Its modules
     (sections) and lessons in order, and each student enrolled on it:
       completed     the LMS's own: the enrolment is completed (every lesson
                     done), or every lesson is done now
       not_started   no lesson opened
       in_progress   the rest
     how many lessons done of how many, and where they stopped: the furthest
     lesson they opened, in course order, and its module. A student whose
     later modules are shut by a part payment (paymentAccess partial / unpaid)
     is marked, so a stop that is a lock does not read as giving up.
   - stops: per module, how many in-progress students stopped in it.
   Progress as it stands now — no dates. One academy at a time, by the
   student's own account; none = both.
───────────────────────────────────────────────────────────── */

// 400 throughout: Root reads a 404 as an LMS from before this report.
const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const KNOWN = Object.values(PROGRAMMES).flat() as string[]
/** Most students listed one by one; the counts are always whole. */
const MAX_LISTED = 3000

export type ProgressState = 'completed' | 'in_progress' | 'not_started'

/** One student's state on a course: the enrolment's own "completed", else from the lessons done and opened. */
export function progressState(enrolmentStatus: string | undefined, done: number, total: number, opened: number): ProgressState {
  if (enrolmentStatus === 'completed' || (total > 0 && done >= total)) return 'completed'
  return opened > 0 || done > 0 ? 'in_progress' : 'not_started'
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '')

export async function courseProgressForPortal(q: { course?: unknown; academy?: unknown; program?: unknown }) {
  const slug = typeof q.academy === 'string' ? q.academy.trim().toLowerCase() : ''
  if (slug && slug !== 'dubai' && slug !== 'bangalore') throw fail('academy is dubai or bangalore')
  const programme = (typeof q.program === 'string' ? q.program.trim().toLowerCase() : '') as Programme | ''
  if (programme && !(programme in PROGRAMMES) && programme !== 'none') throw fail('program is forex, digital, jura or none')
  const asked = typeof q.course === 'string' ? q.course.trim() : ''
  if (asked && !Types.ObjectId.isValid(asked)) throw fail('course is a course id')

  const { UserModel, EnrollmentModel, OrganizationModel, CourseModel, SectionModel, LessonModel, LessonProgressModel } = await import('@/models/schema.ts')
  const orgs = await OrganizationModel.find({}, { name: 1, slug: 1 }).lean() as any[]
  const academyName = new Map(orgs.map(o => [String(o._id), String(o.name ?? '')]))
  const org = slug ? orgs.find(o => o.slug === slug) : null
  if (slug && !org) throw fail(`No ${slug} academy in the LMS`)

  /* ── Every course with a student on it, in the programme and academy ── */
  const courses = await CourseModel.find(
    programme ? { program: programme === 'none' ? { $nin: KNOWN } : { $in: [...PROGRAMMES[programme as keyof typeof PROGRAMMES]] } } : {},
    { title: 1, program: 1 },
  ).lean() as any[]
  const courseById = new Map(courses.map(c => [String(c._id), c]))
  const enrolments = courses.length
    ? await EnrollmentModel.find({ courseId: { $in: courses.map(c => c._id) }, status: { $ne: 'dropped' } },
      { userId: 1, courseId: 1, status: 1, enrolledAt: 1, completedAt: 1, paymentAccess: 1 }).lean() as any[]
    : []
  const students = enrolments.length
    ? await UserModel.find({ _id: { $in: [...new Set(enrolments.map(e => String(e.userId)))] }, role: 'student', ...(org ? { organizationId: org._id } : {}) },
      { name: 1, email: 1, phone: 1, organizationId: 1, tetraCs: 1 }).lean() as any[]
    : []
  const userById = new Map(students.map(u => [String(u._id), u]))
  const mine = enrolments.filter(e => userById.has(String(e.userId)))

  const tally = new Map<string, { students: number; completed: number }>()
  for (const e of mine) {
    const t = tally.get(String(e.courseId)) ?? { students: 0, completed: 0 }
    t.students++
    if (e.status === 'completed') t.completed++
    tally.set(String(e.courseId), t)
  }
  const courseRows = [...tally].map(([id, t]) => {
    const c = courseById.get(id)
    return { id, title: String(c?.title ?? ''), program: programmeOf(c?.program), ...t }
  }).sort((a, b) => b.students - a.students || a.title.localeCompare(b.title))

  const base = { academy: slug || 'all', program: programme || 'all', academies: orgs.map(o => ({ slug: String(o.slug ?? ''), name: String(o.name ?? '') })), courses: courseRows }
  const pickId = asked || courseRows[0]?.id || ''
  if (!pickId) return { ...base, course: null }
  const course = courseById.get(pickId) ?? (asked ? await CourseModel.findById(asked, { title: 1, program: 1 }).lean() as any : null)
  if (!course) throw fail('No such course')

  /* ── The course's modules and lessons, in order ── */
  const [sections, lessons] = await Promise.all([
    SectionModel.find({ courseId: course._id }, { title: 1, order: 1 }).lean() as Promise<any[]>,
    LessonModel.find({ courseId: course._id }, { title: 1, order: 1, sectionId: 1 }).lean() as Promise<any[]>,
  ])
  const sectionOrder = new Map(sections.map(s => [String(s._id), s.order ?? 0]))
  const sectionTitle = new Map(sections.map(s => [String(s._id), String(s.title ?? '')]))
  sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a._id).localeCompare(String(b._id)))
  lessons.sort((a, b) => (sectionOrder.get(String(a.sectionId)) ?? 1e9) - (sectionOrder.get(String(b.sectionId)) ?? 1e9)
    || (a.order ?? 0) - (b.order ?? 0) || String(a._id).localeCompare(String(b._id)))
  const position = new Map(lessons.map((l, i) => [String(l._id), i]))
  const total = lessons.length

  /* ── Each student on it, and their lessons ── */
  const onCourse = mine.filter(e => String(e.courseId) === String(course._id))
  const progress = onCourse.length
    ? await LessonProgressModel.find({ courseId: course._id, userId: { $in: onCourse.map(e => e.userId) } },
      { userId: 1, lessonId: 1, isCompleted: 1, updatedAt: 1, completedAt: 1 }).lean() as any[]
    : []
  const byUser = new Map<string, any[]>()
  for (const p of progress) {
    if (!position.has(String(p.lessonId))) continue // a lesson since removed
    const list = byUser.get(String(p.userId)) ?? []
    list.push(p)
    byUser.set(String(p.userId), list)
  }

  const totals = { enrolled: 0, completed: 0, in_progress: 0, not_started: 0, averagePercent: 0, locked: 0 }
  const stops = new Map<string, number>()
  let percentSum = 0
  const rows = onCourse.map(e => {
    const u = userById.get(String(e.userId))
    const mineP = byUser.get(String(e.userId)) ?? []
    const done = mineP.filter(p => p.isCompleted).length
    const state = progressState(e.status, done, total, mineP.length)
    const percent = state === 'completed' ? 100 : total ? Math.min(100, Math.round((done / total) * 100)) : 0
    // The furthest lesson opened, in course order.
    const furthest = mineP.reduce<any>((best, p) => (!best || position.get(String(p.lessonId))! > position.get(String(best.lessonId))! ? p : best), null)
    const at = furthest ? lessons[position.get(String(furthest.lessonId))!] : null
    const lastAt = mineP.reduce((max, p) => (p.updatedAt && new Date(p.updatedAt) > max ? new Date(p.updatedAt) : max), new Date(0))
    const locked = e.paymentAccess?.status === 'partial' || e.paymentAccess?.status === 'unpaid' ? e.paymentAccess.status as 'partial' | 'unpaid' : null
    totals.enrolled++; totals[state]++; percentSum += percent
    if (locked) totals.locked++
    if (state === 'in_progress' && at) stops.set(String(at.sectionId), (stops.get(String(at.sectionId)) ?? 0) + 1)
    return {
      id: String(u._id), name: String(u.name ?? ''), email: String(u.email ?? ''), phone: String(u.phone ?? ''),
      academy: academyName.get(String(u.organizationId ?? '')) ?? '',
      cs: { name: String(u.tetraCs?.name ?? ''), team: String(u.tetraCs?.team ?? '') },
      state, percent, done, total,
      stoppedAt: at ? {
        sectionId: String(at.sectionId), section: sectionTitle.get(String(at.sectionId)) ?? '', lesson: String(at.title ?? ''),
        lessonNo: position.get(String(at._id))! + 1, finished: !!furthest.isCompleted,
      } : null,
      lastActivityAt: lastAt.getTime() ? lastAt.toISOString() : '',
      enrolledAt: iso(e.enrolledAt), completedAt: iso(e.completedAt), locked,
    }
  })
  totals.averagePercent = totals.enrolled ? Math.round(percentSum / totals.enrolled) : 0
  // Furthest behind first among the unfinished, then the finished; by name within.
  const rank: Record<ProgressState, number> = { not_started: 0, in_progress: 1, completed: 2 }
  rows.sort((a, b) => rank[a.state] - rank[b.state] || a.percent - b.percent || a.name.localeCompare(b.name))

  const lessonsPer = new Map<string, number>()
  for (const l of lessons) lessonsPer.set(String(l.sectionId), (lessonsPer.get(String(l.sectionId)) ?? 0) + 1)
  return {
    ...base,
    course: {
      id: String(course._id), title: String(course.title ?? ''), program: programmeOf(course.program), lessons: total,
      sections: sections.map((s, i) => ({ id: String(s._id), title: String(s.title ?? ''), no: i + 1, lessons: lessonsPer.get(String(s._id)) ?? 0, stopped: stops.get(String(s._id)) ?? 0 })),
      totals,
      students: rows.slice(0, MAX_LISTED), listed: Math.min(rows.length, MAX_LISTED),
    },
  }
}
