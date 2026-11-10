import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate, authenticateAdmin, requireRole, injectCategoryScope, requirePagePermission } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { InstructorReviewService } from '@/services/instructorReview.service.ts'
import { sendSuccess, buildPaginationMeta, parsePagination } from '@/utils/response.ts'
import { reviewFeed, readReviewFilters } from '@/services/reviewFeed.service.ts'

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

/* Instructors too (the user, 2026-11-10: "they can see their review and others review also"): their own academy's
   mentors, theirs among them. Days, programme (within an admin's own programme scope) and one mentor as filters. */
const READERS = ['super_admin', 'admin', 'sub_admin', 'instructor'] as const
const viewOf = (req: Request) => {
  const f = readReviewFilters(req.query as Record<string, unknown>)
  const scope = req.user!.categoryScope
  // A programme-scoped admin never sees past their programme, whatever is asked.
  return { ...f, program: scope ?? f.program, orgId: req.user!.organizationId }
}

router.get(
  '/admin/leaderboard',
  authenticateAdmin,
  requireRole(...READERS),
  requirePagePermission('instructor-reviews'),
  injectCategoryScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const v = viewOf(req)
      sendSuccess(res, await svc.leaderboard(v.orgId, v.program, { from: v.from, to: v.to }))
    } catch (err) { next(err) }
  },
)

/* All reviews — mentor ratings and class feedback, filtered and paged (services/reviewFeed.service.ts). */
router.get(
  '/admin/feed',
  authenticateAdmin,
  requireRole(...READERS),
  requirePagePermission('instructor-reviews'),
  injectCategoryScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await reviewFeed(viewOf(req)))
    } catch (err) { next(err) }
  },
)

router.get(
  '/admin/instructor/:id',
  authenticateAdmin,
  requireRole(...READERS),
  requirePagePermission('instructor-reviews'),
  injectCategoryScope,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, per_page } = parsePagination(req.query as Record<string, unknown>)
      const orgId = req.user!.organizationId
      const scope = req.user!.categoryScope
      // The page's days (2026-11-10).
      const f = readReviewFilters(req.query as Record<string, unknown>)
      const { docs, totalCount } = await svc.listForInstructor(
        String(req.params['id'] ?? ''), orgId, scope, page, per_page, { from: f.from, to: f.to },
      )
      sendSuccess(res, docs, undefined, 200, buildPaginationMeta(totalCount, page, per_page))
    } catch (err) { next(err) }
  },
)

export default router
