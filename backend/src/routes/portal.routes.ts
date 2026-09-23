import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'
import {
  listRolesForPortal,
  describeUserForPortal,
  describeManyForPortal,
  listMentorsForPortal,
  createMentorMeetingForPortal,
  getMentorMeetingForPortal,
  updateMentorMeetingForPortal,
  cancelMentorMeetingForPortal,
  getClassForPortal,
  setUserRoleFromPortal,
  provisionFromPortal,
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
 * Who teaches here, when they say they are free, and what is already booked.
 *
 * A GET, unlike /accounts: this carries a date window and an organization,
 * both of which are perfectly at home in a query string.
 */
router.get('/mentors', wrap(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  sendSuccess(res, await listMentorsForPortal({ remoteOrgId: orgOf(req), from, to }), 'Mentors')
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

/* One live class in full, for the portal's calendar. This academy's own only:
   the other one's classes appear there as taken time without a subject, and an
   endpoint that opened them would undo that. */
router.get('/classes/:id', wrap(async (req, res) => {
  sendSuccess(res, await getClassForPortal({
    remoteOrgId: orgOf(req),
    classId: String(req.params['id'] ?? ''),
  }), 'Class')
}))

export default router
