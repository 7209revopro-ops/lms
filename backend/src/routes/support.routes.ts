/**
 * support.routes.ts — Help / Contact-us ticketing.
 *
 *   Client (any authenticated user):
 *     POST   /support              — open a ticket
 *     GET    /support/me           — my tickets
 *     GET    /support/:id          — view one of my tickets (owner only)
 *     POST   /support/:id/messages — reply on my ticket
 *
 *   Admin (any admin role; category-scoped admins only see their program's tickets):
 *     GET    /support/admin        — all tickets (?status=&search=&program=)
 *     GET    /support/admin/stats  — status counts (scoped to their program)
 *     GET    /support/:id          — view any ticket (assertAccess enforces scope)
 *     POST   /support/:id/messages — reply to any ticket
 *     PATCH  /support/:id/status   — change status
 */
import { Router } from 'express'
import { z } from 'zod'
import { SupportController } from '@/controllers/support.controller.ts'
import {
  authenticate,
  authenticateAdmin,
  authenticateAny,
  requireAnyAdmin,
  requirePermission,
  injectCategoryScope,
} from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'

const router = Router()
const ctrl   = new SupportController()

const createSchema  = z.object({
  subject:  z.string().trim().min(3).max(200),
  category: z.enum(['technical', 'billing', 'course', 'account', 'other']).optional(),
  message:  z.string().trim().min(1).max(5000),
})
const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) })
const statusSchema  = z.object({ status: z.enum(['open', 'pending', 'resolved', 'closed']) })

/* ── Admin portal (cookie `lms_admin_at`) — declared before "/:id" ── */
router.get('/admin/performance', authenticateAdmin, requireAnyAdmin, injectCategoryScope, ctrl.performance)
router.get('/admin/stats',       authenticateAdmin, requireAnyAdmin, injectCategoryScope, ctrl.stats)
router.get('/admin',             authenticateAdmin, requireAnyAdmin, requirePermission('support','list'), injectCategoryScope, ctrl.listAll)
router.patch('/:id/status', authenticateAdmin, requireAnyAdmin, requirePermission('support','update'), injectCategoryScope, validate(statusSchema), ctrl.setStatus)

/* ── Client portal (cookie `lms_at`) ── */
router.post('/', authenticate, validate(createSchema), ctrl.create)
router.get('/me', authenticate, ctrl.myTickets)

/* ── Shared by both portals (owner-or-admin; controller enforces access) ── */
router.get('/:id',           authenticateAny, injectCategoryScope, ctrl.getOne)
router.post('/:id/messages', authenticateAny, injectCategoryScope, validate(messageSchema), ctrl.addMessage)

export default router
