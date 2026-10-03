import { Router, type Request, type Response, type NextFunction } from 'express'
import { sendSuccess, sendError } from '@/utils/response.ts'
import {
  studentActivityForPortal,
  supportTicketsForPortal,
  classAssignmentsForPortal,
} from '@/services/portalActivity.service.ts'
import { enrolmentsForPortal } from '@/services/portalEnrolments.service.ts'

/* ─────────────────────────────────────────────────────
   /service — the help desk, class assignments and students' courses, for the
   commission portal (services/portalActivity.service.ts,
   services/portalEnrolments.service.ts).

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
 * ticket, sent a class assignment, had one approved or rejected — oldest
 * first, each with a key that never changes, so the portal can ask with an
 * overlap and drop what it has already told.
 */
router.get('/student-activity', checkedCaller, wrap(async (req, res) => {
  sendSuccess(res, await studentActivityForPortal({ since: req.query['since'] }), 'Activity')
}))

/** One student's tickets, with the conversation. By email, so a POST, as /accounts is. */
router.post('/support-tickets', checkedCaller, wrap(async (req, res) => {
  const { email } = (req.body ?? {}) as { email?: unknown }
  sendSuccess(res, await supportTicketsForPortal({ email }), 'Tickets')
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
  const { emails } = (req.body ?? {}) as { emails?: unknown }
  sendSuccess(res, await enrolmentsForPortal({ emails }), 'Courses')
}))

export default router
