import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'
import {
  listRolesForPortal,
  describeUserForPortal,
  describeManyForPortal,
  classAttendanceForPortal,
  listMentorsForPortal,
  createMentorMeetingForPortal,
  getMentorMeetingForPortal,
  updateMentorMeetingForPortal,
  cancelMentorMeetingForPortal,
  getClassForPortal,
  setUserRoleFromPortal,
  provisionFromPortal,
  addMentorTimeOffForPortal,
  removeMentorTimeOffForPortal,
} from '@/services/portal.service.ts'

const router = Router()

/**
 * Server-to-server, from the Root portal or the Delta sales CRM. Nobody else.
 *
 * No session and no cookie: each caller proves itself with its own shared
 * secret, compared in constant time so the comparison says nothing about how
 * close a wrong guess was. Two secrets rather than one shared between them —
 * revoking the CRM's access must never mean revoking the portal's, and a
 * request whose secret is wrong should not have to guess which of two
 * systems it was trying to be.
 *
 * Unconfigured means off, not open. A deployment that has not been told about
 * a caller must not expose its people to it by default — checked per caller,
 * so leaving the CRM's secret unset does not also close the portal's door.
 *
 * Which caller answered is kept on the request. Nothing downstream currently
 * reads it — every endpoint here already takes the acting person's identity
 * as part of its input, from whichever system sent it — but a system this
 * many callers deep should say who it heard from when something goes wrong,
 * not just that somebody with a valid secret asked.
 */
type Caller = 'portal' | 'crm'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: Caller
    }
  }
}

function timingSafeEqualString(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function callerAuth(req: Request, res: Response, next: NextFunction): void {
  const presented = req.headers['x-portal-secret']
  if (typeof presented !== 'string') {
    sendError(res, 'UNAUTHORIZED', 'Bad secret', 401)
    return
  }

  if (env.ROOT_ERP_SECRET && timingSafeEqualString(presented, env.ROOT_ERP_SECRET)) {
    req.caller = 'portal'
    next()
    return
  }
  if (env.SALES_CRM_SECRET && timingSafeEqualString(presented, env.SALES_CRM_SECRET)) {
    req.caller = 'crm'
    next()
    return
  }

  if (!env.ROOT_ERP_SECRET && !env.SALES_CRM_SECRET) {
    sendError(res, 'NOT_CONFIGURED', 'No caller is configured for this integration — set ROOT_ERP_SECRET or SALES_CRM_SECRET', 503)
    return
  }
  sendError(res, 'UNAUTHORIZED', 'Bad secret', 401)
}

router.use(callerAuth)

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next)
  }

const orgOf = (req: Request) =>
  typeof req.query.remoteOrgId === 'string' ? req.query.remoteOrgId : undefined

/** The roles somebody can be given here. Not organization-scoped — see the service. */
router.get('/roles', wrap((_req, res) => {
  sendSuccess(res, listRolesForPortal(), 'Roles')
}))

/** What one account actually holds here — the portal's check against drift. */
router.get('/user', wrap(async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email : ''
  if (!email) { sendError(res, 'VALIDATION_ERROR', 'email is required', 400); return }
  sendSuccess(res, await describeUserForPortal({ email, remoteOrgId: orgOf(req) }), 'Account')
}))

/** Change an existing account's role or status. Creates nothing. */
router.post('/set-user-role', wrap(async (req, res) => {
  const { email, role, status, remoteOrgId } = (req.body ?? {}) as Record<string, string>
  if (!email) { sendError(res, 'VALIDATION_ERROR', 'email is required', 400); return }
  sendSuccess(res, await setUserRoleFromPortal({
    email, role, status, remoteOrgId: remoteOrgId ?? orgOf(req),
  }), 'Changed')
}))

/** Create an account here, because a root admin asked. */
router.post('/provision-user', wrap(async (req, res) => {
  const { email, name, role, remoteOrgId } = (req.body ?? {}) as Record<string, string>
  if (!email || !role) { sendError(res, 'VALIDATION_ERROR', 'email and role are required', 400); return }
  sendSuccess(res, await provisionFromPortal({
    email, name: name ?? '', role, remoteOrgId: remoteOrgId ?? orgOf(req),
  }), 'Account created')
}))

