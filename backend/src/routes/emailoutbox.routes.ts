import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateAdmin, requireSuperAdmin } from '@/middleware/auth.middleware.ts'
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '@/utils/response.ts'
import { EmailOutboxRepository } from '@/repositories/emailoutbox.repository.ts'
import { Types } from 'mongoose'

const router = Router()
const repo   = new EmailOutboxRepository()

/* GET /email-logs — super_admin only.
   Unlike audit-logs (admin + super_admin, org-scoped), the send log is
   platform-wide with no organizationId to scope by — an academy admin has
   no natural subset of it that means anything, so this stays off
   requireAdmin entirely rather than fake a scope that doesn't exist. */
router.get(
  '/',
  authenticateAdmin,
  requireSuperAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const q = req.query as Record<string, string | undefined>

      const { docs, totalCount } = await repo.list(page, per_page, {
        status: q['status'],
        to:     q['to'],
      })
      sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) {
      next(err)
    }
  },
)

/* GET /email-logs/:id/html — the rendered body, fetched only on demand.
   A separate route rather than always including it in the list response:
   an HTML email can run to tens of KB, and a 20-row page of those is
   exactly the kind of payload that makes this page feel slow on a phone —
   the whole point of the mobile-performance work already done elsewhere in
   this app this session. */
router.get(
  '/:id/html',
  authenticateAdmin,
  requireSuperAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params['id'] === 'string' ? req.params['id'] : undefined
      if (!id || !Types.ObjectId.isValid(id)) {
        sendError(res, 'INVALID_ID', 'That is not a valid email log id.', 400)
        return
      }
      const html = await repo.findHtml(id)
      if (html === null) {
        sendError(res, 'NOT_FOUND', 'No email log entry with that id.', 404)
        return
      }
      sendSuccess(res, { html })
    } catch (err) {
      next(err)
    }
  },
)

export default router
