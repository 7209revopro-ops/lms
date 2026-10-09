import { Types } from 'mongoose'
import { SectionRepository } from '@/repositories/section.repository.ts'
import { CourseRepository } from '@/repositories/course.repository.ts'
import { LessonRepository } from '@/repositories/lesson.repository.ts'
import type { ISection } from '@/models/schema.ts'
import { onModuleAdded } from '@/services/paymentAccess.service.ts'
import { logger } from '@/utils/logger.ts'

/* ─── Domain error ──────────────────────────────────── */
export class OutlineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'OutlineError'
  }
}

interface CreateInput {
  courseId:     string
  title:        string
  description?: string
}

interface UpdateInput {
  title?:       string
  description?: string
  order?:       number
}

export class SectionService {
  private readonly repo       = new SectionRepository()
  private readonly courseRepo = new CourseRepository()
  private readonly lessonRepo = new LessonRepository()

  /* Ownership check: throws if the course is not editable by this user.
     - super_admin passes unconditionally (platform-wide by design).
     - Everyone else is confined to their own academy first, then to their
       role's usual limits.
     - Instructors must additionally own the course.

     This one guard fronts ~24 call sites across courses, sections, lessons,
     quizzes, assignments, grading, transcripts, live classes and homework, so
     the tenancy rule lives here rather than being repeated at every caller. */
  /* READ access to a course's outline: whoever may edit it, plus the OTHER
     academy's admins on a course shared by both academies — they enrol their
     own students in it and block modules per student, so they must see the
     modules. Instructors, and content editing, stay with assertCourseEditable. */
  async assertCourseReadable(courseId: string, userId: string, role: string, categoryScope?: string): Promise<void> {
    try {
      await this.assertCourseEditable(courseId, userId, role, categoryScope)
    } catch (err) {
      if (!(err instanceof OutlineError) || err.statusCode !== 403 || role === 'instructor') throw err
      const course = await this.courseRepo.findById_(courseId)
      if (!(course as { sharedAcademies?: boolean } | null)?.sharedAcademies) throw err
    }
  }

