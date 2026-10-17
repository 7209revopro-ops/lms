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
        q:      q['q'],
        from:   q['from'],
        until:  q['until'],
      })
      sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) {
      next(err)
    }
  },
)

/* GET /email-logs/summary — sent / failed / pending, today and the last 7 days. */
router.get('/summary', authenticateAdmin, requireSuperAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { EmailOutboxModel } = await import('@/models/schema.ts')
    const { outboxSummary } = await import('@/utils/outboxLog.ts')
    sendSuccess(res, await outboxSummary(EmailOutboxModel))
  } catch (err) { next(err) }
})

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

/* POST /email-logs/:id/send-now — send this email at once (2026-10-17): a waiting, failed or stopped one, past the
   queue, the urgent-first hold and urgent-only mode — an admin chose this one. It may use either mailbox. Not one
   already sent (it would go twice). */
router.post('/:id/send-now', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'] : ''
    if (!Types.ObjectId.isValid(id)) { sendError(res, 'INVALID_ID', 'That is not a valid email log id.', 400); return }
    const { EmailOutboxModel } = await import('@/models/schema.ts')
    const row = await EmailOutboxModel.findById(id).select('to subject html text status').lean<{ to: string; subject: string; html: string; text?: string; status: string }>()
    if (!row) { sendError(res, 'NOT_FOUND', 'No email log entry with that id.', 404); return }
    if (row.status === 'sent') { sendError(res, 'ALREADY_SENT', 'This email was already sent.', 409); return }
    await EmailOutboxModel.updateOne({ _id: id }, { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date() }, $unset: { expiresAt: 1 } })
    const { deliverOutboxRow } = await import('@/services/email.service.ts')
    const outcome = await deliverOutboxRow({ id, to: row.to, subject: row.subject, html: row.html, text: row.text, attempts: 0, urgent: true })
    const after = await EmailOutboxModel.findById(id).select('status lastError sentAt').lean<{ status: string; lastError?: string; sentAt?: Date }>()
    if (outcome === 'sent') { sendSuccess(res, after, 'Sent.'); return }
    /* Not sent now: it stays queued (or failed for good), with why. */
    sendError(res, 'NOT_SENT', `Not sent: ${after?.lastError ?? 'the mailbox refused it'}`, 502)
  } catch (err) { next(err) }
})

export default router
