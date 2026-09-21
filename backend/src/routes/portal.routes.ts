import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env.ts'
import { sendSuccess, sendError } from '@/utils/response.ts'
import {
  listRolesForPortal,
  describeUserForPortal,
  setUserRoleFromPortal,
  provisionFromPortal,
} from '@/services/portal.service.ts'

const router = Router()

/**
 * Server-to-server, from the Root portal only.
 *
 * No session and no cookie: the caller proves itself with a shared secret,
 * compared in constant time so the comparison says nothing about how close a
 * wrong guess was.
 *
 * Unconfigured means off, not open. A deployment that has not been told about
 * the portal must not expose its people by default.
 */
function portalOnly(req: Request, res: Response, next: NextFunction): void {
  if (!env.ROOT_ERP_SECRET) {
    sendError(res, 'NOT_CONFIGURED', 'The Root portal integration is not configured — set ROOT_ERP_SECRET', 503)
    return
  }
  const presented = req.headers['x-portal-secret']
  if (typeof presented !== 'string') {
    sendError(res, 'UNAUTHORIZED', 'Bad secret', 401)
    return
  }
  const a = Buffer.from(presented)
  const b = Buffer.from(env.ROOT_ERP_SECRET)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    sendError(res, 'UNAUTHORIZED', 'Bad secret', 401)
    return
  }
  next()
}

router.use(portalOnly)

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

export default router
