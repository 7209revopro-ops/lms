import { Types } from 'mongoose'
import { env } from '@/config/env.ts'
import { ExamModel, ExamAttemptModel, CourseModel, EnrollmentModel, OrganizationModel, UserModel } from '@/models/schema.ts'
import { mintSigninCode } from '@/services/signinLink.service.ts'
import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   Exams for the commission portal (2026-10-10) — read only.

   GET /service/exams?academy=dubai|bangalore
     The published exams of that academy's courses (and of courses shared with
     both academies): course, title, length, pass mark, window, questions, and
     the plain exam address (the student signs in as usual).

   GET /service/exams/student?email=
     One student's exams — the published exams of the courses they are
     enrolled on — with where they stand (not started / in progress /
     submitted / suspended, graded with marks and pass) and a sign-in link
     made for them now: one tap signs them in and opens the exam (the usual
     sign-in link — 24 hours, 3 sign-ins). Nothing else is written.
───────────────────────────────────────────────────────────── */

const fail = (message: string, statusCode: number) =>
  new PortalError(statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message, statusCode)

const site = () => env.CLIENT_URL.replace(/\/+$/, '')
const examPath = (courseId: unknown) => `/exam/${String(courseId)}`

const openWindow = (e: any) => ({
  availableFrom: e.availableFrom ? new Date(e.availableFrom).toISOString() : null,
  availableTo:   e.availableTo ? new Date(e.availableTo).toISOString() : null,
})

export async function listExamsForPortal(academy: unknown) {
  const slug = String(academy ?? '').toLowerCase()
  if (slug !== 'dubai' && slug !== 'bangalore') throw fail('academy is "dubai" or "bangalore"', 400)
  const org = await OrganizationModel.findOne({ slug }).select('_id name').lean() as any
  if (!org) throw fail(`No ${slug} academy on this server`, 404)

  const courses = await CourseModel.find({ $or: [{ organizationId: org._id }, { sharedAcademies: true }] })
    .select('title organizationId sharedAcademies').lean() as any[]
  const byId = new Map(courses.map((c) => [String(c._id), c]))
  const exams = await ExamModel.find({ isPublished: true, courseId: { $in: courses.map((c) => c._id) } })
    .select('courseId title durationMinutes passPercent questions availableFrom availableTo').lean() as any[]

  return {
    academy: slug,
    exams: exams
      .map((e) => {
        const c = byId.get(String(e.courseId))
        return {
          id: String(e._id), courseId: String(e.courseId), course: c?.title ?? '',
          shared: !!c?.sharedAcademies && String(c?.organizationId) !== String(org._id),
          title: e.title, durationMinutes: e.durationMinutes, passPercent: e.passPercent,
          questionCount: (e.questions ?? []).length, ...openWindow(e),
          link: `${site()}${examPath(e.courseId)}`,
        }
      })
      .sort((a, b) => a.course.localeCompare(b.course)),
  }
}

export async function studentExamsForPortal(email: unknown) {
  const e = String(email ?? '').trim().toLowerCase()
  if (!e) throw fail('email is required', 400)
  const user = await UserModel.findOne({ email: e }).select('_id').lean() as any
  if (!user) return { account: false, exams: [] }

  const enrolled = await EnrollmentModel.find({ userId: user._id }).select('courseId').lean() as any[]
  const courseIds = [...new Set(enrolled.map((x) => String(x.courseId)))].map((id) => new Types.ObjectId(id))
  if (!courseIds.length) return { account: true, exams: [] }
  const [exams, courses] = await Promise.all([
    ExamModel.find({ isPublished: true, courseId: { $in: courseIds } })
      .select('courseId title durationMinutes passPercent questions availableFrom availableTo').lean() as Promise<any[]>,
    CourseModel.find({ _id: { $in: courseIds } }).select('title').lean() as Promise<any[]>,
  ])
  const title = new Map(courses.map((c) => [String(c._id), c.title]))
  const attempts = exams.length
    ? await ExamAttemptModel.find({ userId: user._id, examId: { $in: exams.map((x) => x._id) } })
      .select('examId status startedAt submittedAt suspendedReason totalMarks maxMarks passed gradedAt').lean() as any[]
    : []
  const attemptOf = new Map(attempts.map((a) => [String(a.examId), a]))

  const out = []
  for (const x of exams) {
    const a = attemptOf.get(String(x._id))
    const code = await mintSigninCode(String(user._id), examPath(x.courseId))
    out.push({
      id: String(x._id), courseId: String(x.courseId), course: title.get(String(x.courseId)) ?? '',
      title: x.title, durationMinutes: x.durationMinutes, passPercent: x.passPercent,
      questionCount: (x.questions ?? []).length, ...openWindow(x),
      status: a ? (a.gradedAt ? 'graded' : a.status) : 'not_started',
      startedAt: a?.startedAt ?? null, submittedAt: a?.submittedAt ?? null, suspendedReason: a?.suspendedReason ?? null,
      totalMarks: a?.gradedAt ? a.totalMarks ?? null : null, maxMarks: a?.gradedAt ? a.maxMarks ?? null : null,
      passed: a?.gradedAt ? a.passed ?? null : null,
      link: `${site()}/s/${code}`,
    })
  }
  return { account: true, exams: out.sort((p, q) => p.course.localeCompare(q.course)) }
}
