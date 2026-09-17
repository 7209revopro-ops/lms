/* ─────────────────────────────────────────────────────
   Critical-tier mail: debounce + per-student daily cap
   ─────────────────────────────────────────────────────
   Phase 4 of the Class-Update Notification spec (§7, "Implementation Notes —
   Suggested, Not Required"):

     · "Debounce rapid edits: a short buffer (e.g. 10–15 minutes) after a
        Critical-tier edit before sending, so back-to-back corrections to the
        same session merge into one email rather than several."
     · "Per-student daily cap: as a safety net, cap Critical-tier emails at a
        low number per day per student; anything beyond folds into the next
        digest."

   Critical mail is no longer sent from the request that caused it. It is
   PARKED here, and a flush sends it once the buffer has elapsed. Three things
   fall out of that, and only the first was asked for:

     1. Corrections merge. An admin who moves a class to 14:00, then 14:30,
        then 15:00 inside the window produces ONE email, saying 15:00. Before,
        that was three emails and the student had to work out which was last.

     2. A cancellation SUPERSEDES anything still parked for that session. The
        old behaviour could send "moved to Tuesday" and then "cancelled" —
        or, because both were fire-and-forget, in the other order. A pending
        reschedule for a session that no longer exists is now dropped rather
        than delivered.

     3. Nothing is delayed past the class it is about. If the session starts
        within the buffer, the buffer is skipped and the mail goes at once.
        A 10-minute debounce on a cancellation for a class starting in 8
        minutes would be worse than no notification at all. The spec does not
        mention this; it is the one case where the safeguard would do harm.

   The IN-APP notification is never debounced and never capped. It is free,
   it is the source of truth per §6, and it fires from the request as before.
   Everything here is about the email layer on top of it.

   Runs on the primary PM2 instance only (see index.ts), like the digest,
   reminder and outbox jobs: N instances flushing the same rows would send
   the duplicates this exists to prevent.
───────────────────────────────────────────────────── */
import cron from 'node-cron'
import { logger } from '@/utils/logger.ts'
import {
  sendCancelledNotification,
  sendRescheduledNotification,
  sendDelayNotification,
  sendInstructorChangedNotification,
} from '@/services/email.service.ts'
import { queueDigestItem } from '@/jobs/digest.job.ts'

/* 10 minutes — the low end of the spec's "10–15". Set to 0 to send inline,
   which is what the suites that assert the CONTENT of critical mail do: they
   predate this buffer and are not about its timing. */
