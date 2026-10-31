import { Router } from 'express'
import { z } from 'zod'
import { CourseController } from '@/controllers/course.controller.ts'
import { EnrollmentController } from '@/controllers/enrollment.controller.ts'
import { ReviewController } from '@/controllers/review.controller.ts'
import { LiveClassController } from '@/controllers/liveClass.controller.ts'
import { authenticate, optionalAuthenticate, requireEnrollmentApproval, withholdLessonContentWhileRegistrationDue } from '@/middleware/auth.middleware.ts'
import { searchRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'

const router  = Router()
const courses = new CourseController()
const enroll  = new EnrollmentController()
const reviews = new ReviewController()
const live    = new LiveClassController()

const reviewSubmitSchema = z.object({
  rating:  z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
})

const listQuerySchema = z.object({
  page:         z.coerce.number().int().min(1).default(1),
  per_page:     z.coerce.number().int().min(1).max(100).default(12),
  search:       z.string().trim().optional(),
  level:        z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  category:     z.string().trim().optional(),
  free:         z.string().optional(),  // "true" / "false" — controller coerces
  instructor:   z.string().trim().optional(),
  duration_min: z.coerce.number().int().min(0).optional(),
  duration_max: z.coerce.number().int().min(0).optional(),
  price_min:    z.coerce.number().min(0).optional(),
  price_max:    z.coerce.number().min(0).optional(),
  program:      z.enum(['4x-trading', 'digital-marketing', 'ai', 'jura']).optional(),
  /* The public /explore page's academy switch — used only when nobody is signed in (course.controller.ts). */
  academy:      z.enum(['dubai', 'bangalore']).optional(),
  /* Accept presets OR `${field}:${dir}` from admin table column sorts. */
  sort:         z.string().optional(),
})

router.get ('/',                       optionalAuthenticate, validate(listQuerySchema, 'query'), courses.list)
/* by-id lookup must come BEFORE /:slug — otherwise Express treats
   "by-id" as a slug and the wrong handler fires. */
router.get ('/by-id/:id',              optionalAuthenticate, withholdLessonContentWhileRegistrationDue, courses.getById)
router.get ('/:slug',                   optionalAuthenticate, withholdLessonContentWhileRegistrationDue, courses.getBySlug)
router.get ('/:slug/ai-notes',          searchRateLimit, authenticate, courses.getAINotes)
router.get ('/:slug/recommendations',   courses.getRecommendations)
router.get ('/:slug/rating-histogram', courses.getRatingHistogram)
router.get ('/:slug/live-classes',     optionalAuthenticate, live.listForCourseSlug)
router.get ('/:slug/progress',         authenticate, requireEnrollmentApproval, enroll.getCourseProgress)
router.get ('/:id/reviews',            reviews.listForCourse)
router.post('/:id/reviews',            authenticate, validate(reviewSubmitSchema), reviews.submit)

export default router
