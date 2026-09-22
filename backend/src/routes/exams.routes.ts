import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { ExamService } from '@/services/exam.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import type { Request, Response, NextFunction } from 'express'

const router = Router()
const examSvc = new ExamService()

const answerSchema = z.object({
  questionId: z.string().min(1),
  answer:     z.string().max(20000),
})

const logSchema = z.object({
  event:  z.string().min(1).max(64),
  detail: z.string().max(500).optional(),
})

/* GET /exams/course/:courseId — the exam for a course (student view + attempt state) */
router.get('/course/:courseId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await examSvc.getForCourse(req.user!.id, String(req.params['courseId'] ?? ''))
    sendSuccess(res, data)  // null when the course has no published exam
  } catch (err) { next(err) }
})

/* POST /exams/:examId/start — start (or resume) the one attempt */
router.post('/:examId/start', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await examSvc.start(req.user!.id, String(req.params['examId'] ?? ''))
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

/* GET /exams/:examId/status — time left + saved answers (auto-submits on expiry) */
router.get('/:examId/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await examSvc.status(req.user!.id, String(req.params['examId'] ?? ''))
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

/* POST /exams/:examId/answer — auto-save one answer */
router.post('/:examId/answer', authenticate, validate(answerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { questionId, answer } = req.body as { questionId: string; answer: string }
    const data = await examSvc.saveAnswer(req.user!.id, String(req.params['examId'] ?? ''), questionId, answer)
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

/* POST /exams/:examId/submit — finalize the attempt */
router.post('/:examId/submit', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await examSvc.submit(req.user!.id, String(req.params['examId'] ?? ''))
    sendSuccess(res, data, 'Exam submitted')
  } catch (err) { next(err) }
})

/* POST /exams/:examId/log — record a proctoring event (may auto-suspend) */
router.post('/:examId/log', authenticate, validate(logSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { event, detail } = req.body as { event: string; detail?: string }
    const data = await examSvc.logEvent(req.user!.id, String(req.params['examId'] ?? ''), event, detail)
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

/* GET /exams/:examId/result — own grade, after submission only */
router.get('/:examId/result', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await examSvc.getResult(req.user!.id, String(req.params['examId'] ?? ''))
    sendSuccess(res, data)
  } catch (err) { next(err) }
})

export default router