  async assertCourseEditable(courseId: string, userId: string, role: string, categoryScope?: string): Promise<void> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OutlineError('INVALID_ID', 'Invalid course id', 400)
    }
    const course = await this.courseRepo.findById_(courseId)
    if (!course) throw new OutlineError('COURSE_NOT_FOUND', 'Course not found.', 404)

    // Full-platform admin — never scoped. The org shown in the admin UI is a
    // view filter (X-Organization-Id), not a permission boundary.
    if (role === 'super_admin') return

    // TENANCY — applies to every role below super_admin, including `admin`.
    await this.assertSameOrganization(course, userId)

    // Org admins — full rights inside their own academy
    if (role === 'admin') return

    /* Programme-scoped course editing is currently granted to NOBODY.
       
       This branch used to name 4x_admin and digital_marketing_admin, which
       have been folded into sub_admin + `program`. Rewriting it as
       `role === 'sub_admin' && categoryScope` would have been the obvious
       move — and would have handed course editing to every sub_admin, none of
       whom has ever had it. Widening permissions is not a side effect a
       consolidation gets to have, so the branch is gone instead.

       The cost is real and small: the two migrated accounts (4x_admin and
       digital_marketing_admin) lose course editing. To give it back — to them
       and to every other sub_admin — restore exactly this, and add
       'sub_admin' to requireCourseAuthor so they can create what they may
       then edit:

         if (role === 'sub_admin' && categoryScope) {
           if ((course as any).program === categoryScope) return
           throw new OutlineError('FORBIDDEN', 'You can only edit courses in your program.', 403)
         }
    */

    // Teaching staff — only own courses
    if (role === 'instructor' && String((course as any).instructorId?._id ?? course.instructorId) === userId) return

    throw new OutlineError('FORBIDDEN', 'You do not have permission to edit this course.', 403)
  }

  /* ─── Tenancy predicate ─────────────────────────────
     The caller's academy is read here rather than threaded through all ~24
     call sites: every one of them already resolves the course from the
     database, so one more indexed lookup on an admin-only path is a far
     smaller risk surface than 24 edited call sites.

     Fail-open in two places, both deliberate and both matching the
     `{org} OR {null}` convention used by the admin list/bulk/orders routes:
       • a course with no academy predates the split (the boot backfill stamps
         these — this is a safety net, not the normal path);
       • a staff account that EXISTS but carries no academy is likewise unscoped.

     A missing user record is a different case and is denied: it means the
     account was deleted while its access token is still live (up to
     JWT_ACCESS_EXPIRES_IN, currently 7 days — see M-02), and a removed admin
     must not keep cross-academy reach for the life of their last token. */
  private async assertSameOrganization(course: unknown, userId: string): Promise<void> {
    const courseOrg = (course as { organizationId?: unknown }).organizationId
    if (!courseOrg) return

    const { UserModel } = await import('@/models/schema.ts')
    const user = Types.ObjectId.isValid(userId)
      ? await UserModel.findById(userId).select('organizationId').lean().exec()
      : null

    if (!user) {
      throw new OutlineError('FORBIDDEN', 'This account no longer exists.', 403)
    }

    const callerOrg = (user as { organizationId?: unknown }).organizationId
    if (!callerOrg) return

    if (String(callerOrg) !== String(courseOrg)) {
      throw new OutlineError('FORBIDDEN', 'This course belongs to another organization.', 403)
    }
  }

  /** Convenience: look up lesson → course, then assertCourseEditable. */
  async assertLessonEditable(lessonId: string, userId: string, role: string, categoryScope?: string): Promise<void> {
    if (!Types.ObjectId.isValid(lessonId)) {
      throw new OutlineError('INVALID_ID', 'Invalid lesson id', 400)
    }
    const lesson = await this.lessonRepo.findById(lessonId)
    if (!lesson) throw new OutlineError('LESSON_NOT_FOUND', 'Lesson not found', 404)
    await this.assertCourseEditable(String(lesson.courseId), userId, role, categoryScope)
  }

  async list(courseId: string): Promise<ISection[]> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OutlineError('INVALID_ID', 'Invalid course id', 400)
    }
    return this.repo.findByCourseOrdered(courseId)
  }

  async create(input: CreateInput): Promise<ISection> {
    if (!Types.ObjectId.isValid(input.courseId)) {
      throw new OutlineError('INVALID_ID', 'Invalid course id', 400)
    }
    const existingCount = await this.repo.countByCourse(input.courseId)
    const section = await this.repo.create({
      courseId:    new Types.ObjectId(input.courseId) as unknown as ISection['courseId'],
      title:       input.title.trim(),
      description: input.description?.trim() ?? '',
      order:       existingCount,
    } as Partial<ISection>)

    /* Students who have paid part of the fee see half the modules. A new one
       past that half must arrive locked for them, or it would be open by
       accident. Never fails the module being created. */
    try {
      await onModuleAdded(input.courseId, section.id)
    } catch (err) {
      logger.warn({ err, courseId: input.courseId }, 'Could not keep part-paid enrolments to their half after a new module')
    }
    return section
  }

  async update(id: string, input: UpdateInput): Promise<ISection> {
    if (!Types.ObjectId.isValid(id)) {
      throw new OutlineError('INVALID_ID', 'Invalid section id', 400)
    }
    const update: Partial<ISection> = {}
    if (input.title !== undefined) update.title = input.title.trim()
    /* Checked against undefined, not truthiness: '' is how the form clears a
       description, and treating it as "no change" would make it unclearable. */
    if (input.description !== undefined) update.description = input.description.trim()
    if (input.order !== undefined) update.order = input.order
    const doc = await this.repo.updateById(id, update)
    if (!doc) throw new OutlineError('SECTION_NOT_FOUND', 'Section not found.', 404)
    return doc
  }

  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new OutlineError('INVALID_ID', 'Invalid section id', 400)
    }
    const existing = await this.repo.findById(id)
    if (!existing) throw new OutlineError('SECTION_NOT_FOUND', 'Section not found.', 404)
    await this.repo.deleteCascade(id)
    /* Recompute course duration after removing lessons. */
    await this.recomputeCourseDuration(String(existing.courseId))
  }

  async reorder(courseId: string, sectionIds: string[]): Promise<ISection[]> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new OutlineError('INVALID_ID', 'Invalid course id', 400)
    }
    if (!Array.isArray(sectionIds) || sectionIds.some(id => !Types.ObjectId.isValid(id))) {
      throw new OutlineError('INVALID_ID', 'Invalid section id list', 400)
    }
    try {
      await this.repo.reorder(courseId, sectionIds)
    } catch (err) {
      throw new OutlineError('REORDER_MISMATCH', (err as Error).message, 400)
    }
    return this.repo.findByCourseOrdered(courseId)
  }

  /* Sum lesson durations into Course.durationMins. Called after any
     outline mutation that can change total length. */
  private async recomputeCourseDuration(courseId: string): Promise<void> {
    const lessons = await this.lessonRepo.findByCourseOrdered(courseId)
    const total = lessons.reduce((acc, l) => acc + (l.durationMins ?? 0), 0)
    await this.courseRepo.updateOne_(courseId, { durationMins: total })
  }
}