/**
 * The same question as /user, asked about many people at once.
 *
 * POST rather than GET because a page of addresses does not belong in a query
 * string, where it would be logged by every proxy in front of this. The
 * organization may arrive either way, as it does for the other POSTs here.
 */
router.post('/accounts', wrap(async (req, res) => {
  const { emails, remoteOrgId } = (req.body ?? {}) as { emails?: unknown; remoteOrgId?: string }
  sendSuccess(res, await describeManyForPortal({
    emails, remoteOrgId: remoteOrgId ?? orgOf(req),
  }), 'Accounts')
}))

/**
 * Which live classes students booked and whether they came — for the Tetra
 * Commission portal, by email, at most 500 at a time: only the counts, or the
 * classes themselves with `detail: true`; only classes of courses they are
 * enrolled in unless `allCourses: true`. POST for the same reason as
 * /accounts: addresses do not belong in a query string.
 */
router.post('/class-attendance', wrap(async (req, res) => {
  const { emails, detail, allCourses } = (req.body ?? {}) as { emails?: unknown; detail?: unknown; allCourses?: unknown }
  sendSuccess(res, await classAttendanceForPortal({ emails, detail: detail === true, allCourses: allCourses === true }), 'Classes')
}))

/**
 * Who teaches here, when they say they are free, and what is already booked.
 *
 * A GET, unlike /accounts: this carries a date window and an organization,
 * both of which are perfectly at home in a query string.
 */
router.get('/mentors', wrap(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  // ?allAcademies=1 — both academies' mentors (the portal's Mentor Calendar, 2026-10-15).
  const allAcademies = req.query.allAcademies === '1' || req.query.allAcademies === 'true'
  /* ?timeOffReasons=all — each time off with its reason, for a caller that shows it only to whom it should (the
     commission portal: the mentor, their chief, admins). Without it every time off is "Not available" alone. */
  const timeOffReasonsFor = req.query.timeOffReasons === 'all' ? 'all' : undefined
  sendSuccess(res, await listMentorsForPortal({ remoteOrgId: orgOf(req), from, to, allAcademies, timeOffReasonsFor }), 'Mentors')
}))

/* A mentor's time off (2026-10-23): marked from the commission portal — for the mentor it names, by email; who may
   is the portal's rule. Every booking over it, from any portal, is refused from then on. What was already booked
   inside it comes back as alreadyBooked: told, never cancelled. */
router.post('/mentor-time-off', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await addMentorTimeOffForPortal({
    mentorEmail: String(body.mentorEmail ?? ''), startsAt: String(body.startsAt ?? ''), endsAt: String(body.endsAt ?? ''),
    allDay: body.allDay === true, reason: String(body.reason ?? ''), byEmail: String(body.byEmail ?? ''), byName: String(body.byName ?? ''),
  }), 'Time off marked')
}))

/* Taken away — free to be booked again. The mentor's email rides along so one mentor's time off can't be removed
   by naming another's. */
router.post('/mentor-time-off/:id/remove', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await removeMentorTimeOffForPortal({ mentorEmail: String(body.mentorEmail ?? ''), timeOffId: String(req.params['id'] ?? '') }), 'Time off removed')
}))

/**
 * Book time with a mentor that is not a class.
 *
 * Separate from anything in the live-class routes on purpose: this creates no
 * course content, enrols nobody, and tells no cohort. It puts an hour in one
 * person's diary and mails the two people it concerns.
 */
router.post('/mentor-meetings', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await createMentorMeetingForPortal({
    ...body,
    remoteOrgId: (body.remoteOrgId as string) ?? orgOf(req),
  } as Parameters<typeof createMentorMeetingForPortal>[0]), 'Meeting booked')
}))

/* One meeting in full, for whoever may change it.

   Who is asking travels in the query string: this server has no idea who is
   signed in to the portal, and the answer differs depending on whether they
   arranged this hour. A caller who may not change it is told the meeting does
   not exist — no business learning whose it is or who is on it. */
