import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate, authenticateAdmin, requireRole, injectCategoryScope } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { InstructorReviewService } from '@/services/instructorReview.service.ts'
import { sendSuccess, buildPaginationMeta, parsePagination } from '@/utils/response.ts'

const router = Router()
const svc    = new InstructorReviewService()

const submitSchema = z.object({
  liveClassId: z.string().min(1),
  rating:      z.coerce.number().int().min(1).max(5),
  comment:     z.string().trim().max(2000).optional(),
})

/* ── Student ─────────────────────────────────────────── */

router.get('/pending', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await svc.listPending(req.user!.id))
  } catch (err) { next(err) }
})

router.post('/', authenticate, validate(submitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await svc.submit(
      { id: req.user!.id, role: req.user!.role },
      req.body,
    )
    sendSuccess(res, created, 'Review submitted', 201)
  } catch (err) { next(err) }
})

/* ── Admin — staff-only, mounted on authenticateAdmin so the org switcher's
   X-Organization-Id is actually honoured for a super_admin (see
   auth.middleware.ts). authenticateAny was the mistake that leaked every
   academy's data on Assignments/Recordings/Announcements earlier this
   session; this never repeats it. ─────────────────────── */

router.get(
  '/admin/leaderboard',
  authenticateAdmin,
  requireRole('super_admin', 'admin', 'sub_admin'),
  injectCategoryScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId
      const scope = req.user!.categoryScope
      sendSuccess(res, await svc.leaderboard(orgId, scope))
    } catch (err) { next(err) }
  },
)

router.get(
  '/admin/instructor/:id',
  authenticateAdmin,
  requireRole('super_admin', 'admin', 'sub_admin'),
  injectCategoryScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const orgId = req.user!.organizationId
      const scope = req.user!.categoryScope
      const { docs, totalCount } = await svc.listForInstructor(
        String(req.params['id'] ?? ''), orgId, scope, page, per_page,
      )
      sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) { next(err) }
  },
)

export default router
