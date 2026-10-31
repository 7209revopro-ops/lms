import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireRegistrationComplete } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { AssignmentService } from '@/services/assignment.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import type { Request, Response, NextFunction } from 'express'

const router     = Router()
const assignSvc  = new AssignmentService()

const submitSchema = z.object({
  submissionUrl:  z.string().url().max(2048).optional(),
  submissionText: z.string().max(20000).optional(),
}).refine(d => d.submissionUrl || d.submissionText, {
  message: 'Provide a URL or text submission',
})

/* GET /assignments/lessons/:lessonId — get assignment details.
   Enrolment-gated (P-20): submitting was checked, reading was not, so any
   authenticated account — including an unapproved viewer and the other
   academy's students — could pull a paid course's assignment instructions by
   lesson id. Staff read freely; the admin editor uses its own route. */
router.get('/lessons/:lessonId', authenticate, requireRegistrationComplete, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await assignSvc.getByLesson(String(req.params['lessonId'] ?? ''))
    if (assignment && req.user!.role === 'student') {
      const { EnrollmentRepository } = await import('@/repositories/enrollment.repository.ts')
      const enrolled = await new EnrollmentRepository()
        .findByUserCourse(req.user!.id, assignment.courseId.toString())
      if (!enrolled) {
        res.status(403).json({
          success: false,
          error: { code: 'NOT_ENROLLED', message: 'You must be enrolled to view this assignment' },
        }); return
      }
    }
    sendSuccess(res, assignment ?? null)
  } catch (err) { next(err) }
})

/* GET /assignments/lessons/:lessonId/my-submission — student's own submission */
router.get('/lessons/:lessonId/my-submission', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const submission = await assignSvc.getMySubmission(req.user!.id, String(req.params['lessonId'] ?? ''))
    sendSuccess(res, submission ?? null)
  } catch (err) { next(err) }
})

/* POST /assignments/lessons/:lessonId/submit — submit assignment */
router.post('/lessons/:lessonId/submit', authenticate, requireRegistrationComplete, validate(submitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    const submission = await assignSvc.submit(req.user!.id, lessonId, req.body)
    sendSuccess(res, submission, 'Assignment submitted', 201)
  } catch (err) { next(err) }
})

export default router
