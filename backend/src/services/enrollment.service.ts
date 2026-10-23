import { Types } from 'mongoose'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { CourseRepository } from '@/repositories/course.repository.ts'
import { LessonRepository } from '@/repositories/lesson.repository.ts'
import { LessonProgressRepository } from '@/repositories/progress.repository.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { sendEnrollmentConfirmation, sendCourseCompletion } from '@/services/email.service.ts'
import { logger } from '@/utils/logger.ts'
import { CourseModel, UserModel, type IEnrollment } from '@/models/schema.ts'
import { env } from '@/config/env.ts'

export class EnrollmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'EnrollmentError'
  }
}

export class EnrollmentService {
  private readonly enrollRepo   = new EnrollmentRepository()
  private readonly courseRepo   = new CourseRepository()
  private readonly lessonRepo   = new LessonRepository()
  private readonly progressRepo = new LessonProgressRepository()
  private readonly notifications = new NotificationService()

  async enroll(userId: string, courseId: string): Promise<{ enrollment: IEnrollment; created: boolean }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new EnrollmentError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }

    const course = await CourseModel.findById(courseId).exec()
    if (!course || course.status !== 'published') {
      throw new EnrollmentError('COURSE_NOT_FOUND', 'Course not found', 404)
    }

    /* Tenant isolation — a course belonging to one organization may only be
       enrolled in by that organization's members. super_admin is never scoped,
       neither is a caller with no organization, and a course that predates the
       organizationId field stays enrollable by anyone. */
    if (course.organizationId) {
      const self       = await UserModel.findById(userId).select('role organizationId').exec()
      const callerOrg  = self?.organizationId?.toString()
      const shared = (course as { sharedAcademies?: boolean }).sharedAcademies === true
      if (!shared && self?.role !== 'super_admin' && callerOrg && callerOrg !== course.organizationId.toString()) {
        throw new EnrollmentError(
          'FORBIDDEN',
          'This course belongs to another organization',
          403,
        )
      }
    }

    /* Paid courses require Stripe checkout — enforce on the server */
    if (!course.isFree && course.price > 0) {
      throw new EnrollmentError(
        'PAYMENT_REQUIRED',
        'This is a paid course. Use POST /checkout to start the payment flow.',
        402,
      )
    }

    /* Idempotent — return existing enrollment if any */
    const existing = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (existing) {
      return { enrollment: existing, created: false }
    }

    /* 'free' is exact here, not an assumption: the guard above rejects any
       course with a price with 402 PAYMENT_REQUIRED, so nothing paid can
       reach this line. */
    const enrollment = await this.enrollRepo.create_({ userId, courseId, source: 'free' })
    await this.courseRepo.incrementEnrollment(courseId, 1)

    /* Fire-and-forget in-app notification */
    void this.notifications.create(userId, {
      kind:  'enrollment',
      title: `Enrolled in ${course.title}`,
      body:  'Open the course any time to start learning.',
      link:  `/courses/${course.slug}`,
    }).catch(err => logger.warn({ err, userId, courseId }, 'enrollment notification failed'))

    /* Fire-and-forget enrollment confirmation email */
    void (async () => {
      try {
        const user = await UserModel.findById(userId).select('name email').exec()
        if (user) {
          const courseUrl = `${env.CLIENT_URL}/courses/${course.slug}`
          await sendEnrollmentConfirmation(user.email, user.name, course.title, courseUrl)
        }
      } catch (err) {
        logger.warn({ err, userId, courseId }, 'enrollment confirmation email failed')
      }
    })()

    return { enrollment, created: true }
  }

  async listMine(userId: string) {
    const docs = await this.enrollRepo.listForUser(userId)
    return this.#withoutFinishedPrograms(docs)
  }

  /* A programme's enrolment (its hidden "Program: …" course) is listed only while the programme still has
     something to come — active, with a class not over yet (the user, 2026-10-23: "only new and coming
     onwards programs"). A stopped programme, or one whose classes have all ended or been cancelled, drops
     off My Learning and the sidebar. Ordinary courses are never affected. */
  async #withoutFinishedPrograms<T extends { courseId?: unknown }>(docs: T[]): Promise<T[]> {
    const { ProgramModel, LiveClassModel } = await import('@/models/schema.ts')
    const idOf = (c: unknown) => String((c as { _id?: unknown } | null)?._id ?? c ?? '')
    const courseIds = docs.map(d => idOf(d.courseId)).filter(id => Types.ObjectId.isValid(id))
    if (!courseIds.length) return docs
    const programs = await ProgramModel.find({ courseId: { $in: courseIds.map(id => new Types.ObjectId(id)) } })
      .select('_id courseId status').lean<Array<{ _id: Types.ObjectId; courseId: Types.ObjectId; status?: string }>>()
    if (!programs.length) return docs
    const now = Date.now()
    /* Classes that have not ended: still scheduled or live, and start + length is ahead of now. */
    const open = await LiveClassModel.find({
      programId: { $in: programs.map(p => p._id) },
      status: { $in: ['scheduled', 'live'] },
      scheduledStart: { $gte: new Date(now - 24 * 3600_000) },
    }).select('programId scheduledStart durationMins').lean<Array<{ programId: Types.ObjectId; scheduledStart: Date; durationMins?: number }>>()
    const live = new Set(open
      .filter(c => new Date(c.scheduledStart).getTime() + (c.durationMins ?? 60) * 60_000 > now)
      .map(c => String(c.programId)))
    const finished = new Set(programs
      .filter(p => p.status !== 'active' || !live.has(String(p._id)))
      .map(p => String(p.courseId)))
    return finished.size ? docs.filter(d => !finished.has(idOf(d.courseId))) : docs
  }

  async getSummary(userId: string, courseId: string): Promise<{
    isEnrolled:      boolean
    progressPercent: number
    status:          'active' | 'completed' | 'dropped' | null
    lastLessonId:    string | null
  }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new EnrollmentError('INVALID_COURSE_ID', 'Invalid course id', 400)
    }
    const enrollment = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (!enrollment) {
      return { isEnrolled: false, progressPercent: 0, status: null, lastLessonId: null }
    }
    return {
      isEnrolled:      true,
      progressPercent: enrollment.progressPercent,
      status:          enrollment.status,
      lastLessonId:    enrollment.lastLessonId?.toString() ?? null,
    }
  }

  async getCourseProgress(userId: string, courseSlug: string): Promise<{
    isEnrolled:        boolean
    enrollmentId:      string | null
    progressPercent:   number
    status:            'active' | 'completed' | 'dropped' | null
    lastLessonId:      string | null
    certificateId:     string | null
    completedLessons:  string[]
    blockedLessons:    string[]
  }> {
    const course = await this.courseRepo.findBySlug(courseSlug)
    if (!course) {
      throw new EnrollmentError('COURSE_NOT_FOUND', 'Course not found', 404)
    }

    const enrollment = await this.enrollRepo.findByUserCourse(userId, course.id)
    const completedLessons = enrollment
      ? await this.progressRepo.listCompletedLessonsForCourse(userId, course.id)
      : []

    return {
      isEnrolled:       !!enrollment,
      enrollmentId:     enrollment?.id ?? null,
      progressPercent:  enrollment?.progressPercent ?? 0,
      status:           enrollment?.status ?? null,
      lastLessonId:     enrollment?.lastLessonId?.toString() ?? null,
      certificateId:    enrollment?.certificateId ?? null,
      completedLessons,
      blockedLessons:   (enrollment?.blockedLessons ?? []).map((id: any) => id.toString()),
    }
  }

  /* Right-sidebar activity feed: recent lesson completions +
     week stats. Combined into one endpoint to save a roundtrip. */
  async getMyActivity(userId: string, limit = 8) {
    const [progressDocs, week] = await Promise.all([
      this.progressRepo.listRecentActivity(userId, limit),
      this.progressRepo.getWeekStats(userId),
    ])
    return { items: progressDocs, week }
  }

  /* Used by ProgressService.markComplete to recompute % */
  async recomputeProgress(userId: string, courseId: string | Types.ObjectId): Promise<void> {
    const enrollment = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (!enrollment) return

    const [totalLessons, completed] = await Promise.all([
      this.lessonRepo.countByCourse(courseId),
      this.progressRepo.listCompletedLessonsForCourse(userId, courseId),
    ])

    const progressPercent = totalLessons === 0
      ? 0
      : Math.min(100, Math.round((completed.length / totalLessons) * 100))

    const update: {
      progressPercent: number
      status?: 'active' | 'completed'
      completedAt?: Date
    } = { progressPercent }

    const justCompleted = progressPercent >= 100 && enrollment.status !== 'completed'
    if (justCompleted) {
      update.status      = 'completed'
      update.completedAt = new Date()
    }

    await this.enrollRepo.updateProgress(enrollment.id, update)

    /* Fire-and-forget course completion email — only on the active→completed transition */
    if (justCompleted) {
      void (async () => {
        try {
          const course_ = await CourseModel.findById(courseId).select('title slug').exec()
          const user_   = await UserModel.findById(userId).select('name email').exec()
          if (course_ && user_) {
            const courseUrl = `${env.CLIENT_URL}/courses/${course_.slug}`
            await sendCourseCompletion(user_.email, user_.name, course_.title, courseUrl)
          }
        } catch (err) {
          logger.warn({ err, userId, courseId }, 'course completion email failed')
        }
      })()
    }
  }
}
