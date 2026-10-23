import { NotificationRepository } from '@/repositories/notification.repository.ts'
import type { NotificationKind } from '@/models/schema.ts'
import { pushToUser as pushToApp } from './expoPush.service.ts'

export class NotificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'NotificationError'
  }
}

export class NotificationService {
  private readonly repo = new NotificationRepository()

  /* Drop a notification into a user's feed. Fire-and-forget call sites
     wrap this in try/catch so a notification failure never breaks the
     main flow. */
  async create(userId: string, payload: { kind: NotificationKind; title: string; body?: string; link?: string }) {
    const doc = await this.repo.createOne({
      userId,
      kind:  payload.kind,
      title: payload.title.slice(0, 255),
      body:  payload.body?.slice(0, 1000),
      link:  payload.link?.slice(0, 1024),
    })
    /* The same notice on every device the student allowed: the phone app
       (Expo push, plan.md §13.4 B3) and browsers (Web Push, 2026-10-21).
       Fire-and-forget: neither ever throws, and the action that raised this
       notification never waits on them — the bell is the record. */
    void pushToApp(userId, { title: payload.title, body: payload.body, link: payload.link, kind: payload.kind })
    void import('@/services/push.service.ts')
      .then(m => m.pushToUser(String(userId), { title: payload.title, body: payload.body, link: payload.link }))
      .catch(() => {})

    return doc
  }

  async list(userId: string, params: { page: number; perPage: number; unreadOnly?: boolean }) {
    return this.repo.listForUser(userId, params)
  }

  async unreadCount(userId: string, kind?: string) {
    return this.repo.unreadCount(userId, kind)
  }

  async markRead(userId: string, id: string) {
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      throw new NotificationError('INVALID_ID', 'Invalid notification id', 400)
    }
    const n = await this.repo.markRead(userId, id)
    if (!n) throw new NotificationError('NOT_FOUND', 'Notification not found or already read', 404)
    return n
  }

  async markAllRead(userId: string, kind?: string): Promise<{ updated: number }> {
    return { updated: await this.repo.markAllRead(userId, kind) }
  }
}
