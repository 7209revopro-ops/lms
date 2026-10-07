import { Types } from 'mongoose'
import {
  InstructorReviewModel, LiveClassModel, ClassBookingModel, CourseModel,
  type IInstructorReview,
} from '@/models/schema.ts'

export class InstructorReviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'InstructorReviewError'
  }
}

type Requester = { id: string; role: string; organizationId?: string; categoryScope?: string }

export class InstructorReviewService {
  /* ── Student: classes they attended but have not yet rated ──────────────
     The /reviews page's whole list. A class qualifies when: the booking
     finalized to 'attended' (not merely 'booked' — see
     reminders.job.ts#runAttendanceFinalization, which this entire feature is
     downstream of) and no InstructorReview exists yet for (student, class).
     Newest first, so a student who skipped the WhatsApp prompt still finds
     their most recent class at the top rather than buried under months-old
     ones. */
  async listPending(studentId: string, limit = 20): Promise<Array<{
    liveClassId: string; title: string; scheduledStart: Date
    instructorId: string; instructorName: string; courseId: string; courseTitle: string
  }>> {
    const attended = await ClassBookingModel.find({
      userId: new Types.ObjectId(studentId), status: 'attended',
    }).select('liveClassId').lean()
    if (attended.length === 0) return []

    const classIds = attended.map(b => b.liveClassId)
    const already = await InstructorReviewModel.find({
      studentId: new Types.ObjectId(studentId), liveClassId: { $in: classIds },
    }).select('liveClassId').lean()
    const reviewed = new Set(already.map(r => String(r.liveClassId)))
    const pendingIds = classIds.filter(id => !reviewed.has(String(id)))
    if (pendingIds.length === 0) return []

    const classes = await LiveClassModel.find({ _id: { $in: pendingIds } })
      .select('title scheduledStart instructorId courseId')
      .populate('instructorId', 'name')
      .populate('courseId', 'title')
      .sort({ scheduledStart: -1 })
      .limit(limit)
      .lean()

    return classes.map(c => ({
      liveClassId:     String(c._id),
      title:           c.title,
      scheduledStart:  c.scheduledStart,
      instructorId:    String((c.instructorId as any)?._id ?? c.instructorId),
      instructorName:  (c.instructorId as any)?.name ?? 'Instructor',
      courseId:        String((c.courseId as any)?._id ?? c.courseId),
      courseTitle:     (c.courseId as any)?.title ?? '',
    }))
  }

  /* ── Student: submit a rating ────────────────────────────────────────────
     instructorId/courseId/organizationId/program are resolved from the
     SESSION, never from the request body — the same rule class-assignments
     and bookings already follow. A forged instructorId in the request would
     otherwise let a student's rating land on the wrong teacher's record. */
  async submit(
    requester: Requester,
    input: { liveClassId: string; rating: number; comment?: string },
  ): Promise<IInstructorReview> {
    if (!Types.ObjectId.isValid(input.liveClassId)) {
      throw new InstructorReviewError('NOT_FOUND', 'Class not found.', 404)
    }
    const attended = await ClassBookingModel.findOne({
      userId: new Types.ObjectId(requester.id),
      liveClassId: new Types.ObjectId(input.liveClassId),
      status: 'attended',
    })
    if (!attended) {
      /* Covers both "never booked" and "booked but did not attend" — a
         student who no-showed their own class has nothing to rate, and a
         student probing someone else's class id gets the same answer
         either way, which is the point: this must not confirm that a given
         class id exists or who was in it. */
      throw new InstructorReviewError('NOT_ATTENDED', 'You can only review a class you attended.', 403)
    }

    const live = await LiveClassModel.findById(input.liveClassId).select('instructorId courseId organizationId').lean()
    if (!live) throw new InstructorReviewError('NOT_FOUND', 'Class not found.', 404)

    const course = await CourseModel.findById(live.courseId).select('program').lean()

    try {
      return await InstructorReviewModel.create({
        liveClassId:    live._id,
        studentId:      new Types.ObjectId(requester.id),
        instructorId:   live.instructorId,
        courseId:       live.courseId,
        organizationId: live.organizationId,
        program:        (course as any)?.program,
        rating:         input.rating,
        comment:        input.comment?.trim() || undefined,
      })
    } catch (err: any) {
      /* The unique index (studentId, liveClassId) is the real guard against a
         double submit — a second click while the first request is still in
         flight, or a replay of the same form. 11000 is Mongo's duplicate-key
         code. */
      if (err?.code === 11000) {
        throw new InstructorReviewError('ALREADY_REVIEWED', 'You have already reviewed this class.', 409)
      }
      throw err
    }
  }

  /* ── Admin: leaderboard, highest-rated instructor first ──────────────────
     orgId/scope keyed off presence, not role — the fix every other admin
     listing in this codebase needed this session (recordings, announcements,
     impersonation-sessions, class-assignments all had the inverted
     `role !== 'super_admin'` version of this same bug). A super_admin with
     no academy selected in the switcher passes orgId=undefined and sees
     every academy; one academy selected narrows exactly like an org admin. */
  async leaderboard(orgId: string | undefined, scope: string | undefined): Promise<Array<{
    instructorId: string; name: string; avatarUrl?: string
    avgRating: number; totalReviews: number
    ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>
    lowRatingCount: number
  }>> {
    const match: Record<string, unknown> = {}
    if (orgId && Types.ObjectId.isValid(orgId)) match['organizationId'] = new Types.ObjectId(orgId)
    if (scope) match['program'] = scope

    const rows = await InstructorReviewModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$instructorId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          lowRatingCount: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } },
          ratings: { $push: '$rating' },
        },
      },
      { $sort: { avgRating: -1, totalReviews: -1 } },
      {
        $lookup: {
          from: 'users', localField: '_id', foreignField: '_id', as: 'instructor',
        },
      },
      { $unwind: { path: '$instructor', preserveNullAndEmptyArrays: true } },
    ])

    return rows.map(r => {
      const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      for (const v of r.ratings as number[]) {
        const k = Math.max(1, Math.min(5, Math.round(v))) as 1 | 2 | 3 | 4 | 5
        counts[k]++
      }
      return {
        instructorId:   String(r._id),
        name:           r.instructor?.name ?? 'Unknown',
        avatarUrl:      r.instructor?.avatarUrl,
        avgRating:      Math.round((r.avgRating as number) * 10) / 10,
        totalReviews:   r.totalReviews,
        ratingCounts:   counts,
        lowRatingCount: r.lowRatingCount,
      }
    })
  }

  /* ── Admin: one instructor's individual reviews, newest first ──────────── */
  async listForInstructor(
    instructorId: string, orgId: string | undefined, scope: string | undefined,
    page: number, perPage: number,
  ): Promise<{ docs: unknown[]; totalCount: number }> {
    if (!Types.ObjectId.isValid(instructorId)) {
      throw new InstructorReviewError('INVALID_ID', 'Invalid instructor id.', 400)
    }
    const filter: Record<string, unknown> = { instructorId: new Types.ObjectId(instructorId) }
    if (orgId && Types.ObjectId.isValid(orgId)) filter['organizationId'] = new Types.ObjectId(orgId)
    if (scope) filter['program'] = scope

    const [docs, totalCount] = await Promise.all([
      InstructorReviewModel.find(filter)
        .select('rating comment createdAt studentId liveClassId')
        .populate('studentId', 'name tetraCs')
        .populate('liveClassId', 'title scheduledStart')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage).limit(perPage)
        .lean(),
      InstructorReviewModel.countDocuments(filter),
    ])
    return { docs, totalCount }
  }
}
