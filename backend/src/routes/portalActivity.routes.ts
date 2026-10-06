import { Router, type Request, type Response, type NextFunction } from 'express'
import { sendSuccess, sendError } from '@/utils/response.ts'
import {
  studentActivityForPortal,
  supportTicketsForPortal,
  supportTicketsForManyForPortal,
  replyToTicketForPortal,
  resolveTicketForPortal,
  classAssignmentsForPortal,
} from '@/services/portalActivity.service.ts'
import { enrolmentsForPortal } from '@/services/portalEnrolments.service.ts'
import {
  enrolmentRequestsForPortal,
  enrolmentRequestForPortal,
  requestDocumentForPortal,
  approveEnrolmentForPortal,
  rejectEnrolmentForPortal,
} from '@/services/portalEnrolmentRequests.service.ts'
import { studentViewForPortal } from '@/services/portalStudentView.service.ts'

/* ─────────────────────────────────────────────────────
   /service — the help desk, class assignments, students' courses,
   enrolment requests and "view as student", for the commission portal
   (services/portalActivity.service.ts, services/portalEnrolments.service.ts,
   services/portalEnrolmentRequests.service.ts,
   services/portalStudentView.service.ts).

   Mounted at /service after portal.routes.ts, whose secret check runs first for
   every /service request and lets through only a caller it knows — the Root
   portal's secret or the sales CRM's (the commission portal calls with the
   CRM's) — marking which on req.caller. A request without that mark never got
   past it, so one arriving here anyway, because the mounts were reordered, is
   refused rather than answered.
───────────────────────────────────────────────────── */
const router = Router()

function checkedCaller(req: Request, res: Response, next: NextFunction): void {
  if (!req.caller) {
    sendError(res, 'UNAUTHORIZED', 'Bad secret', 401)
    return
  }
  next()
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next)
  }

/**
 * What students did after `since` — opened or wrote on a Help & Support
 * ticket, sent a class assignment, had one approved or rejected, and with
 * `include=classes` attended a live class that is now over — oldest first,
 * each with a key that never changes, so the portal can ask with an overlap
 * and drop what it has already told.
 */
router.get('/student-activity', checkedCaller, wrap(async (req, res) => {
  const include = String(req.query['include'] ?? '').split(',').map(s => s.trim())
  sendSuccess(res, await studentActivityForPortal({ since: req.query['since'], classes: include.includes('classes') }), 'Activity')
}))

/**
 * One student's tickets ({ email }), or many students' ({ emails }, at most 500
 * at a time), with the conversation. By email, so a POST, as /accounts is.
 */
router.post('/support-tickets', checkedCaller, wrap(async (req, res) => {
  const { email, emails } = (req.body ?? {}) as { email?: unknown; emails?: unknown }
  sendSuccess(res, emails !== undefined ? await supportTicketsForManyForPortal({ emails }) : await supportTicketsForPortal({ email }), 'Tickets')
}))

/**
 * Answer a ticket, as the help desk does: from the answering CS's own LMS
 * account (byEmail), else the shared support account (PORTAL_SUPPORT_USER_EMAIL)
 * signed byName. Only that student's ticket: { email } names them, and a
 * ticket that is not theirs is "not found".
 */
router.post('/support-tickets/:id/reply', checkedCaller, wrap(async (req, res) => {
  const { email, body, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await replyToTicketForPortal({ ticketId: req.params['id'], email, body, byName, byEmail }), 'Answered')
}))

/** Mark that student's ticket resolved, as the help desk does. */
router.post('/support-tickets/:id/resolve', checkedCaller, wrap(async (req, res) => {
  const { email, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await resolveTicketForPortal({ ticketId: req.params['id'], email, byName, byEmail }), 'Resolved')
}))

/** One student's class assignments: what they sent for which class, and how it was reviewed. */
router.post('/class-assignments', checkedCaller, wrap(async (req, res) => {
  const { email } = (req.body ?? {}) as { email?: unknown }
  sendSuccess(res, await classAssignmentsForPortal({ email }), 'Assignments')
}))

/**
 * The LMS courses students are on, by email, at most 500 at a time: each
 * course with its academy and programme, how they were put on it, how much of
 * it the fee has opened, their progress and whether they finished or dropped
 * it. POST for the same reason as /accounts: addresses do not belong in a
 * query string.
 */
router.post('/enrolments', checkedCaller, wrap(async (req, res) => {
  const { emails, detail } = (req.body ?? {}) as { emails?: unknown; detail?: unknown }
  sendSuccess(res, await enrolmentsForPortal({ emails, detail }), 'Courses')
}))

/**
 * Enrolment requests — the admin's Requests page: a CS's students' ({ emails },
 * at most 500 at a time) or, with none, every Forex applicant's; by status,
 * newest first, a page at a time.
 */
router.post('/enrolment-requests', checkedCaller, wrap(async (req, res) => {
  const { status, emails, page, perPage } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await enrolmentRequestsForPortal({ status, emails, page, perPage }), 'Requests')
}))

/** One request, with the whole application — that student's ({ email }), else "not found". */
router.post('/enrolment-requests/:userId', checkedCaller, wrap(async (req, res) => {
  const { email } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await enrolmentRequestForPortal({ userId: req.params['userId'], email }), 'Request')
}))

/** A 5-minute link to their passport or ID scan ({ field: 'passport' | 'idDoc' }), as the admin opens one. */
router.post('/enrolment-requests/:userId/document', checkedCaller, wrap(async (req, res) => {
  const { email, field, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await requestDocumentForPortal({ userId: req.params['userId'], email, field, byName, byEmail }), 'Document')
}))

/** Let them in on Forex, as the admin's approve does — from the deciding CS's own LMS account, else the shared one. */
router.post('/enrolment-requests/:userId/approve', checkedCaller, wrap(async (req, res) => {
  const { email, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await approveEnrolmentForPortal({ userId: req.params['userId'], email, byName, byEmail }), 'Approved')
}))

/** Turn a waiting request away with the reason, as the admin's reject does. */
router.post('/enrolment-requests/:userId/reject', checkedCaller, wrap(async (req, res) => {
  const { email, reason, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await rejectEnrolmentForPortal({ userId: req.params['userId'], email, reason, byName, byEmail }), 'Rejected')
}))

/**
 * View a student's own LMS as they see it, read-only — the admin's client-portal
 * impersonation, started from the portal: a link with a 60-second single-use
 * code for the student app (services/portalStudentView.service.ts).
 */
router.post('/students/view', checkedCaller, wrap(async (req, res) => {
  const { email, byName, byEmail } = (req.body ?? {}) as Record<string, unknown>
  sendSuccess(res, await studentViewForPortal({ email, byName, byEmail }), 'View as student')
}))

export default router
