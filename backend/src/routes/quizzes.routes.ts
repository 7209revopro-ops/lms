import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireRegistrationComplete } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { QuizService } from '@/services/quiz.service.ts'
import { StreakService } from '@/services/streak.service.ts'
import { ProgressService } from '@/services/progress.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import type { Request, Response, NextFunction } from 'express'

const router     = Router()
const quizSvc    = new QuizService()
const streakSvc  = new StreakService()
const progressSvc = new ProgressService()

const submitSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1),
    answer:     z.string(),
  })).min(1),
})

/* GET /quizzes/lessons/:lessonId — student gets quiz questions (no answers) */
router.get('/lessons/:lessonId', authenticate, requireRegistrationComplete, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const quiz = await quizSvc.getForStudent(req.user!.id, String(req.params['lessonId'] ?? ''))
    sendSuccess(res, quiz)
  } catch (err) { next(err) }
})

/* GET /quizzes/lessons/:lessonId/summary — user's attempt history */
router.get('/lessons/:lessonId/summary', authenticate, requireRegistrationComplete, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await quizSvc.getSummary(req.user!.id, String(req.params['lessonId'] ?? ''))
    sendSuccess(res, summary)
  } catch (err) { next(err) }
})

/* POST /quizzes/lessons/:lessonId/submit — submit an attempt */
router.post('/lessons/:lessonId/submit', authenticate, requireRegistrationComplete, validate(submitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lessonId = String(req.params['lessonId'] ?? '')
    const { answers } = req.body as { answers: Array<{ questionId: string; answer: string }> }
    const result = await quizSvc.submit(req.user!.id, lessonId, answers)

    /* If passed: mark lesson complete + record streak activity */
    if (result.passed) {
      void progressSvc.markComplete(req.user!.id, lessonId).catch(() => {/* lesson may already be complete */})
      void streakSvc.recordActivity(req.user!.id).catch(() => {/* non-critical */})
    }

    sendSuccess(res, result, result.passed ? 'Quiz passed!' : 'Quiz submitted', 200)
  } catch (err) { next(err) }
})

export default router
