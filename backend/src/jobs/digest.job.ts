/* ─────────────────────────────────────────────────────
   Daily Standard-tier digest
   ─────────────────────────────────────────────────────
   Phase 2 of the Class-Update Notification spec. Standard-tier events are
   queued per student as they happen; once a day this flushes each student's
   queue into ONE email — "here's what changed in your classes today" —
   instead of a mail per event.

   Critical-tier events never reach here. A cancellation or a reschedule is
   something the student has to act on now, so it bypasses the queue entirely
   and sends immediately, standalone.

   Timing: a fixed end-of-day send, not "on next login". The spec left that
   open and this is the developer answer to it. On-next-login couples sending
   to a request path and means a student away for a week receives nothing and
   then a wall of text; a fixed hour is predictable for the student and
   matches every other scheduled job here. DIGEST_HOUR overrides it.

   Runs on the primary PM2 instance only (see index.ts), like the reminder and
   outbox jobs: N instances flushing the same rows would send duplicates.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { logger } from '@/utils/logger.ts'
import { sendDailyDigest } from '@/services/email.service.ts'
import { scheduleUrl as buildScheduleUrl } from '@/utils/clientLinks.ts'

/* 18:00 in the backend's timezone (Asia/Dubai — see config/timezone.ts),
   which is end-of-day for the academy rather than end-of-day UTC. */
const DIGEST_HOUR = (() => {
  const raw = Number(process.env['DIGEST_HOUR'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 23 ? Math.floor(raw) : 18
})()

let running = false

/* The send is a parameter so a test can make it fail.

   "Rows stay pending when the send throws" is the property that stops a bad
   SMTP round swallowing a day of updates, and it cannot be checked without
   producing a failure. Reaching into the module to swap the export does not
   work — ES exports are readonly — and the alternative, breaking SMTP config
   from the environment, tests the transport rather than this job's bookkeeping. */
type DigestSender = (
  to: string, name: string, items: { title: string; body: string }[], url: string,
) => Promise<void>

export async function runDailyDigest(
  send: DigestSender = sendDailyDigest,
): Promise<{ students: number; items: number }> {
  const tally = { students: 0, items: 0 }

  const { DigestQueueModel, UserModel } = await import('@/models/schema.ts')

  /* Read the pending rows ONCE, then stamp back by their ids.

     That is what keeps a row queued mid-flush out of this digest: it does not
     exist when this find runs, so it is not in `pending`, and the updateMany
     below names only the ids that were. It waits for the next run instead of
     being marked sent by a mail that could not have contained it.

     An earlier version also filtered `queuedAt <= claimedAt` and this comment
     credited that filter with the guarantee. It does not have it — the find
     has already executed, so the filter excludes nothing that was not already
     absent. Mutation testing is what showed the difference: deleting the
     filter broke no test, while replacing the by-id stamp with a filtered one
     broke six. The redundant filter is gone; the line that actually holds is
     the updateMany. */
  const pending = await DigestQueueModel
    .find({ sentAt: null })
    .sort({ queuedAt: 1 })
    .lean() as any[]

  if (pending.length === 0) return tally

  const byUser = new Map<string, any[]>()
  for (const row of pending) {
    const k = String(row.userId)
    byUser.set(k, [...(byUser.get(k) ?? []), row])
  }

  const users = await UserModel
    .find({ _id: { $in: [...byUser.keys()] } })
    .select('name email isActive')
    .lean() as any[]
  const userById = new Map(users.map(u => [String(u._id), u]))

  const scheduleUrl = buildScheduleUrl()

  for (const [userId, rows] of byUser) {
    const user = userById.get(userId)
    const ids  = rows.map(r => r._id)

    /* A deactivated account still gets its rows closed out — leaving them
       pending would mean the queue grows forever for somebody who will never
       be mailed, and tomorrow's digest would try again. */
    if (!user?.email || user.isActive === false) {
      await DigestQueueModel.updateMany({ _id: { $in: ids } }, { $set: { sentAt: new Date() } })
      continue
    }

    try {
      /* ONE send for the whole queue, not one per row.

         Sending inside the loop produces a separate email per event, each
         headed "1 update in your classes today" -- which is the exact
         behaviour this job exists to replace, and it is invisible from the
         tally: students++ sits outside that loop, so the counters still
         read {students:3, items:9} while nine mails go out. Only the
         mailbox shows it. */
      await send(
        user.email,
        user.name ?? '',
        rows.map(r => ({ title: String(r.title), body: String(r.body) })),
        scheduleUrl,
      )
      /* Stamped only after the send resolves. A throw leaves the rows pending,
         so the next run tries again rather than silently dropping a day of
         updates — the same reasoning the email outbox uses. */
      await DigestQueueModel.updateMany({ _id: { $in: ids } }, { $set: { sentAt: new Date() } })
      tally.students++
      tally.items += rows.length
    } catch (err) {
      logger.error({ err, userId, rows: rows.length }, '[Digest] send failed — rows left pending')
    }
  }

  if (tally.students) {
    logger.info(tally, '[Digest] daily digest sent')
  }
  return tally
}

/** Queue one Standard-tier event for a student. Critical never comes here. */
export async function queueDigestItem(item: {
  userId: string
  kind:   string
  title:  string
  body:   string
  link?:  string
}): Promise<void> {
  const { DigestQueueModel } = await import('@/models/schema.ts')
  await DigestQueueModel.create({
    userId:   item.userId,
    kind:     item.kind,
    title:    item.title,
    body:     item.body,
    ...(item.link ? { link: item.link } : {}),
    queuedAt: new Date(),
  })
}

export function startDigestJob(): void {
  cron.schedule(`0 ${DIGEST_HOUR} * * *`, async () => {
    /* One flush at a time. A slow SMTP round must not let the next tick start
       a second pass over rows the first has not stamped yet. */
    if (running) {
      logger.warn('[Digest] previous run still going — skipping this tick')
      return
    }
    running = true
    try {
      await runDailyDigest()
    } catch (err) {
      logger.error({ err }, '[Digest] job error')
    } finally {
      running = false
    }
  })

  logger.info({ hour: DIGEST_HOUR }, '[Digest] daily digest job scheduled')
}
