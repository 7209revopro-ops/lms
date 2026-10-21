import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import { LessonProgressModel, type ILessonProgress } from '@/models/schema.ts'

export class LessonProgressRepository extends BaseRepository<ILessonProgress> {
  constructor() {
    super(LessonProgressModel)
  }

  async upsertComplete(
    userId: string | Types.ObjectId,
    lessonId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
  ): Promise<ILessonProgress | null> {
    return LessonProgressModel.findOneAndUpdate(
      { userId, lessonId },
      {
        $set:         { isCompleted: true, completedAt: new Date(), courseId },
        $setOnInsert: { userId, lessonId },
      },
      { upsert: true, new: true },
    ).exec()
  }

  async addWatchTime(
    userId: string | Types.ObjectId,
    lessonId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    secs: number,
    position?: number,
  ): Promise<void> {
    await LessonProgressModel.updateOne(
      { userId, lessonId },
      {
        $inc:         { watchTimeSecs: secs },
        ...(position !== undefined ? { $set: { lastPositionSecs: Math.floor(position) } } : {}),
        $setOnInsert: { userId, lessonId, courseId, isCompleted: false },
      },
      { upsert: true },
    ).exec()
  }

  async countCompleted(userId: string | Types.ObjectId): Promise<number> {
    return LessonProgressModel.countDocuments({ userId, isCompleted: true }).exec()
  }

  async listCompletedLessonsForCourse(
    userId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
  ): Promise<string[]> {
    const docs = await LessonProgressModel
      .find({ userId, courseId, isCompleted: true })
      .select('lessonId')
      .exec()
    return docs.map(d => d.lessonId.toString())
  }

  /* Recent activity for the right sidebar: latest N completed lessons
     for a user, populated with lesson + course basics. */
  async listRecentActivity(
    userId: string | Types.ObjectId,
    limit = 8,
  ): Promise<ILessonProgress[]> {
    return LessonProgressModel
      .find({ userId, isCompleted: true })
      .sort({ completedAt: -1, updatedAt: -1 })
      .limit(limit)
      .populate('lessonId',   'title type durationMins')
      .populate('courseId',   'title slug')
      .exec()
  }

  /* Aggregated stats for the profile header — used in the right
     sidebar's "this week" summary. */
  async getWeekStats(
    userId: string | Types.ObjectId,
  ): Promise<{ lessonsCompleted: number; minutesWatched: number }> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [completedCount, watchAgg] = await Promise.all([
      LessonProgressModel.countDocuments({
        userId,
        isCompleted: true,
        completedAt: { $gte: weekAgo },
      }).exec(),
      LessonProgressModel.aggregate([
        { $match: { userId: new Types.ObjectId(String(userId)), updatedAt: { $gte: weekAgo } } },
        { $group: { _id: null, total: { $sum: '$watchTimeSecs' } } },
      ]).exec(),
    ])

    const totalSecs = watchAgg[0]?.total ?? 0
    return {
      lessonsCompleted: completedCount,
      minutesWatched:   Math.round(totalSecs / 60),
    }
  }
}
