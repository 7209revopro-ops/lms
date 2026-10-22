/* ─────────────────────────────────────────────────────────────
   Web Push (2026-10-21) — every bell notification also goes to the devices
   the user turned notifications on in, so it reaches a phone with the app
   closed: Android / desktop Chrome and Edge in the browser or the installed
   app, iPhone once the app is on the home screen (iOS 16.4+).

   Off unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set (generate once:
   `bunx web-push generate-vapid-keys`); the public key also goes to the
   client. VAPID_SUBJECT is a contact the push services can reach.

   Fire-and-forget: a push never delays or fails what caused it. A big batch
   (a cancellation told to a whole course) is sent a few at a time, not all at
   once. A subscription the push service reports gone (404 / 410) is deleted;
   one that keeps failing for other reasons is dropped after 5 tries.
───────────────────────────────────────────────────────────── */
import webpush from 'web-push'
import { Types } from 'mongoose'
import { env } from '@/config/env.ts'
import { logger } from '@/utils/logger.ts'

export interface PushPayload { title: string; body?: string; link?: string; tag?: string }
type Sub = { _id: unknown; app?: 'client' | 'admin'; endpoint: string; keys: { p256dh: string; auth: string } }
type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, data: string) => Promise<unknown>

let configured: boolean | null = null
let sender: Sender = (sub, data) => webpush.sendNotification(sub, data, { TTL: 6 * 3600, urgency: 'high' })

/** The VAPID public key the browser subscribes with, or null when push is off. */
export const pushPublicKey = (): string | null => process.env['VAPID_PUBLIC_KEY']?.trim() || null

function ready(): boolean {
  if (configured !== null) return configured
  const pub = pushPublicKey(), priv = process.env['VAPID_PRIVATE_KEY']?.trim()
  if (!pub || !priv) { configured = false; return false }
  try {
    webpush.setVapidDetails(process.env['VAPID_SUBJECT']?.trim() || 'mailto:support@deltainstitutions.com', pub, priv)
    configured = true
  } catch (err) {
    logger.error({ err }, 'push: the VAPID keys are not valid — push is off')
    configured = false
  }
  return configured
}

/** Tests: send through a stub instead of the push services, and re-read the keys. */
export function __setPushSender(fn: Sender | null) { if (fn) sender = fn; configured = null }

/* A few at a time: one cancellation can mean a push to every student of a course. */
const MAX_IN_FLIGHT = 16
let inFlight = 0
const waiting: Array<() => void> = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>(r => waiting.push(r))
  inFlight++
  try { return await work() } finally { inFlight--; waiting.shift()?.() }
}

export async function savePushSubscription(userId: string, app: 'client' | 'admin', body: unknown, userAgent?: string) {
  const { PushSubscriptionModel } = await import('@/models/schema.ts')
  const s = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : ''
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : ''
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : ''
  /* Only a real push service URL, never anything else we would then POST to. */
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
    return { ok: false as const }
  }
  await PushSubscriptionModel.updateOne(
    { endpoint },
    { $set: { userId: new Types.ObjectId(userId), app, keys: { p256dh, auth }, userAgent: userAgent?.slice(0, 300), failures: 0 } },
    { upsert: true },
  )
  return { ok: true as const }
}

export async function removePushSubscription(userId: string, endpoint: unknown) {
  if (typeof endpoint !== 'string') return
  const { PushSubscriptionModel } = await import('@/models/schema.ts')
  await PushSubscriptionModel.deleteOne({ endpoint, userId: new Types.ObjectId(userId) })
}

/** Push to every device the user turned notifications on in. Never throws. */
export async function pushToUser(userId: string, p: PushPayload): Promise<{ sent: number; removed: number }> {
  const out = { sent: 0, removed: 0 }
  if (!ready() || !Types.ObjectId.isValid(userId)) return out
  try {
    const { PushSubscriptionModel } = await import('@/models/schema.ts')
    const subs = await PushSubscriptionModel.find({ userId: new Types.ObjectId(userId) })
      .select('app endpoint keys').limit(10).lean() as unknown as Sub[]
    await Promise.all(subs.map(sub => slot(async () => {
      const base = (sub.app === 'admin' ? env.ADMIN_URL : env.CLIENT_URL).replace(/\/+$/, '')
      const data = JSON.stringify({
        title: p.title.slice(0, 120), body: (p.body ?? '').slice(0, 300),
        url: `${base}${p.link && p.link.startsWith('/') ? p.link : '/'}`,
        /* Same tag, same notification: a newer one about the same thing replaces it on the device. */
        tag: (p.tag ?? p.link ?? '').slice(0, 120) || undefined,
      })
      try {
        await sender({ endpoint: sub.endpoint, keys: sub.keys }, data)
        out.sent++
        void PushSubscriptionModel.updateOne({ _id: sub._id }, { $set: { lastOkAt: new Date(), failures: 0 } }).catch(() => {})
      } catch (err: any) {
        const status = Number(err?.statusCode)
        if (status === 404 || status === 410) {
          out.removed++
          await PushSubscriptionModel.deleteOne({ _id: sub._id }).catch(() => {})
        } else {
          logger.warn({ status, err: err?.body ?? err?.message }, 'push: send failed')
          await PushSubscriptionModel.updateOne({ _id: sub._id }, { $inc: { failures: 1 } }).catch(() => {})
          await PushSubscriptionModel.deleteOne({ _id: sub._id, failures: { $gte: 5 } }).catch(() => {})
        }
      }
    })))
  } catch (err) {
    logger.warn({ err, userId }, 'push: could not send')
  }
  return out
}