router.get('/mentor-meetings/:id', wrap(async (req, res) => {
  sendSuccess(res, await getMentorMeetingForPortal({
    remoteOrgId: orgOf(req),
    meetingId: String(req.params['id'] ?? ''),
    actorEmail: typeof req.query['actorEmail'] === 'string' ? req.query['actorEmail'] : '',
    actorIsRootAdmin: req.query['actorIsRootAdmin'] === 'true',
  }), 'Meeting')
}))

/* Move it, or change who is on it. */
router.patch('/mentor-meetings/:id', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await updateMentorMeetingForPortal({
    ...body,
    remoteOrgId: (body.remoteOrgId as string) ?? orgOf(req),
    meetingId: String(req.params['id'] ?? ''),
  } as Parameters<typeof updateMentorMeetingForPortal>[0]), 'Meeting updated')
}))

/* Call it off. A POST rather than a DELETE because nothing is deleted: the row
   is marked and kept, so there is still an answer to "what happened to
   Tuesday" after it has vanished from the calendar. */
router.post('/mentor-meetings/:id/cancel', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await cancelMentorMeetingForPortal({
    remoteOrgId: (body.remoteOrgId as string) ?? orgOf(req),
    meetingId: String(req.params['id'] ?? ''),
    actorEmail: String(body.actorEmail ?? ''),
    actorIsRootAdmin: body.actorIsRootAdmin === true,
  }), 'Meeting cancelled')
}))

/* How a student meeting went (2026-10-27, meetingOutcome.service.ts) — Tetra Commission asking for its mentors.
   ?mentorEmail= — the meetings waiting on that mentor (none for anybody who isn't one). */
router.get('/meeting-outcomes/pending', wrap(async (req, res) => {
  const { pendingOutcomesForEmail } = await import('@/services/meetingOutcome.service.ts')
  sendSuccess(res, { meetings: await pendingOutcomesForEmail(req.query['mentorEmail']) }, 'Meetings waiting')
}))

/* The form's lists: stages, payment modes, courses with their modules, mentors. */
router.get('/meeting-outcomes/options', wrap(async (_req, res) => {
  const { outcomeOptions } = await import('@/services/meetingOutcome.service.ts')
  sendSuccess(res, await outcomeOptions(), 'Outcome options')
}))

/* The outcomes filled from ?since= on, oldest first — for Tetra Commission to put on its students. */
/* The student meetings booked from Tetra Commission, with where each stands and its outcome — ?from=&to= (Dubai days)
   and/or ?emails= (2026-10-28: its Meetings tab, Meetings done page and report). Read only. */
router.get('/meeting-outcomes/meetings', wrap(async (req, res) => {
  const { meetingsForPortal } = await import('@/services/meetingOutcome.service.ts')
  sendSuccess(res, await meetingsForPortal(req.query as Record<string, unknown>), 'Meetings')
}))

router.get('/meeting-outcomes', wrap(async (req, res) => {
  const { outcomesSince } = await import('@/services/meetingOutcome.service.ts')
  sendSuccess(res, await outcomesSince(req.query['since'], Number(req.query['limit'] ?? 200) || 200), 'Meeting outcomes')
}))

/* The mentor (mentorEmail) says how it went — once; the first to fill it, here or in LMS admin, counts. */
router.post('/mentor-meetings/:id/outcome', wrap(async (req, res) => {
  const { saveOutcomeForEmail } = await import('@/services/meetingOutcome.service.ts')
  const body = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await saveOutcomeForEmail(body.mentorEmail, req.params['id'], body), 'Outcome saved')
}))

/* One live class in full, for the portal's calendar. This academy's own only:
   the other one's classes appear there as taken time without a subject, and an
   endpoint that opened them would undo that. */
router.get('/classes/:id', wrap(async (req, res) => {
  sendSuccess(res, await getClassForPortal({
    remoteOrgId: orgOf(req),
    classId: String(req.params['id'] ?? ''),
  }), 'Class')
}))

/* ── Programs (Tetra Commission's user, 2026-10-09) ─────────────────────────────────────────────────────
   Repeating live classes for chosen students, made from the portal for a CS's students
   (services/program.service.ts). The portal decides who may; here the portal is the actor, and the
   person behind it is recorded by name and email. */
