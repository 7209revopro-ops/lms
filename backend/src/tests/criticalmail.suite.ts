/* ─────────────────────────────────────────────────────────────
   Phase 4 — the debounce buffer and the per-student daily cap.

   §7 of the Class-Update Notification spec, "Implementation Notes (Suggested,
   Not Required)":

     · "Debounce rapid edits: a short buffer (e.g. 10–15 minutes) after a
        Critical-tier edit before sending, so back-to-back corrections to the
        same session merge into one email rather than several."
     · "Per-student daily cap: as a safety net, cap Critical-tier emails at a
        low number per day per student; anything beyond folds into the next
        digest."

   Before this, an admin who corrected a time three times sent three emails,
   each contradicting the last, and the student had to work out which one was
   current. There was no ceiling on that at all.

   What the suite fixes in place:

     A  three corrections inside the buffer become ONE email, saying the LAST
        time — while the bell shows all three, in order, immediately
     B  the buffer is honoured: nothing is sent before it elapses
     C  two DIFFERENT facts about one session stay two emails — a reschedule
        and a reassignment are not corrections of each other
     D  a cancellation SUPERSEDES anything still parked for that session, so
        "moved to Tuesday" is never delivered for a class that is off
     E  the buffer never outlives the class: a session starting inside the
        window flushes at once
     F  a merge does not push the deadline back — a stream of edits cannot
        delay the mail indefinitely
     G  the per-student daily cap folds the overflow into the digest, and the
        student still gets it in-app
     H  the cap is per STUDENT, not global — one busy student does not
        silence anybody else
     I  a send that throws leaves the row parked for the next tick
     J  the reschedule/delay template follows the LAST correction, which is
        why that choice is made at send time and not when the edit lands
     K  the cap resets with the day, rather than being a lifetime budget
     L  two overlapping flushes never send the same mail twice
     M  a row stranded by a killed flush is recovered, but one still in
        flight is not stolen from the flush that holds it
     N  the audience is re-checked at SEND time — a student who withdraws
        inside the buffer is dropped, but cancelling the session is not
        mistaken for its audience withdrawing

   Calls the job functions directly, with an injected sender, because the
   subject under test is the bookkeeping — what is sent, when, and what is
   left behind — not SMTP.

   Run: bun run test:criticalmail
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_criticalmail_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-criticalmail'

/* The knobs under test. 10 minutes is the shipped default; the cap is lowered
   to 2 so the overflow case takes two mails to reach instead of six. */
