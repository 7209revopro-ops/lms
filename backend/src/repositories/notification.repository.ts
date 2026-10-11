import { Types } from 'mongoose'
import { BaseRepository } from './base.repository.ts'
import {
  NotificationModel, type INotification, type NotificationKind,
} from '@/models/schema.ts'

export class NotificationRepository extends BaseRepository<INotification> {
  constructor() {
    super(NotificationModel)
  }

  async createOne(data: {
    userId: string | Types.ObjectId
    kind:   NotificationKind
    title:  string
    body?:  string
    link?:  string
  }): Promise<INotification> {
    return NotificationModel.create(data)
  }

  async listForUser(
    userId: string | Types.ObjectId,
    params: { page: number; perPage: number; unreadOnly?: boolean },
  ): Promise<{ docs: INotification[]; totalCount: number; unreadCount: number }> {
    const filter: Record<string, unknown> = { userId }
    if (params.unreadOnly) filter['readAt'] = { $exists: false }

    const [docs, totalCount, unreadCount] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((params.page - 1) * params.perPage)
        .limit(params.perPage)
        .exec(),
      NotificationModel.countDocuments(filter).exec(),
      NotificationModel.countDocuments({ userId, readAt: { $exists: false } }).exec(),
    ])

    return { docs, totalCount, unreadCount }
  }

  /* `kind` narrows it to one kind — e.g. 'live-class-scheduled', the new-class
     badge on the student's Schedule tab. */
  async unreadCount(userId: string | Types.ObjectId, kind?: string): Promise<number> {
    return NotificationModel.countDocuments({ userId, readAt: { $exists: false }, ...(kind ? { kind } : {}) }).exec()
  }

  async markRead(userId: string | Types.ObjectId, id: string): Promise<INotification | null> {
    return NotificationModel.findOneAndUpdate(
      { _id: id, userId, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
      { new: true },
    ).exec()
  }

  async markAllRead(userId: string | Types.ObjectId, kind?: string): Promise<number> {
    const res = await NotificationModel.updateMany(
      { userId, readAt: { $exists: false }, ...(kind ? { kind } : {}) },
      { $set: { readAt: new Date() } },
    ).exec()
    return res.modifiedCount
  }
}
