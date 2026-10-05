import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate, authenticateAny, authenticateAdmin, requireRole } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { ClassAssignmentService } from '@/services/classAssignment.service.ts'
import { requiredDocumentRef } from '@/utils/documentRef.ts'
import { sendSuccess } from '@/utils/response.ts'
import { departmentCourseIds } from '@/utils/departmentScope.ts'

/* ─────────────────────────────────────────────────────
   Class assignments — student sends work, instructor judges it
   ─────────────────────────────────────────────────────
   Student routes use `authenticate` (client cookie). Review routes use
   `authenticateAny`, because the queue is an ADMIN-PANEL screen and the admin
   panel carries lms_admin_at — `authenticate` reads only the client cookie,
   which is exactly how the whole Learning Paths section came to be dead
   (B-09). requireRole still restricts who may review.
───────────────────────────────────────────────────── */

const router = Router()
const svc    = new ClassAssignmentService()

const caller = (req: Request) => ({
  id:             req.user!.id,
  role:           req.user!.role,
  organizationId: req.user!.organizationId,
})
/* The reviewer, with their department's courses when they are a department's
   sub_admin (plan.md §10) — the queue, the stats and every decision are held
   to them. undefined for everyone else, which leaves them unchanged. */
const reviewer = async (req: Request) => ({
  ...caller(req),
  departmentCourseIds: (await departmentCourseIds(req)) ?? undefined,
})

/* Files are references to OUR storage, never arbitrary URLs. requiredDocumentRef
   is the same validator the KYC work uses: an own-storage URL or a bare upload
   key, and nothing else — so a submission cannot point the reviewer's browser
   at a third-party host (P-07 / P-19). The type is pinned to what
   POST /uploads/document already accepts, because the reviewer renders images
   inline; anything else would be a stored-content vector on the admin origin. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

const fileSchema = z.object({
  url:       requiredDocumentRef,
  name:      z.string().trim().min(1).max(255),
  mimeType:  z.enum(ALLOWED_MIME),
  sizeBytes: z.coerce.number().int().min(0).max(10 * 1024 * 1024),
})

const submitSchema = z.object({
  liveClassId: z.string().min(1),
  title:       z.string().trim().min(3).max(200),
  note:        z.string().max(5000).optional(),
  files:       z.array(fileSchema).min(1).max(10),
})

const resubmitSchema = z.object({
  note:  z.string().max(5000).optional(),
  files: z.array(fileSchema).min(1).max(10),
})

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason:   z.string().trim().max(2000).optional(),
})

/* ── Student ─────────────────────────────────────────── */

/* The classes this student may submit against — the form's only dropdown. */
router.get('/submittable', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await svc.submittableSessions(req.user!.id))
  } catch (err) { next(err) }
})

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await svc.listMine(req.user!.id))
  } catch (err) { next(err) }
})

router.post('/', authenticate, validate(submitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await svc.submit(caller(req), req.body)
    sendSuccess(res, created, 'Assignment submitted', 201)
  } catch (err) { next(err) }
})

router.post('/:id/resubmit', authenticate, validate(resubmitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await svc.resubmit(caller(req), String(req.params['id'] ?? ''), req.body)
    sendSuccess(res, updated, 'Revision submitted')
  } catch (err) { next(err) }
})

/* ── Reviewer ────────────────────────────────────────── */
/* These three are admin-panel-only (no student ever hits them), so they use
   authenticateAdmin rather than authenticateAny. That matters beyond cookie
   plumbing: authenticateAdmin is the only guard that reads X-Organization-Id
   for a super_admin (the org-switcher header — see auth.middleware.ts), so a
   super_admin viewing "Bangalore Academy" actually gets scoped to it here.
   authenticateAny never reads that header at all, which is what let a
   super_admin see every academy's submissions regardless of the switcher. */

const qs = (req: Request, key: string): string | undefined => {
  const v = req.query[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

router.get(
  '/review',
  authenticateAdmin,
  requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await svc.listForReview(await reviewer(req), qs(req, 'status'), qs(req, 'instructorId')))
    } catch (err) { next(err) }
  },
)

/* The review dashboard: totals, how long students are waiting, and the same
   figures broken down per instructor.

   Declared BEFORE /:id, like /submittable and /me above, or the id route
   swallows it and 'review' arrives as a submission id — a 404 that looks like
   a missing record rather than a routing mistake. */
router.get(
  '/review/stats',
  authenticateAdmin,
  requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await svc.reviewStats(await reviewer(req), qs(req, 'instructorId')))
    } catch (err) { next(err) }
  },
)

router.patch(
  '/:id/review',
  authenticateAdmin,
  requireRole('super_admin', 'admin', 'sub_admin', 'support', 'instructor'),
  validate(reviewSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { decision, reason } = req.body as { decision: 'approved' | 'rejected'; reason?: string }
      const updated = await svc.review(await reviewer(req), String(req.params['id'] ?? ''), decision, reason)
      sendSuccess(res, updated, decision === 'approved' ? 'Assignment approved' : 'Sent back to the student')
    } catch (err) { next(err) }
  },
)

/* Shared read — the student who owns it, or a reviewer who may see it.
   Declared LAST so it cannot shadow /submittable, /me or /review. */
router.get('/:id', authenticateAny, async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await svc.getForCaller(await reviewer(req), String(req.params['id'] ?? '')))
  } catch (err) { next(err) }
})

export default router