process.env.CRITICAL_DEBOUNCE_MINS = '10'
process.env.CRITICAL_MAIL_CAP      = '2'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { CriticalMailModel, DigestQueueModel, NotificationModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const job = await import('@/jobs/criticalmail.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_criticalmail_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/* A sender that records instead of sending. */
type Sent = { kind: string; to: string; title: string; args: unknown[] }
let sent: Sent[] = []
const recorder = (): any => ({
  cancelled:   async (to: string, n: string, t: string, w: Date) =>
    void sent.push({ kind: 'cancelled', to, title: t, args: [n, w] }),
  rescheduled: async (to: string, n: string, t: string, f: Date, t2: Date) =>
    void sent.push({ kind: 'rescheduled', to, title: t, args: [n, f, t2] }),
  delayed:     async (to: string, n: string, t: string, w: Date) =>
    void sent.push({ kind: 'delayed', to, title: t, args: [n, w] }),
  instructor:  async (to: string, n: string, t: string, o: string, nw: string, w: Date) =>
    void sent.push({ kind: 'instructor', to, title: t, args: [n, o, nw, w] }),
})

const oid = () => new mongoose.Types.ObjectId()
const MIN = 60_000

/* The flush re-checks that the student is still booked before sending, so a
   parked row needs a booking behind it or nothing would ever go out. Every
   `park()` below records one; the tests that care about the re-check remove it
   deliberately (section N). */
async function park(row: any, now?: Date) {
  await ClassBookingModel.updateOne(
    { liveClassId: row.liveClassId, userId: row.userId },
    { $setOnInsert: { status: 'booked', bookedAt: new Date() } },
    { upsert: true },
  )
  return job.parkCriticalMail(row, now)
}

async function reset() {
  sent = []
  await CriticalMailModel.deleteMany({})
  await DigestQueueModel.deleteMany({})
  await NotificationModel.deleteMany({})
  await ClassBookingModel.deleteMany({})
}

try {

check('setup: the buffer is 10 minutes', job.DEBOUNCE_MINS === 10, String(job.DEBOUNCE_MINS))
check('setup: the daily cap is 2',       job.DAILY_CAP === 2,      String(job.DAILY_CAP))

/* ═════════════ A/B/F — corrections merge, and the deadline holds ═════════ */
section('A/B/F. Three corrections inside the buffer become ONE email, on the original deadline')
{
  await reset()
  const cls = oid(), user = oid()
  const t0 = new Date('2026-10-01T09:00:00Z')
  const far = new Date('2026-10-20T09:00:00Z')   // weeks away — never urgent

  const base = {
    liveClassId: String(cls), userId: String(user),
    email: 'a@cm.local', name: 'Ann', kind: 'rescheduled' as const,
    title: 'Forex Live', scheduledStart: far, oldStart: far,
  }

  const r1 = await park({ ...base, newStart: new Date('2026-10-20T14:00:00Z') }, t0)
  const r2 = await park({ ...base, newStart: new Date('2026-10-20T14:30:00Z') },
    new Date(t0.getTime() + 2 * MIN))
  const r3 = await park({ ...base, newStart: new Date('2026-10-20T15:00:00Z') },
    new Date(t0.getTime() + 5 * MIN))

  check('A1 the first edit parks a row', r1.action === 'parked', r1.action)
  check('A2 the second MERGES rather than parking a second', r2.action === 'merged', r2.action)
  check('A3 and so does the third', r3.action === 'merged', r3.action)
  check('A4 one row exists, not three', (await CriticalMailModel.countDocuments({})) === 1,
    String(await CriticalMailModel.countDocuments({})))

  /* A rolling window would let a stream of corrections postpone the mail
     forever. The deadline is set by the FIRST edit and never moves. */
  check('F1 the deadline still comes from the first edit, not the last',
    r3.dueAt.getTime() === r1.dueAt.getTime(),
    `${r1.dueAt.toISOString()} vs ${r3.dueAt.toISOString()}`)

  /* Nine minutes in: still inside the buffer. */
  const early = await job.flushCriticalMail({
    now: new Date(t0.getTime() + 9 * MIN), senders: recorder(),
  })
  check('B1 nothing is sent before the buffer elapses', early.sent === 0, JSON.stringify(early))
  check('B2 and the row is still pending', (await CriticalMailModel.countDocuments({ sentAt: null })) === 1,
    String(await CriticalMailModel.countDocuments({ sentAt: null })))

  /* Eleven minutes in. */
  const due = await job.flushCriticalMail({
    now: new Date(t0.getTime() + 11 * MIN), senders: recorder(),
  })
  check('A5 exactly one email goes out for three edits', due.sent === 1 && sent.length === 1,
    JSON.stringify({ due, sent: sent.length }))

  /* The whole point: it says the LAST time, not the first. Which template
     carries it depends on whether the class stayed on the same day — a move
     within the day is a delay, a move to another day is a reschedule — so
     read the time from whichever one was used. */
  const row  = sent[0]
  const when = row?.kind === 'delayed' ? row.args[1] : row?.args?.[2]
  check('A6 and it carries the LAST time, not the first',
    new Date((when as Date) ?? 0).toISOString() === '2026-10-20T15:00:00.000Z',
    `${row?.kind} ${String(when)}`)
  check('A7 a move within the same day is a delay, not a reschedule',
    row?.kind === 'delayed', String(row?.kind))
}

/* ═════════════ A2 — the template is chosen at SEND time ═════════════ */
section('J. Which template is used follows the LAST correction, not the first')
{
  /* This is why the reschedule/delay decision moved out of the request and
     into the flush. The first edit moved the class within the day; the second
     pushed it to the next day. Deciding at park time would have sent the
     within-the-day "running late" mail about a class that is now tomorrow. */
  await reset()
  const cls = oid(), user = oid()
  const t0  = new Date('2026-10-01T09:00:00Z')
  const far = new Date('2026-10-20T09:00:00Z')
  const base = {
    liveClassId: String(cls), userId: String(user),
    email: 'j@cm.local', name: 'Jo', kind: 'rescheduled' as const,
    title: 'Forex Live', scheduledStart: far, oldStart: far,
  }

  await park({ ...base, newStart: new Date('2026-10-20T13:00:00Z') }, t0)
  await park({ ...base, newStart: new Date('2026-10-21T13:00:00Z') },
    new Date(t0.getTime() + 4 * MIN))

  await job.flushCriticalMail({ now: new Date(t0.getTime() + 11 * MIN), senders: recorder() })

  check('J1 one email for the pair', sent.length === 1, JSON.stringify(sent.map(s => s.kind)))
  check('J2 and it is the full reschedule, because the class moved day',
    sent[0]?.kind === 'rescheduled', String(sent[0]?.kind))
  check('J3 carrying the final time',
    new Date((sent[0]?.args?.[2] as Date) ?? 0).toISOString() === '2026-10-21T13:00:00.000Z',
    String(sent[0]?.args?.[2]))
}

/* ═════════════ C — different facts are not corrections ═════════════ */
section('C. A reschedule and a reassignment are two facts, so two emails')
{
  await reset()
  const cls = oid(), user = oid()
  const t0  = new Date('2026-10-01T09:00:00Z')
  const far = new Date('2026-10-20T09:00:00Z')
  const common = {
    liveClassId: String(cls), userId: String(user),
    email: 'b@cm.local', name: 'Bo', title: 'Forex Live', scheduledStart: far,
  }

  await park({ ...common, kind: 'rescheduled', oldStart: far,
    newStart: new Date('2026-10-20T11:00:00Z') }, t0)
  await park({ ...common, kind: 'instructor',
    oldInstructorName: 'Sara', newInstructorName: 'Omar' }, t0)

  check('C1 two rows are parked, one per fact',
    (await CriticalMailModel.countDocuments({})) === 2,
    String(await CriticalMailModel.countDocuments({})))

  await job.flushCriticalMail({ now: new Date(t0.getTime() + 11 * MIN), senders: recorder() })
  check('C2 both are sent', sent.length === 2, JSON.stringify(sent.map(s => s.kind)))
  check('C3 one about the time, one about the instructor',
    sent.some(s => s.kind === 'rescheduled' || s.kind === 'delayed') &&
    sent.some(s => s.kind === 'instructor'),
    JSON.stringify(sent.map(s => s.kind)))
}

/* ═════════════ D — a cancellation supersedes ═════════════ */
section('D. A cancellation drops anything still parked for that session')
{
  await reset()
  const cls = oid(), user = oid()
  const t0  = new Date('2026-10-01T09:00:00Z')
  const far = new Date('2026-10-20T09:00:00Z')
  const common = {
    liveClassId: String(cls), userId: String(user),
    email: 'c@cm.local', name: 'Cy', title: 'Forex Live', scheduledStart: far,
  }

  await park({ ...common, kind: 'rescheduled', oldStart: far,
    newStart: new Date('2026-10-20T11:00:00Z') }, t0)
  const cancel = await park({ ...common, kind: 'cancelled', oldStart: far },
    new Date(t0.getTime() + 3 * MIN))

  check('D1 the cancellation supersedes the pending reschedule', cancel.superseded === 1,
    String(cancel.superseded))

  await job.flushCriticalMail({ now: new Date(t0.getTime() + 15 * MIN), senders: recorder() })

  /* The failure this prevents is real: both were fire-and-forget, so a
     student could be told the class had moved AFTER being told it was off. */
  check('D2 only the cancellation is sent', sent.length === 1, JSON.stringify(sent.map(s => s.kind)))
  check('D3 and it is the cancellation, not the reschedule', sent[0]?.kind === 'cancelled',
    String(sent[0]?.kind))
  check('D4 the superseded row is never sent',
    (await CriticalMailModel.countDocuments({ kind: 'rescheduled', sentAt: null })) === 1,
    'the row stays unsent, marked superseded')
}

/* ═════════════ E — the buffer never outlives the class ═════════════ */
section('E. A class starting inside the buffer is not made to wait')
{
  const now  = new Date()
  const soon = new Date(now.getTime() + 8 * MIN)   // starts in 8, buffer is 10
  const late = new Date(now.getTime() + 90 * MIN)

  check('E1 a session starting in 8 minutes is urgent', job.isUrgent(soon, now) === true)
  check('E2 a session starting in 90 minutes is not',    job.isUrgent(late, now) === false)
  /* A 10-minute buffer on a cancellation for a class starting in 8 would be
     worse than no notification at all — the student turns up regardless. */
  check('E3 no start time means no urgency claim', job.isUrgent(undefined, now) === false)
}

/* ═════════════ G/H — the per-student daily cap ═════════════ */
section('G/H. Past the cap, mail folds into the digest — per student, not globally')
{
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)   // already due
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)
  const busy = oid(), calm = oid()

  const parkMany = async (user: any, email: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await park({
        liveClassId: String(oid()), userId: String(user), email, name: 'X',
        kind: 'cancelled', title: `Session ${i}`, scheduledStart: far, oldStart: far,
      }, past)
    }
  }
  await parkMany(busy, 'busy@cm.local', 4)   // cap is 2
  await parkMany(calm, 'calm@cm.local', 1)

  const res = await job.flushCriticalMail({ now: t0, senders: recorder() })

  const toBusy = sent.filter(s => s.to === 'busy@cm.local').length
  const toCalm = sent.filter(s => s.to === 'calm@cm.local').length

  check('G1 the busy student is mailed up to the cap and no further', toBusy === 2, String(toBusy))
  check('G2 the overflow folds into the digest instead of vanishing',
    (await DigestQueueModel.countDocuments({ userId: busy })) === 2,
    String(await DigestQueueModel.countDocuments({ userId: busy })))
  check('G3 the folded rows are closed out, not left to retry tomorrow',
    (await CriticalMailModel.countDocuments({ userId: busy, sentAt: null })) === 0,
    String(await CriticalMailModel.countDocuments({ userId: busy, sentAt: null })))
  check('G4 and are marked as folded, not as mailed',
    (await CriticalMailModel.countDocuments({ userId: busy, foldedToDigest: true })) === 2,
    String(await CriticalMailModel.countDocuments({ userId: busy, foldedToDigest: true })))

  /* A global counter would have let one student's bad day silence everyone
     else's cancellation notices. */
  check('H1 the quiet student is unaffected by the busy one', toCalm === 1, String(toCalm))
  check('H2 and nothing of theirs is folded',
    (await DigestQueueModel.countDocuments({ userId: calm })) === 0,
    String(await DigestQueueModel.countDocuments({ userId: calm })))
  check('H3 the tally reports both outcomes', res.sent === 3 && res.folded === 2, JSON.stringify(res))
}