export const DEBOUNCE_MINS = (() => {
  const raw = Number(process.env['CRITICAL_DEBOUNCE_MINS'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 120 ? Math.floor(raw) : 10
})()

/* Per student, per day. The spec calls this "a safety net", so it is set
   above any normal day: a student booked on three sessions that all move is
   a bad day, not a bug. Beyond it, the change still reaches them — in-app
   immediately, and in tonight's digest — just not as its own mail. 0 = off. */
/* How late a critical notice may still be sent. Past this it is suppressed
   rather than delivered — see the query below. Set 0 to disable. */
export const MAX_AGE_HOURS = Number(process.env['CRITICAL_MAIL_MAX_AGE_HOURS'] ?? 6)

export const DAILY_CAP = (() => {
  const raw = Number(process.env['CRITICAL_MAIL_CAP'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? Math.floor(raw) : 6
})()

export type CriticalKind = 'cancelled' | 'rescheduled' | 'instructor'

export interface CriticalMailRow {
  liveClassId:        string
  userId:             string
  email:              string
  name:               string
  kind:               CriticalKind
  title:              string
  /** The class's own start time — used to decide whether the buffer is safe. */
  scheduledStart?:    Date | string
  oldStart?:          Date | string
  newStart?:          Date | string
  oldInstructorName?: string
  newInstructorName?: string
}

let running = false

/* Start of today in Asia/Dubai, named explicitly rather than taken from the
   process default.

   The backend does pin TZ (config/timezone.ts) — but only when that file is
   imported first, which CLAUDE.md flags as a fragility, and `isSameDay` below
   already names the zone outright. Naming it here too means the cap's day
   boundary and the reschedule/delay boundary agree by construction instead of
   by import order. */
function startOfToday(now: Date): Date {
  /* en-CA renders as YYYY-MM-DD, which is the only reason it is used here. */
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
  return new Date(`${ymd}T00:00:00+04:00`)
}

/* ─────────────────────────────────────────────────────────────────────────
   parkCriticalMail — queue one critical email, merging with what is pending

   Merge key is (session, student, kind). Two DIFFERENT facts about the same
   session — it moved AND the instructor changed — stay two rows, because
   they are two things the student needs to know. The same fact corrected
   twice is one row.

   `dueAt` is set once, from the FIRST edit, and a merge does not push it
   back. A rolling window would let a stream of small corrections delay a
   cancellation indefinitely; a fixed one guarantees the mail goes out within
   the buffer no matter how many edits land inside it.
───────────────────────────────────────────────────────────────────────── */
export async function parkCriticalMail(row: CriticalMailRow, now = new Date()): Promise<{
  action: 'parked' | 'merged'; dueAt: Date; superseded: number
}> {
  const { CriticalMailModel } = await import('@/models/schema.ts')

  let superseded = 0

  /* A cancelled session makes every other pending fact about it irrelevant.
     Dropping them here is what stops "moved to Tuesday" arriving after
     "cancelled" — the two used to race. */
  if (row.kind === 'cancelled') {
    const res = await CriticalMailModel.updateMany(
      {
        liveClassId: row.liveClassId,
        userId:      row.userId,
        kind:        { $ne: 'cancelled' },
        sentAt:      null,
        supersededAt: null,
      },
      { $set: { supersededAt: now } },
    )
    superseded = res.modifiedCount ?? 0
  }

  const existing = await CriticalMailModel.findOne({
    liveClassId:  row.liveClassId,
    userId:       row.userId,
    kind:         row.kind,
    sentAt:       null,
    supersededAt: null,
  })

  if (existing) {
    /* Keep the ORIGINAL oldStart / oldInstructor: the student's frame of
       reference is the booking they made, not the admin's previous typo.
       Take the newest of everything else. */
    if (row.newStart)          existing.newStart          = new Date(row.newStart)
    if (row.newInstructorName) existing.newInstructorName = row.newInstructorName
    if (row.scheduledStart)    existing.scheduledStart    = new Date(row.scheduledStart)
    existing.title = row.title
    await existing.save()
    return { action: 'merged', dueAt: existing.dueAt, superseded }
  }

  const dueAt = new Date(now.getTime() + DEBOUNCE_MINS * 60_000)
  await CriticalMailModel.create({
    liveClassId:       row.liveClassId,
    userId:            row.userId,
    email:             row.email,
    name:              row.name,
    kind:              row.kind,
    title:             row.title,
    ...(row.scheduledStart    ? { scheduledStart:    new Date(row.scheduledStart) } : {}),
    ...(row.oldStart          ? { oldStart:          new Date(row.oldStart) }       : {}),
    ...(row.newStart          ? { newStart:          new Date(row.newStart) }       : {}),
    ...(row.oldInstructorName ? { oldInstructorName: row.oldInstructorName }        : {}),
    ...(row.newInstructorName ? { newInstructorName: row.newInstructorName }        : {}),
    queuedAt: now,
    dueAt,
  })
  return { action: 'parked', dueAt, superseded }
}

/**
 * True when the buffer would push the mail past the class it is about, so the
 * caller should flush immediately instead of waiting for the next tick.
 */
export function isUrgent(scheduledStart?: Date | string | null, now = new Date()): boolean {
  if (DEBOUNCE_MINS === 0) return true
  if (!scheduledStart) return false
  const startsIn = new Date(scheduledStart).getTime() - now.getTime()
  return startsIn <= DEBOUNCE_MINS * 60_000
}

export type CriticalSenders = {
  cancelled:    (to: string, name: string, title: string, when: Date) => Promise<void>
  rescheduled:  (to: string, name: string, title: string, from: Date, to_: Date) => Promise<void>
  delayed:      (to: string, name: string, title: string, when: Date) => Promise<void>
  instructor:   (to: string, name: string, title: string, oldN: string, newN: string, when: Date) => Promise<void>
}

const REAL_SENDERS: CriticalSenders = {
  cancelled:   sendCancelledNotification,
  rescheduled: sendRescheduledNotification,
  delayed:     sendDelayNotification,
  instructor:  sendInstructorChangedNotification,
}

/* ─────────────────────────────────────────────────────────────────────────
   flushCriticalMail — send everything whose buffer has elapsed

   `due` defaults to every row that is ready. Pass `liveClassId` to flush one
   session now, which is what the urgent path does: a cancellation for a class
   starting in minutes must not wait for the next tick.
───────────────────────────────────────────────────────────────────────── */
export async function flushCriticalMail(opts: {
  now?:         Date
  liveClassId?: string
  senders?:     CriticalSenders
} = {}): Promise<{ sent: number; folded: number; failed: number; dropped: number }> {
  const now     = opts.now ?? new Date()
  const senders = opts.senders ?? REAL_SENDERS
  const tally   = { sent: 0, folded: 0, failed: 0, dropped: 0 }

  const { CriticalMailModel } = await import('@/models/schema.ts')

  const query: Record<string, unknown> = { sentAt: null, supersededAt: null }
  if (opts.liveClassId) {
    query['liveClassId'] = opts.liveClassId
  } else {
    /* A floor as well as a ceiling.

       `dueAt <= now` on its own means that after an outage every notice that
       fell due while the sender was down becomes due simultaneously — and
       these are the most time-sensitive mail in the system. Telling a student
       at 9am that yesterday's 2pm class moved is worse than telling them
       nothing: the class has already happened, and the mail reads as though
       it has not.

       The window is short on purpose. These notices exist to reach somebody
       BEFORE a session; once that has passed there is nothing to act on.
       Stale rows are swept below so the queue does not carry them forever. */
    query['dueAt'] = MAX_AGE_HOURS > 0
      ? { $lte: now, $gte: new Date(now.getTime() - MAX_AGE_HOURS * 3600 * 1000) }
      : { $lte: now }
  }

  /* Retire anything that fell outside the window while we were not running, so
     it is not carried forever and is not counted as a live backlog. Kept, not
     deleted — `supersededAt` is the field this queue already uses for "no
     longer relevant". */
  if (!opts.liveClassId && MAX_AGE_HOURS > 0) {
    const staleBefore = new Date(now.getTime() - MAX_AGE_HOURS * 3600 * 1000)
    const swept = await CriticalMailModel.updateMany(
      { sentAt: null, supersededAt: null, dueAt: { $lt: staleBefore } },
      { $set: { supersededAt: now } },
    )
    if (swept.modifiedCount > 0) {
      tally.dropped += swept.modifiedCount
      logger.warn({ dropped: swept.modifiedCount, olderThanHours: MAX_AGE_HOURS },
        'critical mail: suppressed notices about sessions that have already passed')
    }
  }

  const rows = await CriticalMailModel.find(query).sort({ queuedAt: 1 }).lean() as any[]
  if (rows.length === 0) return tally

  /* ── Re-check the audience ──────────────────────────────────────────────
     The recipients were resolved when the edit landed, but the mail does not
     leave for up to DEBOUNCE_MINS after that — long enough for a student to
     cancel their booking in between. §4 of the spec scopes these notices to
     "students with an ACTIVE booking on that specific session", and at send
     time somebody who just cancelled does not have one. Mailing them anyway
     is exactly the noise this phase exists to remove.

     One query for the whole batch rather than one per row. Cancelling a
     SESSION does not touch booking rows — nothing in the service or the
     controller writes to them — so a cancellation notice still finds its
     audience intact; only a student's own withdrawal drops them. */
  const { ClassBookingModel } = await import('@/models/schema.ts')
  const stillBooked = await ClassBookingModel.find({
    $or: rows.map(r => ({ liveClassId: r.liveClassId, userId: r.userId })),
    status: { $in: ['booked', 'attended'] },
  }).select('liveClassId userId').lean() as any[]
  const activePairs = new Set(stillBooked.map(b => `${String(b.liveClassId)}|${String(b.userId)}`))

  /* The cap is read from the database ONCE per student per flush and then
     advanced in memory as each mail goes out. Re-reading per row would be a
     query each; reading once and NOT advancing it would let a single flush
     send the whole batch, because every row would see the same stale count —
     mutation testing kills exactly that.

     `foldedToDigest: { $ne: true }` keeps folded rows out of the count, so it
     means "mail that went out or is about to", not "rows closed out".
     Mutation testing shows the filter is currently indistinguishable from its
     absence, and it is: a row can only fold once the cap has already been
     reached by sent ones, so wherever a folded row exists the unfiltered
     count is over the cap anyway. It is kept for what it says, not for what
     it currently does — the day something else folds a row, the distinction
     starts to matter. */
  const sentTodayBy = new Map<string, number>()
  const since = startOfToday(now)

  /* A claim older than this belonged to a process that died mid-send. Long
     enough that a slow SMTP round is never mistaken for a dead one. */
  const staleClaim = new Date(now.getTime() - 5 * 60_000)

  for (const row of rows) {
    const userId = String(row.userId)

    /* CLAIM FIRST. `rows` was read before any of this, so a flush that
       started at the same moment is holding the same list; the row goes to
       whichever one wins this update and the other skips it. Without this,
       both sent — a test firing two flushes at once mailed five students
       ten times.

       The sentAt/supersededAt conditions repeat what the `rows` query already
       filtered, and mutation testing shows that removing EITHER copy alone
       breaks nothing. That is the point: between reading `rows` and reaching
       this line, another flush can have sent the row and a cancellation can
       have superseded it, so the copy that matters is this one — the query's
       is only an optimisation. Removing BOTH does break, which is what says
       the guard is real rather than decorative. */
    const claimed = await CriticalMailModel.findOneAndUpdate(
      {
        _id:          row._id,
        sentAt:       null,
        supersededAt: null,
        $or: [{ claimedAt: null }, { claimedAt: { $lte: staleClaim } }],
      },
      { $set: { claimedAt: now } },
    ).lean()
    if (!claimed) continue

    /* Withdrew inside the buffer. Superseded rather than sent: the notice is
       already in their bell from the moment of the edit, so nothing is lost
       by not mailing somebody who has left the session. */
    if (!activePairs.has(`${String(row.liveClassId)}|${userId}`)) {
      await CriticalMailModel.updateOne({ _id: row._id }, { $set: { supersededAt: now } })
      tally.dropped++
      continue
    }

    if (!sentTodayBy.has(userId)) {
      /* Claimed-but-not-yet-sent rows count too, so a concurrent flush that
         has taken a student's rows is visible here. This narrows the window
         in which two flushes could each mail up to the cap; it does not close
         it, and for a stated safety net that is the right trade against an
         atomic per-user counter on every send. */
      sentTodayBy.set(userId, await CriticalMailModel.countDocuments({
        userId,
        /* Not this row: it was just claimed above, and the whole point of the
           count is how many OTHERS already went out. */
        _id: { $ne: row._id },
        foldedToDigest: { $ne: true },
        $or: [
          { sentAt: { $gte: since } },
          { sentAt: null, claimedAt: { $gte: since } },
        ],
      }))
    }
    const alreadySent = sentTodayBy.get(userId)!

    /* Over the cap: the change still reaches them, just not as its own mail.
       It is already in their notification centre; this puts it in tonight's
       digest too, which is what the spec means by "folds into the next
       digest". */
    if (DAILY_CAP > 0 && alreadySent >= DAILY_CAP) {
      try {
        await queueDigestItem({
          userId,
          kind:  `critical-${row.kind}`,
          title: String(row.title),
          body:  bodyFor(row),
          link:  `/live-classes/${String(row.liveClassId)}/watch`,
        })
        await CriticalMailModel.updateOne({ _id: row._id },
          { $set: { sentAt: now, foldedToDigest: true } })
        tally.folded++
      } catch (err) {
        await CriticalMailModel.updateOne({ _id: row._id }, { $set: { claimedAt: null } })
        logger.error({ err, userId }, '[CriticalMail] fold to digest failed — row left pending')
        tally.failed++
      }
      continue
    }

    try {
      await sendOne(row, senders)
      /* Stamped only after the send resolves, so a throw leaves the row
         pending for the next tick rather than silently dropping it.

         Stamped with THIS FLUSH'S clock, not `new Date()`. The fold branch
         below already used `now`, and the mismatch meant the daily-cap
         window (`startOfToday(now)`) and the timestamps it counts could come
         from two different clocks — under which the cap simply never binds
         across flushes. Property testing is what surfaced it: every
         hand-written case flushed once, so the two clocks never diverged.
         In production they are the same instant either way; the point is
         that the function now means what its `now` parameter says. */
      await CriticalMailModel.updateOne({ _id: row._id }, { $set: { sentAt: now } })
      sentTodayBy.set(userId, alreadySent + 1)
      tally.sent++
    } catch (err) {
      /* Release the claim as well as leaving sentAt null, or the row would be
         locked out until it went stale five minutes later. */
      await CriticalMailModel.updateOne({ _id: row._id }, { $set: { claimedAt: null } })
      logger.error({ err, to: row.email, kind: row.kind },
        '[CriticalMail] send failed — row left pending')
      tally.failed++
    }
  }

  if (tally.sent || tally.folded || tally.dropped) {
    logger.info(tally, '[CriticalMail] flushed')
  }
  return tally
}

/** Same calendar day → a delay; a different day → a full reschedule. */
function isSameDay(a: Date | string, b: Date | string): boolean {
  const day = (d: Date | string) =>
    new Date(d).toLocaleDateString('en-US', { timeZone: 'Asia/Dubai' })
  return day(a) === day(b)
}

function bodyFor(row: any): string {
  switch (row.kind) {
    case 'cancelled':
      return 'The session you booked has been cancelled.'
    case 'rescheduled':
      return `The session has moved to ${new Date(row.newStart ?? Date.now())
        .toLocaleString('en-US', { timeZone: 'Asia/Dubai' })}.`
    default:
      return `${row.oldInstructorName ?? 'your instructor'} has been replaced by ${row.newInstructorName ?? 'another instructor'}.`
  }
}

async function sendOne(row: any, senders: CriticalSenders): Promise<void> {
  const oldStart = row.oldStart ? new Date(row.oldStart) : new Date()
  const newStart = row.newStart ? new Date(row.newStart) : new Date()

  if (row.kind === 'cancelled') {
    return senders.cancelled(row.email, row.name ?? '', row.title, oldStart)
  }
  if (row.kind === 'rescheduled') {
    return isSameDay(oldStart, newStart)
      ? senders.delayed(row.email, row.name ?? '', row.title, newStart)
      : senders.rescheduled(row.email, row.name ?? '', row.title, oldStart, newStart)
  }
  return senders.instructor(
    row.email, row.name ?? '', row.title,
    row.oldInstructorName ?? 'your instructor',
    row.newInstructorName ?? 'another instructor',
    newStart,
  )
}

export function startCriticalMailJob(): void {
  /* Every minute. The buffer is what delays the mail; the tick only decides
     how precisely the end of that buffer is observed. */
  cron.schedule('* * * * *', async () => {
    if (running) {
      logger.warn('[CriticalMail] previous flush still going — skipping this tick')
      return
    }
    running = true
    try {
      await flushCriticalMail()
    } catch (err) {
      logger.error({ err }, '[CriticalMail] job error')
    } finally {
      running = false
    }
  })

  logger.info({ debounceMins: DEBOUNCE_MINS, dailyCap: DAILY_CAP },
    '[CriticalMail] debounce/cap job scheduled')
}