async function portalProgramActor(req: Request) {
  const { OrganizationModel } = await import('@/models/schema.ts')
  const body = (req.body ?? {}) as Record<string, unknown>
  const org = orgOf(req) ?? (typeof body['remoteOrgId'] === 'string' ? body['remoteOrgId'] : undefined)
  if (!org || !(await OrganizationModel.exists({ _id: org }).catch(() => null))) {
    const { ProgramError } = await import('@/services/program.service.ts')
    throw new ProgramError('Say which academy (remoteOrgId)', 400)
  }
  return { role: 'portal', organizationId: String(org), email: String(body['actorEmail'] ?? req.query['actorEmail'] ?? ''), name: String(body['actorName'] ?? '') }
}

router.get('/programs', wrap(async (req, res) => {
  const { listPrograms } = await import('@/services/program.service.ts')
  // Without filters: every program of the academy. With them: programs with any of these students, or made by this person.
  const emails = typeof req.query['studentEmails'] === 'string' ? req.query['studentEmails'].split(',').map(e => e.trim()).filter(Boolean) : null
  const by = typeof req.query['createdByEmail'] === 'string' ? req.query['createdByEmail'].trim().toLowerCase() : ''
  const actor = await portalProgramActor(req)
  if (!emails && !by) { sendSuccess(res, await listPrograms(actor), 'Programs'); return }
  const withStudents = emails?.length ? await listPrograms(actor, { studentEmails: emails }) : []
  const mine = by ? (await listPrograms(actor)).filter(p => p.createdByEmail.toLowerCase() === by) : []
  const seen = new Set<string>()
  sendSuccess(res, [...mine, ...withStudents].filter(p => !seen.has(p.id) && !!seen.add(p.id)), 'Programs')
}))

router.post('/programs', wrap(async (req, res) => {
  const { createProgram } = await import('@/services/program.service.ts')
  sendSuccess(res, await createProgram((req.body ?? {}) as Record<string, any>, await portalProgramActor(req)), 'Program created')
}))

router.get('/programs/:id', wrap(async (req, res) => {
  const { getProgram } = await import('@/services/program.service.ts')
  sendSuccess(res, await getProgram(String(req.params['id'] ?? ''), await portalProgramActor(req)), 'Program')
}))

router.post('/programs/:id/students', wrap(async (req, res) => {
  const { changeStudents } = await import('@/services/program.service.ts')
  sendSuccess(res, await changeStudents(String(req.params['id'] ?? ''), (req.body ?? {}) as any, await portalProgramActor(req)), 'Students changed')
}))

router.patch('/programs/:id', wrap(async (req, res) => {
  const { rescheduleProgram } = await import('@/services/program.service.ts')
  sendSuccess(res, await rescheduleProgram(String(req.params['id'] ?? ''), (req.body ?? {}) as any, await portalProgramActor(req)), 'Program changed')
}))

router.post('/programs/:id/stop', wrap(async (req, res) => {
  const { stopProgram } = await import('@/services/program.service.ts')
  sendSuccess(res, await stopProgram(String(req.params['id'] ?? ''), await portalProgramActor(req)), 'Program stopped')
}))

/* Exams (2026-10-10, portalExams.service.ts): an academy's published exams, and one student's — with their state and
   a sign-in link straight into each. Read only (a student's list mints their usual 24-hour sign-in links). */
/* A student's emails (2026-10-17, portalStudentEmails.service.ts): the email queue's rows for their address — the
   list without bodies, and one email's body. Read only. */
router.get('/student-emails', wrap(async (req, res) => {
  const { studentEmailsForPortal } = await import('@/services/portalStudentEmails.service.ts')
  sendSuccess(res, await studentEmailsForPortal(req.query.email, req.query.limit), 'Student emails')
}))

router.get('/student-emails/:id', wrap(async (req, res) => {
  const { studentEmailForPortal } = await import('@/services/portalStudentEmails.service.ts')
  sendSuccess(res, await studentEmailForPortal(req.params['id'], req.query.email), 'Student email')
}))

/* Instructor reviews (2026-10-22): the students' ratings after each class — the leaderboard of every academy, with each
   instructor's address so the portal can show a chief only their own team's, and one instructor's reviews. Read only. */
