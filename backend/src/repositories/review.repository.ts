import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import { ReviewModel, ReviewVoteModel, type IReview } from '@/models/schema.ts'

export class ReviewRepository extends BaseRepository<IReview> {
  constructor() {
    super(ReviewModel)
  }

  async findByCourse(
    courseId: string | Types.ObjectId,
    page: number,
    perPage: number,
  ): Promise<{ docs: IReview[]; totalCount: number }> {
    const [docs, totalCount] = await Promise.all([
      ReviewModel
        .find({ courseId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .populate('userId', 'name avatarUrl')
        .exec(),
      ReviewModel.countDocuments({ courseId }).exec(),
    ])
    return { docs, totalCount }
  }

  async upsertOne(
    userId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    rating: number,
    comment?: string,
  ): Promise<IReview | null> {
    return ReviewModel.findOneAndUpdate(
      { userId, courseId },
      {
        $set:         { rating, comment },
        $setOnInsert: { userId, courseId },
      },
      { upsert: true, new: true, runValidators: true },
    ).exec()
  }

  async findOwn(reviewId: string, userId: string): Promise<IReview | null> {
    return ReviewModel.findOne({ _id: reviewId, userId }).exec()
  }

  /* Admin: global paginated list of all reviews across all courses,
     populated with both reviewer and the course they reviewed. */
  async listAll(
    page: number,
    perPage: number,
    organizationId?: string,
  ): Promise<{ docs: IReview[]; totalCount: number }> {
    const filter: Record<string, unknown> = {}
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      const { CourseModel } = await import('@/models/schema.ts')
      const courseIds = await CourseModel.find(
        { organizationId: new Types.ObjectId(organizationId) }, '_id',
      ).lean()
      filter['courseId'] = { $in: courseIds.map((c: any) => c._id) }
    }
    const [docs, totalCount] = await Promise.all([
      ReviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .populate('userId',       'name avatarUrl email tetraCs')
        .populate('courseId',     'title slug thumbnailUrl')
        .populate('instructorId', 'name avatarUrl')
        .exec(),
      ReviewModel.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }

  /* 6.2 — add / update instructor reply */
  async addInstructorReply(
    reviewId:     string | Types.ObjectId,
    instructorId: string | Types.ObjectId,
    reply:        string,
  ): Promise<IReview | null> {
    return ReviewModel.findByIdAndUpdate(
      reviewId,
      {
        instructorReply:   reply,
        instructorReplyAt: new Date(),
        instructorId:      new Types.ObjectId(instructorId.toString()),
      },
      { new: true },
    ).exec()
  }

  /* 6.3 — helpful / report vote (idempotent per user) */
  async vote(
    userId:   string | Types.ObjectId,
    reviewId: string | Types.ObjectId,
    type:     'helpful' | 'report',
  ): Promise<{ alreadyVoted: boolean }> {
    const uid = new Types.ObjectId(userId.toString())
    const rid = new Types.ObjectId(reviewId.toString())

    const existing = await ReviewVoteModel.findOne({ userId: uid, reviewId: rid, type })
    if (existing) {
      // Toggle off
      await ReviewVoteModel.deleteOne({ _id: existing._id })
      const delta = type === 'helpful' ? { $inc: { helpfulVotes: -1 } } : { $inc: { reportCount: -1 } }
      await ReviewModel.findByIdAndUpdate(rid, delta).exec()
      return { alreadyVoted: true }
    }

    await ReviewVoteModel.create({ userId: uid, reviewId: rid, type })

    if (type === 'helpful') {
      await ReviewModel.findByIdAndUpdate(rid, { $inc: { helpfulVotes: 1 } }).exec()
    } else {
      // Auto-flag when threshold reached
      await ReviewModel.findByIdAndUpdate(rid, {
        $inc: { reportCount: 1 },
        $set: { isReported: true },
      }).exec()
    }
    return { alreadyVoted: false }
  }
}
