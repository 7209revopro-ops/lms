import { Router, type Request, type Response, type NextFunction } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { ProgressController }    from '@/controllers/progress.controller.ts'
import { TranscriptController }  from '@/controllers/transcript.controller.ts'
import { SectionService } from '@/services/section.service.ts'
import { TranscriptError } from '@/services/transcript.service.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { LessonModel } from '@/models/schema.ts'
import { authenticate, authenticateAny, optionalAuthenticate, requireAdmin, requireInstructor, injectCategoryScope } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { sendSuccess } from '@/utils/response.ts'
import { keyFromUrl, generatePresignedGetUrl, isR2Configured } from '@/services/r2.service.ts'
import { env } from '@/config/env.ts'

const router   = Router()
const progress = new ProgressController()
const transcript = new TranscriptController()
const sectionSvc = new SectionService()
const enrollRepo = new EnrollmentRepository()

const watchTimeSchema = z.object({
  secs: z.coerce.number().min(1).max(300),
  /* Optional: the playback position, for resume (24 h is beyond any lesson). */
  position: z.coerce.number().min(0).max(86_400).optional(),
})

const transcriptSaveSchema = z.object({
  transcript: z.string().max(100_000),
})

/* ── Access guards ────────────────────────────────── */
/* Transcripts are paid content — caller must be enrolled in the owning course. */
const requireLessonEnrollment = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const lessonId = String(req.params['id'] ?? '')
    if (!Types.ObjectId.isValid(lessonId)) throw new TranscriptError('INVALID_ID', 'Invalid lesson id', 400)
    const lesson = await LessonModel.findById(lessonId).select('courseId isFree').lean().exec()
    if (!lesson) throw new TranscriptError('NOT_FOUND', 'Lesson not found', 404)
    if (lesson.isFree) { next(); return }
    const enrolled = await enrollRepo.findByUserCourse(req.user!.id, lesson.courseId)
    if (!enrolled) throw new TranscriptError('NOT_ENROLLED', 'You must be enrolled in this course', 403)
    next()
  } catch (err) { next(err) }
}

/* Writes resolve lesson → course and reject staff who don't own it (admins pass). */
const requireLessonOwnership = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await sectionSvc.assertLessonEditable(
      String(req.params['id'] ?? ''),
      req.user!.id,
      req.user!.role,
      req.user!.categoryScope,
    )
    next()
  } catch (err) { next(err) }
}

/* ── Signed video playback URL ────────────────────────
   Returns a SHORT-LIVED signed URL for the lesson's video instead of a
   permanent public one. Access: free lessons are open (optional auth, so a
   logged-out visitor can still preview); paid lessons require an approved
   enrollment and are refused when the owning module is blocked.
   The stored contentUrl is never exposed to the client — see courseDTO.ts. */
router.get('/:id/play-url', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const lessonId = String(req.params['id'] ?? '')
    if (!Types.ObjectId.isValid(lessonId)) throw new TranscriptError('INVALID_ID', 'Invalid lesson id', 400)

    const lesson = await LessonModel.findById(lessonId)
      .select('courseId isFree contentUrl sectionId type').lean().exec()
    if (!lesson || lesson.type !== 'video' || !lesson.contentUrl) {
      throw new TranscriptError('NOT_FOUND', 'No video for this lesson', 404)
    }

    if (!lesson.isFree) {
      if (!req.user) throw new TranscriptError('UNAUTHENTICATED', 'Login required to watch this lesson', 401)
      const enrollment = await enrollRepo.findByUserCourse(req.user.id, lesson.courseId)
      if (!enrollment) throw new TranscriptError('NOT_ENROLLED', 'You must be enrolled in this course', 403)
      /* Module-level block — blockedLessons stores SECTION ids (legacy name). */
      const blocked = (enrollment.blockedLessons ?? []).map((x: unknown) => String(x))
      if (blocked.includes(String(lesson.sectionId))) {
        throw new TranscriptError('MODULE_LOCKED', 'This module is locked for your enrollment', 403)
      }
    }

    /* Sign R2-hosted objects; pass through anything we don't own (external/local). */
    const key = keyFromUrl(lesson.contentUrl)
    const url = key && isR2Configured()
      ? await generatePresignedGetUrl(key, env.R2_VIDEO_URL_TTL)
      : lesson.contentUrl
    sendSuccess(res, { url, expiresIn: env.R2_VIDEO_URL_TTL })
  } catch (err) { next(err) }
})

/* ── Progress ─────────────────────────────────────── */
router.get ('/:id/progress',    authenticate, progress.myLessonProgress)
router.post('/:id/complete',    authenticate, progress.markComplete)
router.post('/:id/watch-time',  authenticate, validate(watchTimeSchema), progress.recordWatchTime)

/* ── Transcript ───────────────────────────────────── */
/* Read — enrolled students only */
router.get('/:id/transcript', authenticate, requireLessonEnrollment, transcript.get)
/* Admin/instructor write + AI generation — must own the lesson's course.

   authenticateAny, not authenticate. These two are only ever called from the
   ADMIN panel (admin/src/lib/api/outline.ts), which carries lms_admin_at;
   authenticate reads lms_at alone, so both answered 401 MISSING_TOKEN to
   the only caller they have and the transcript editor could not save. Same
   mistake that killed Learning Paths and Audit Logs — found by the sweep in
   portalguards.suite.ts, which now probes every endpoint both frontends
   call and fails if any of them cannot accept its caller's cookie.

   This widens WHICH COOKIE is accepted and nothing else. requireInstructor
   still gates the role, injectCategoryScope + requireLessonOwnership still
   gate the resource, and authenticateAny populates organizationId, so P-22
   academy scoping is unaffected.

   The GET above deliberately keeps `authenticate` + requireLessonEnrollment:
   that is the student read path, and the admin panel never calls it. */
router.patch('/:id/transcript',           authenticateAny, requireInstructor, injectCategoryScope, requireLessonOwnership, validate(transcriptSaveSchema), transcript.save)
router.post ('/:id/generate-transcript',  authenticateAny, requireInstructor, injectCategoryScope, requireLessonOwnership, transcript.generate)

export default router
