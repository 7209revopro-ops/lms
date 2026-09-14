/**
 * feedback.routes.ts — Student class feedback endpoints
 *
 * POST /feedback          — submit feedback for an attended class
 * GET  /feedback/me       — my feedback history
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
/* The SHARED sendSuccess, deliberately — not a local one.

   @/utils/response.ts rewrites every stored `pub-*.r2.dev/<key>` URL in the
   response to the /assets proxy, because that bucket is private now and those
   URLs 401. A local copy of sendSuccess skips that rewrite, and the failure is
   silent: the JSON looks perfectly correct, the browser gets a URL it cannot
   fetch, and the avatar falls back to an initial. That is exactly why
   instructor photos appeared in the admin table (shared helper) and not in the
   student class-schedule filter (this file's local one), from the same stored
   value.

   Anything that serialises a stored asset URL has to go through here. */
import { sendSuccess } from '@/utils/response.ts'

const router = Router()

const feedbackSchema = z.object({
  liveClassId: z.string().min(1),
  rating:      z.coerce.number().int().min(1).max(5),
  comment:     z.string().max(1000).optional(),
})

/* ── POST /feedback ─────────────────────────────────────── */
router.post('/', authenticate, validate(feedbackSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassFeedbackModel, ClassBookingModel, LiveClassModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')

    const userId      = req.user!.id
    const { liveClassId, rating, comment } = req.body as z.infer<typeof feedbackSchema>

    if (!Types.ObjectId.isValid(liveClassId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid liveClassId' } }); return
    }

    // Must have attended the class
    const booking = await ClassBookingModel.findOne({
      userId:      new Types.ObjectId(userId),
      liveClassId: new Types.ObjectId(liveClassId),
      status:      'attended',
    }).lean()

    if (!booking) {
      res.status(403).json({ success: false, error: { code: 'NOT_ATTENDED', message: 'You must attend the class before submitting feedback' } }); return
    }

    // Upsert — student can update their feedback
    const feedback = await ClassFeedbackModel.findOneAndUpdate(
      { liveClassId: new Types.ObjectId(liveClassId), userId: new Types.ObjectId(userId) },
      { rating, comment },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    sendSuccess(res, feedback, 'Feedback submitted', 201)
  } catch (err) { next(err) }
})

/* ── GET /feedback/me ───────────────────────────────────── */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ClassFeedbackModel } = await import('@/models/schema.ts')
    const { Types } = await import('mongoose')
    const userId = req.user!.id
    const docs = await ClassFeedbackModel.find({ userId: new Types.ObjectId(userId) })
      .populate('liveClassId', 'id title scheduledStart')
      .sort({ createdAt: -1 })
      .lean({ virtuals: true })
    sendSuccess(res, docs)
  } catch (err) { next(err) }
})

export default router