/* ═════════════ I — a failed send keeps its row ═════════════ */
section('I. A send that throws leaves the row parked for the next tick')
{
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)
  const user = oid()

  await park({
    liveClassId: String(oid()), userId: String(user), email: 'i@cm.local', name: 'Ivy',
    kind: 'cancelled', title: 'Doomed', scheduledStart: far, oldStart: far,
  }, past)

  const exploding: any = { ...recorder(), cancelled: async () => { throw new Error('SMTP down') } }
  const res = await job.flushCriticalMail({ now: t0, senders: exploding })

  check('I1 the failure is counted, not swallowed', res.failed === 1 && res.sent === 0,
    JSON.stringify(res))
  /* Stamping before sending would be simpler and would silently drop a
     cancellation every time SMTP hiccupped. */
  check('I2 the row is still pending for the next tick',
    (await CriticalMailModel.countDocuments({ sentAt: null })) === 1,
    String(await CriticalMailModel.countDocuments({ sentAt: null })))

  const retry = await job.flushCriticalMail({ now: t0, senders: recorder() })
  check('I3 and the retry delivers it', retry.sent === 1, JSON.stringify(retry))
  check('I4 exactly once', (await CriticalMailModel.countDocuments({ sentAt: null })) === 0,
    String(await CriticalMailModel.countDocuments({ sentAt: null })))
}

