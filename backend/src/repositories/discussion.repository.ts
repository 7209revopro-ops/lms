import { Types } from 'mongoose'
import { DiscussionThreadModel, DiscussionCommentModel, type IDiscussionThread, type IDiscussionComment } from '@/models/schema.ts'

/* ─── Thread ─────────────────────────────────────────── */
export class DiscussionThreadRepository {
  async create(data: {
    lessonId:  string | Types.ObjectId
    courseId:  string | Types.ObjectId
    authorId:  string | Types.ObjectId
    title?:    string
    body:      string
  }): Promise<IDiscussionThread> {
    const doc = new DiscussionThreadModel(data)
    return doc.save()
  }

  async findById(id: string | Types.ObjectId): Promise<IDiscussionThread | null> {
    return DiscussionThreadModel
      .findById(id)
      .populate('authorId', 'name avatarUrl role alsoTeaches')
      .exec()
  }

  async listByLesson(
    lessonId: string | Types.ObjectId,
    page:     number,
    perPage:  number,
  ): Promise<{ docs: IDiscussionThread[]; total: number }> {
    const filter = { lessonId: new Types.ObjectId(lessonId.toString()) }
    const [docs, total] = await Promise.all([
      DiscussionThreadModel
        .find(filter)
        .populate('authorId', 'name avatarUrl role alsoTeaches')
        .sort({ isPinned: -1, createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      DiscussionThreadModel.countDocuments(filter),
    ])
    return { docs, total }
  }

  async upvote(threadId: string | Types.ObjectId, userId: string | Types.ObjectId): Promise<IDiscussionThread | null> {
    const uid = new Types.ObjectId(userId.toString())
    const thread = await DiscussionThreadModel.findById(threadId)
    if (!thread) return null
    const alreadyVoted = thread.upvotedBy.some(id => id.equals(uid))
    if (alreadyVoted) {
      thread.upvotedBy = thread.upvotedBy.filter(id => !id.equals(uid))
      thread.upvoteCount = Math.max(0, thread.upvoteCount - 1)
    } else {
      thread.upvotedBy.push(uid)
      thread.upvoteCount += 1
    }
    return thread.save()
  }

  async setResolved(threadId: string | Types.ObjectId, isResolved: boolean): Promise<IDiscussionThread | null> {
    return DiscussionThreadModel.findByIdAndUpdate(
      threadId,
      { isResolved },
      { new: true },
    ).exec()
  }

  async setPinned(threadId: string | Types.ObjectId, isPinned: boolean): Promise<IDiscussionThread | null> {
    return DiscussionThreadModel.findByIdAndUpdate(
      threadId,
      { isPinned },
      { new: true },
    ).exec()
  }

  async incrementCommentCount(threadId: string | Types.ObjectId, delta: number): Promise<void> {
    await DiscussionThreadModel.findByIdAndUpdate(threadId, { $inc: { commentCount: delta } }).exec()
  }

  async deleteById(threadId: string | Types.ObjectId): Promise<void> {
    await DiscussionThreadModel.findByIdAndDelete(threadId).exec()
    await DiscussionCommentModel.deleteMany({ threadId }).exec()
  }
}

/* ─── Comment ────────────────────────────────────────── */
export class DiscussionCommentRepository {
  async create(data: {
    threadId:  string | Types.ObjectId
    authorId:  string | Types.ObjectId
    body:      string
    parentId?: string | Types.ObjectId
  }): Promise<IDiscussionComment> {
    const doc = new DiscussionCommentModel(data)
    return doc.save()
  }

  async findById(id: string | Types.ObjectId): Promise<IDiscussionComment | null> {
    return DiscussionCommentModel.findById(id).exec()
  }

  async listByThread(threadId: string | Types.ObjectId): Promise<IDiscussionComment[]> {
    return DiscussionCommentModel
      .find({ threadId, parentId: { $exists: false } })
      .populate('authorId', 'name avatarUrl role alsoTeaches')
      .sort({ isInstructorAnswer: -1, upvoteCount: -1, createdAt: 1 })
      .exec()
  }

  async listReplies(parentId: string | Types.ObjectId): Promise<IDiscussionComment[]> {
    return DiscussionCommentModel
      .find({ parentId })
      .populate('authorId', 'name avatarUrl role alsoTeaches')
      .sort({ createdAt: 1 })
      .exec()
  }

  async upvote(commentId: string | Types.ObjectId, userId: string | Types.ObjectId): Promise<IDiscussionComment | null> {
    const uid = new Types.ObjectId(userId.toString())
    const comment = await DiscussionCommentModel.findById(commentId)
    if (!comment) return null
    const alreadyVoted = comment.upvotedBy.some(id => id.equals(uid))
    if (alreadyVoted) {
      comment.upvotedBy = comment.upvotedBy.filter(id => !id.equals(uid))
      comment.upvoteCount = Math.max(0, comment.upvoteCount - 1)
    } else {
      comment.upvotedBy.push(uid)
      comment.upvoteCount += 1
    }
    return comment.save()
  }

  async markInstructorAnswer(commentId: string | Types.ObjectId, mark: boolean): Promise<IDiscussionComment | null> {
    return DiscussionCommentModel.findByIdAndUpdate(
      commentId,
      { isInstructorAnswer: mark },
      { new: true },
    ).exec()
  }

  async deleteById(commentId: string | Types.ObjectId): Promise<void> {
    await DiscussionCommentModel.findByIdAndDelete(commentId).exec()
  }

  async countByThread(threadId: string | Types.ObjectId): Promise<number> {
    return DiscussionCommentModel.countDocuments({ threadId })
  }
}