router.get('/instructor-reviews', wrap(async (_req, res) => {
  const { InstructorReviewService } = await import('@/services/instructorReview.service.ts')
  sendSuccess(res, await new InstructorReviewService().leaderboard(undefined, undefined), 'Instructor reviews')
}))

router.get('/instructor-reviews/:id', wrap(async (req, res) => {
  // Mentor ratings and class feedback together (2026-10-25, portalMentorReport.service.ts).
  const { mentorReviewsForPortal } = await import('@/services/portalMentorReport.service.ts')
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(req.query.per_page) || 50)))
  // ?from=&to= — days (Dubai), to included (2026-10-23, the Mentor Report): only the reviews left in them.
  const dayStart = (v: unknown, add = 0) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(new Date(`${v}T00:00:00+04:00`).getTime() + add) : undefined
  const range = { from: dayStart(req.query.from), to: dayStart(req.query.to, 86_400_000) }
  sendSuccess(res, await mentorReviewsForPortal(String(req.params['id'] ?? ''), page, perPage, range), 'Reviews')
}))

/* The mentors' report (2026-10-23, portalMentorReport.service.ts): per instructor and day — classes held and
   cancelled, bookings and their cancellations / attendance, 1:1 meetings, reviews. ?from=&to= (days, Dubai), and
   &emails= to name the instructors (a chief's team). Read only. */
router.get('/mentor-report', wrap(async (req, res) => {
  const { mentorReportForPortal } = await import('@/services/portalMentorReport.service.ts')
  sendSuccess(res, await mentorReportForPortal(req.query), 'Mentor report')
}))

/* What is behind each number of the mentors' report (2026-10-27, portalMentorDetail.service.ts): the classes, the
   bookings and their students, the meetings and the Programs — ?kind=&from=&to=, &emails= (a chief's team),
   &instructorId= (one mentor), &programId= (one Program). Read only. */
router.get('/mentor-report/details', wrap(async (req, res) => {
  const { mentorReportDetailForPortal } = await import('@/services/portalMentorDetail.service.ts')
  sendSuccess(res, await mentorReportDetailForPortal(req.query as Record<string, unknown>), 'Mentor report details')
}))

/* What waits on each mentor (2026-10-28, portalMentorPending.service.ts): meeting outcome forms, classes to verify,
   students' unread messages — every instructor, or ?emails=. Tetra Commission's Dashboard. Read only. */
router.get('/mentor-pending', wrap(async (req, res) => {
  const { mentorPendingForPortal } = await import('@/services/portalMentorPending.service.ts')
  sendSuccess(res, await mentorPendingForPortal(req.query), 'Mentor pending')
}))

/* Programs a student completed (2026-10-25, portalProgramCompletions.service.ts): ended programs, each student who
   attended any of them with attended / held — completed when every held class. ?since=YYYY-MM-DD (end date). Read only. */
router.get('/program-completions', wrap(async (req, res) => {
  const { programCompletionsForPortal } = await import('@/services/portalProgramCompletions.service.ts')
  sendSuccess(res, await programCompletionsForPortal(req.query), 'Program completions')
}))

router.get('/exams', wrap(async (req, res) => {
  const { listExamsForPortal } = await import('@/services/portalExams.service.ts')
  sendSuccess(res, await listExamsForPortal(req.query.academy), 'Exams')
}))

router.get('/exams/student', wrap(async (req, res) => {
  const { studentExamsForPortal } = await import('@/services/portalExams.service.ts')
  sendSuccess(res, await studentExamsForPortal(req.query.email), 'Student exams')
}))

/* Pending (2026-10-11, portalPending.service.ts): what the admin sidebar's badges count — Requests, Support,
   mentors' Messages — and whom each waits on, for the Root portal's Pending page. Read only. The Root portal's
   alone: it names every staff account and its backlog, which the sales CRM has no use for. */
router.get('/pending', wrap(async (req, res) => {
  if (req.caller !== 'portal') {
    sendError(res, 'FORBIDDEN', 'Only the Root portal reads what is pending', 403)
    return
  }
  const { pendingForPortal } = await import('@/services/portalPending.service.ts')
  sendSuccess(res, await pendingForPortal(), 'Pending')
}))

export default router
