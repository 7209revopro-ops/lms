import { Types } from 'mongoose'
import { env } from '@/config/env.ts'
import { PushTokenModel, UserModel } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

/* ─────────────────────────────────────────────────────────────
   Push notifications to the student app (plan.md §13.4 B3).

   Every in-app notification already goes through NotificationService.create;
   that is the one place which calls pushToUser, so the bell and the phone
   always say the same thing. Push is IN ADDITION to email/WhatsApp, never
   instead of them (plan.md §13.8).

   Fire-and-forget by contract: pushToUser never throws, has a deadline, and
   the action that caused the notification never waits on it.

   Off unless PUSH_ENABLED — then each push is only logged (see env.ts).
───────────────────────────────────────────────────────────── */

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/
const CHUNK = 100            // Expo's per-request limit
const TIMEOUT_MS = 10_000

export class PushError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'PushError'
  }
}

export function isExpoPushToken(v: unknown): v is string {
  return typeof v === 'string' && EXPO_TOKEN.test(v)
}

export function pushEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(env.PUSH_ENABLED ?? '')
}

/** Register (or move) this phone's token to the signed-in account. */
export async function registerPushToken(userId: string, input: {
  token: string; platform: 'ios' | 'android'; deviceId?: string; appVersion?: string
}): Promise<void> {
  if (!isExpoPushToken(input.token)) throw new PushError('INVALID_PUSH_TOKEN', 'Not an Expo push token')
  await PushTokenModel.updateOne(
    { token: input.token },
    {
      $set: {
        userId: new Types.ObjectId(userId), platform: input.platform,
        deviceId: input.deviceId, appVersion: input.appVersion, lastSeenAt: new Date(),
      },
    },
    { upsert: true },
  )
}

/** Sign-out: this phone stops receiving pushes. Keyed by the token alone (see
 *  push.routes.ts); removing one that is not there is fine. */
export async function removePushToken(token: string): Promise<void> {
  await PushTokenModel.deleteOne({ token })
}

export interface PushMessage {
  title: string
  body?: string
  /** The in-app path the notification points at; the app maps it to a screen. */
  link?: string
  kind?: string
}

interface ExpoTicket { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }

/** Push to every phone the user is signed in on. Never throws. */
export async function pushToUser(userId: string, msg: PushMessage): Promise<{ sent: number; removed: number; logged: number }> {
  const out = { sent: 0, removed: 0, logged: 0 }
  try {
    const rows = await PushTokenModel.find({ userId }).select('token').lean()
    if (rows.length === 0) return out
    /* A blocked account's phones hear nothing, even before they notice. */
    const user = await UserModel.findById(userId).select('isActive').lean()
    if (!user?.isActive) return out
    const tokens = rows.map(r => r.token)

    if (!pushEnabled()) {
      logger.info({ userId, devices: tokens.length, title: msg.title, link: msg.link }, '📱 [dev] push captured (PUSH_ENABLED is off)')
      out.logged = tokens.length
      return out
    }

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const batch = tokens.slice(i, i + CHUNK)
      const messages = batch.map(to => ({
        to,
        title: msg.title.slice(0, 255),
        body: msg.body?.slice(0, 1000),
        data: { link: msg.link ?? null, kind: msg.kind ?? null },
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      }))
      const res = await fetch(env.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        logger.warn({ userId, status: res.status }, 'Expo push request refused')
        continue
      }
      const json = await res.json().catch(() => null) as { data?: ExpoTicket[] } | null
      const tickets = json?.data ?? []
      /* Tickets come back in the order the messages were sent. A token the
         phone no longer answers to (app removed, permission revoked) is
         deleted, so it is never pushed to again. */
      const dead: string[] = []
      tickets.forEach((t, n) => {
        if (t.status === 'ok') out.sent++
        else if (t.details?.error === 'DeviceNotRegistered' && batch[n]) dead.push(batch[n]!)
        else logger.warn({ userId, error: t.details?.error, message: t.message }, 'Expo push ticket error')
      })
      if (dead.length) {
        const r = await PushTokenModel.deleteMany({ token: { $in: dead } })
        out.removed += r.deletedCount ?? 0
      }
    }
  } catch (err) {
    logger.warn({ userId, err: (err as Error).message }, 'Push failed — the in-app notification still stands')
  }
  return out
}