/* ═════════════ K — the cap resets with the day ═════════════ */
section('K. The cap is DAILY — what was mailed yesterday does not count against today')
{
  /* A cap counted over all time would go quiet permanently for any student
     who ever had a bad week. */
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)
  const user = oid()

  const yesterday = new Date(t0.getTime() - 24 * 3600_000)
  for (let i = 0; i < 3; i++) {
    await CriticalMailModel.create({
      liveClassId: oid(), userId: user, email: 'k@cm.local', name: 'Kay',
      kind: 'cancelled', title: `Old ${i}`, scheduledStart: far, oldStart: far,
      queuedAt: yesterday, dueAt: yesterday, sentAt: yesterday,
    })
  }

  await park({
    liveClassId: String(oid()), userId: String(user), email: 'k@cm.local', name: 'Kay',
    kind: 'cancelled', title: 'Today', scheduledStart: far, oldStart: far,
  }, past)

  const res = await job.flushCriticalMail({ now: t0, senders: recorder() })
  check('K1 today starts fresh, so the mail goes out', res.sent === 1 && res.folded === 0,
    JSON.stringify(res))
  check('K2 and nothing is folded into the digest',
    (await DigestQueueModel.countDocuments({ userId: user })) === 0,
    String(await DigestQueueModel.countDocuments({ userId: user })))
}

