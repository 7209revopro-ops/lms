import { Types } from 'mongoose'
import { LessonProgressRepository } from '@/repositories/progress.repository.ts'
import { LessonModel } from '@/models/schema.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { EnrollmentService, EnrollmentError } from '@/services/enrollment.service.ts'
import { StreakService } from '@/services/streak.service.ts'

export class ProgressService {
  private readonly progressRepo   = new LessonProgressRepository()
  private readonly enrollRepo     = new EnrollmentRepository()
  private readonly enrollService  = new EnrollmentService()
  private readonly streakSvc      = new StreakService()

  async markComplete(userId: string, lessonId: string): Promise<{
    progressPercent: number
    status: 'active' | 'completed'
  }> {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new EnrollmentError('INVALID_LESSON_ID', 'Invalid lesson id', 400)
    }

    const lesson = await LessonModel.findById(lessonId).exec()
    if (!lesson) {
      throw new EnrollmentError('LESSON_NOT_FOUND', 'Lesson not found', 404)
    }

    /* Must be enrolled */
    const enrollment = await this.enrollRepo.findByUserCourse(userId, lesson.courseId)
    if (!enrollment) {
      throw new EnrollmentError('NOT_ENROLLED', 'You must enroll in the course first', 403)
    }

    await this.progressRepo.upsertComplete(userId, lessonId, lesson.courseId)
    await this.enrollRepo.setLastLesson(enrollment.id, lessonId)
    await this.enrollService.recomputeProgress(userId, lesson.courseId)

    /* Fire-and-forget side effect: streak update (achievements are computed on-demand) */
    void this.streakSvc.recordActivity(userId).catch(() => {/* non-critical */})

    /* Read back the updated enrollment for the response */
    const fresh = await this.enrollRepo.findById(enrollment.id)
    return {
      progressPercent: fresh?.progressPercent ?? 0,
      status:          (fresh?.status as 'active' | 'completed') ?? 'active',
    }
  }

  /* My per-lesson progress — used by the player to resume from
     watchTimeSecs on load. Always returns 0/false for new lessons. */
  async getMyLessonProgress(userId: string, lessonId: string): Promise<{
    watchTimeSecs: number
    lastPositionSecs: number | null
    isCompleted:   boolean
    completedAt:   string | null
  }> {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new EnrollmentError('INVALID_LESSON_ID', 'Invalid lesson id', 400)
    }
    const { LessonProgressModel } = await import('@/models/schema.ts')
    const p = await LessonProgressModel.findOne({ userId, lessonId }).exec()
    return {
      watchTimeSecs: p?.watchTimeSecs ?? 0,
      lastPositionSecs: p?.lastPositionSecs ?? null,
      isCompleted:   !!p?.isCompleted,
      completedAt:   p?.completedAt ? p.completedAt.toISOString() : null,
    }
  }

  async recordWatchTime(userId: string, lessonId: string, secs: number, position?: number): Promise<void> {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new EnrollmentError('INVALID_LESSON_ID', 'Invalid lesson id', 400)
    }
    if (secs <= 0 || secs > 300) return  // ignore noise / cap per-request

    const lesson = await LessonModel.findById(lessonId).select('courseId').exec()
    if (!lesson) return

    const enrollment = await this.enrollRepo.findByUserCourse(userId, lesson.courseId)
    if (!enrollment) return  // silent for watch-time pings if unenrolled

    await this.progressRepo.addWatchTime(userId, lessonId, lesson.courseId, secs, position)
    await this.enrollRepo.setLastLesson(enrollment.id, lessonId)
  }
}