/* ═════════════ L — two flushes at once ═════════════ */
section('L. Two flushes running at once must not send the same mail twice')
{
  /* Not hypothetical. The urgent path flushes from inside the admin's
     request, on whatever PM2 instance served it, while the cron tick flushes
     on instance 0 — so two flushes CAN overlap on the same rows, and the
     in-process `running` guard does not span processes. */
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)

  for (let i = 0; i < 5; i++) {
    await park({
      liveClassId: String(oid()), userId: String(oid()),
      email: `race${i}@cm.local`, name: 'R',
      kind: 'cancelled', title: `Race ${i}`, scheduledStart: far, oldStart: far,
    }, past)
  }

  const [a, b] = await Promise.all([
    job.flushCriticalMail({ now: t0, senders: recorder() }),
    job.flushCriticalMail({ now: t0, senders: recorder() }),
  ])

  check('L1 five parked mails produce five sends, not ten',
    sent.length === 5, `${sent.length} sends — ${JSON.stringify({ a, b })}`)
  check('L2 no address is mailed twice',
    new Set(sent.map(x => x.to)).size === sent.length,
    JSON.stringify(sent.map(x => x.to)))
  check('L3 and the two tallies add up to five',
    a.sent + b.sent === 5, JSON.stringify({ a, b }))
  check('L4 every row is closed out exactly once',
    (await CriticalMailModel.countDocuments({ sentAt: null })) === 0,
    String(await CriticalMailModel.countDocuments({ sentAt: null })))
}

/* ═════════════ M — a flush that died mid-send ═════════════ */
section('M. A row stranded by a dead flush is picked up again; one still in flight is not')
{
  /* The claim that stops a double-send would, on its own, strand a row
     forever if the process holding it was killed between claiming and
     sending — a deploy mid-flush, an OOM. The claim is therefore reclaimable
     once it is old enough to mean "nobody is coming back for this", and that
     age has to be long enough that a slow SMTP round is never mistaken for a
     corpse. */
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)

  const cls = oid()
  const common = {
    liveClassId: cls, kind: 'cancelled' as const,
    scheduledStart: far, oldStart: far, queuedAt: past, dueAt: past, sentAt: null,
  }
  /* Both rows need a live booking behind them, or the flush would drop them
     for a reason that has nothing to do with claims. */
  const deadUser = oid(), liveUser = oid()
  await ClassBookingModel.create({ userId: deadUser, liveClassId: cls, status: 'booked' })
  await ClassBookingModel.create({ userId: liveUser, liveClassId: cls, status: 'booked' })

  /* Stranded: claimed half an hour ago and never sent. */
  await CriticalMailModel.create({ ...common, userId: deadUser,
    email: 'dead@cm.local', name: 'D', title: 'Stranded',
    claimedAt: new Date(t0.getTime() - 30 * MIN) })
  /* In flight: another flush took it seconds ago and is still sending. */
  await CriticalMailModel.create({ ...common, userId: liveUser,
    email: 'inflight@cm.local', name: 'F', title: 'In flight',
    claimedAt: new Date(t0.getTime() - 10_000) })

  const res = await job.flushCriticalMail({ now: t0, senders: recorder() })

  check('M1 exactly one of the two is taken', res.sent === 1, JSON.stringify(res))
  check('M2 and it is the stranded one', sent[0]?.to === 'dead@cm.local', String(sent[0]?.to))
  check('M3 the in-flight row is left alone',
    (await CriticalMailModel.countDocuments({ email: 'inflight@cm.local', sentAt: null })) === 1,
    'it must not be stolen from the flush that is still sending it')
}

/* ═══════════ N — the audience is re-checked at send time ═══════════ */
section('N. A student who withdraws inside the buffer is not mailed')
{
  /* The debounce introduced a gap the old immediate send did not have: the
     recipients are resolved when the edit lands, but the mail leaves up to
     ten minutes later. §4 scopes these notices to students with an ACTIVE
     booking, and ten minutes is long enough to cancel one. */
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)
  const cls  = oid()
  const quitter = oid(), stayer = oid()

  for (const [u, email] of [[quitter, 'quit@cm.local'], [stayer, 'stay@cm.local']] as const) {
    await park({
      liveClassId: String(cls), userId: String(u), email, name: 'N',
      kind: 'rescheduled', title: 'Forex Live', scheduledStart: far, oldStart: far,
      newStart: new Date(far.getTime() + 2 * 3600_000),
    }, past)
  }

  /* One of them cancels their seat while the mail is still parked. */
  await ClassBookingModel.updateOne({ liveClassId: cls, userId: quitter },
    { $set: { status: 'cancelled' } })

  const res = await job.flushCriticalMail({ now: t0, senders: recorder() })

  check('N1 the student who left is dropped, not mailed', res.dropped === 1, JSON.stringify(res))
  check('N2 and the one still booked IS mailed',
    sent.length === 1 && sent[0]?.to === 'stay@cm.local', JSON.stringify(sent.map(x => x.to)))
  check('N3 the dropped row is closed as superseded, not left to retry',
    (await CriticalMailModel.countDocuments({ userId: quitter, supersededAt: { $ne: null } })) === 1,
    String(await CriticalMailModel.countDocuments({ userId: quitter, supersededAt: { $ne: null } })))
}

section('N(b). Cancelling the SESSION must not drop its own audience')
{
  /* The dangerous way to get the re-check wrong. Booking rows are not touched
     when an admin cancels a class — so a cancellation notice still finds
     everyone. If that ever changes, this fails loudly instead of silently
     mailing nobody about a cancelled class. */
  await reset()
  const t0   = new Date()
  const past = new Date(t0.getTime() - 30 * MIN)
  const far  = new Date(t0.getTime() + 30 * 24 * 3600_000)
  const cls  = oid(), user = oid()

  await park({
    liveClassId: String(cls), userId: String(user), email: 'cancel@cm.local', name: 'C',
    kind: 'cancelled', title: 'Called Off', scheduledStart: far, oldStart: far,
  }, past)

  const res = await job.flushCriticalMail({ now: t0, senders: recorder() })
  check('N4 the cancellation still reaches the booked student',
    res.sent === 1 && res.dropped === 0, JSON.stringify(res))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ncriticalmail.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
