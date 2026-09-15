/* ─────────────────────────────────────────────────────────────
   The daily Standard-tier digest.

   Phase 2 of the Class-Update Notification spec. Standard-tier events queue
   per student and go out once a day as ONE email — "here's what changed in
   your classes today" — while Critical-tier events bypass the queue entirely
   and send immediately.

   The spec's own words are the assertions:

     A  several Standard events become ONE email, not one each
     B  "If a student has no queued Standard-tier events on a given day, no
        digest is sent"
     C  each student gets their own digest, containing only their own items
     D  a flush marks its rows sent, so running it again mails nobody twice
     E  Critical-tier still sends immediately and never lands in the queue
     F  a send that fails leaves the rows PENDING for the next run rather
        than silently swallowing a day of updates
     G  a deactivated student's rows are closed out, not left to pile up
     H  a row queued DURING a flush is left for tomorrow rather than being
        stamped sent without appearing in any email

   Boots against an ISOLATED throwaway database (lms_digest_suite), dropped
   on exit. NODE_ENV=test forces the console sender; EMAIL_OUTBOX=on records
   every message so the assertions read real sends.

   Run: bun run test:digest
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_digest_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

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
const {
  UserModel, OrganizationModel, DigestQueueModel, EmailOutboxModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runDailyDigest, queueDigestItem } = await import('@/jobs/digest.job.ts')
const { sendDailyDigest } = await import('@/services/email.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_digest_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/** Mail is written asynchronously — poll for the expected count, read once. */
async function mailCount(to: string, want = 1, tries = 40): Promise<number> {
  let last = 0
  for (let i = 0; i < tries; i++) {
    last = await EmailOutboxModel.countDocuments({ to })
    if (last >= want) return last
    await new Promise(r => setTimeout(r, 100))
  }
  return last
}
async function noMail(to: string): Promise<number> {
  await new Promise(r => setTimeout(r, 700))
  return EmailOutboxModel.countDocuments({ to })
}
const latestMail = (to: string) =>
  EmailOutboxModel.findOne({ to }).sort({ createdAt: -1 }).lean() as any
const pendingFor = (userId: unknown) =>
  DigestQueueModel.countDocuments({ userId, sentAt: null })

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword('Digest1x')

let seq = 0
async function student(opts: { active?: boolean } = {}) {
  const n = seq++
  return UserModel.create({
    name: `Student ${n}`, email: `d${n}@dg.local`, passwordHash: hash,
    role: 'student', isActive: opts.active ?? true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id,
  })
}
const queue = (u: any, title: string, body = 'details') =>
  queueDigestItem({ userId: String(u._id), kind: 'new-session', title, body })

/* ═════════════════ A — many events, one email ═════════════════ */
section('A. Several queued events become ONE email')
{
  const s = await student()
  await queue(s, 'New session in Forex',   'MBT 1 — Mon 09:00')
  await queue(s, 'New session in Forex',   'MBT 2 — Tue 09:00')
  await queue(s, 'New session in Digital', 'DM 1 — Wed 14:00')

  const tally = await runDailyDigest()
  check('A1 the flush reports one student, three items',
    tally.students === 1 && tally.items === 3, JSON.stringify(tally))

  const n = await mailCount(s.email)
  const all = await EmailOutboxModel.find({ to: s.email }).sort({ createdAt: 1 }).lean() as any[]
  check('A2 exactly ONE email is sent, not three', n === 1,
    `${n} mails: ` + all.map(m => `[${m.subject}]`).join(' '))

  const mail = await latestMail(s.email)
  check('A3 the subject counts the updates',
    /3 updates in your classes today/i.test(String(mail?.subject)), String(mail?.subject))
  check('A4 every queued item appears in the body',
    ['MBT 1', 'MBT 2', 'DM 1'].every(x => String(mail?.html ?? '').includes(x)),
    String(mail?.html ?? '').slice(0, 200))
}

/* ═════════════════ B — nothing queued, nothing sent ═════════════════ */
section('B. A student with no queued events gets no digest')
{
  /* The spec is explicit about this one, and it is the difference between a
     digest and a daily "nothing happened" mail nobody wants. */
  const s = await student()
  await runDailyDigest()
  const n = await noMail(s.email)
  check('B1 no email for an empty queue', n === 0, String(n))
}

/* ═════════════════ C — one digest each ═════════════════ */
section('C. Each student gets their own digest with only their own items')
{
  const a = await student()
  const b = await student()
  await queue(a, 'New session in Forex', 'A-ONLY-ITEM')
  await queue(b, 'New session in Forex', 'B-ONLY-ITEM')

  await runDailyDigest()

  check('C1 student A is mailed', (await mailCount(a.email)) === 1)
  check('C2 student B is mailed', (await mailCount(b.email)) === 1)

  const ma = await latestMail(a.email)
  const mb = await latestMail(b.email)
  check('C3 A sees only their own item',
    String(ma?.html).includes('A-ONLY-ITEM') && !String(ma?.html).includes('B-ONLY-ITEM'))
  check('C4 B sees only their own item',
    String(mb?.html).includes('B-ONLY-ITEM') && !String(mb?.html).includes('A-ONLY-ITEM'))
}

/* ═════════════════ D — never twice ═════════════════ */
section('D. A second flush sends nothing more')
{
  const s = await student()
  await queue(s, 'New session in Forex', 'once only')
  await runDailyDigest()
  check('D1 the first flush mails them', (await mailCount(s.email)) === 1)

  const before = await EmailOutboxModel.countDocuments({})
  const tally  = await runDailyDigest()
  await new Promise(r => setTimeout(r, 600))
  const after  = await EmailOutboxModel.countDocuments({})

  check('D2 the second flush claims nothing', tally.students === 0, JSON.stringify(tally))
  check('D3 and sends no further mail', after === before, `${before} -> ${after}`)
  check('D4 the rows are marked sent', (await pendingFor(s._id)) === 0,
    String(await pendingFor(s._id)))
}

/* ═════════════════ E — Critical bypasses the queue ═════════════════ */
section('E. Critical-tier never enters the queue')
{
  /* notifyBookedStudents sends cancellations and reschedules straight away.
     The assertion that matters here is the NEGATIVE one: nothing it does
     should ever leave a row behind for the digest to pick up, or an urgent
     change would arrive at 6pm. */
  const { notifyBookedStudents } = await import('@/controllers/liveClass.controller.ts')
  const before = await DigestQueueModel.countDocuments({})

  await notifyBookedStudents({
    liveClassId: String(new mongoose.Types.ObjectId()),
    title: 'Some session', oldStart: new Date(), newStart: new Date(),
    wasCancelled: true, wasRescheduled: false, instructorChanged: false,
  } as any)

  const after = await DigestQueueModel.countDocuments({})
  check('E1 a Critical-tier notice queues nothing', after === before, `${before} -> ${after}`)
}

/* ═════════════════ F — a failed send keeps its rows ═════════════════ */
section('F. If the send fails, the rows stay pending for the next run')
{
  /* Stamping before sending would be simpler and would quietly lose a day of
     updates every time SMTP hiccupped. */
  const s = await student()
  await queue(s, 'New session in Forex', 'survives a failure')

  /* Injected rather than monkey-patched: ES module exports are readonly, and
     assigning over one throws. runDailyDigest takes the sender as a parameter
     for exactly this reason. */
  await runDailyDigest(async () => { throw new Error('smtp down') })

  check('F1 the rows are still pending after a failed send',
    (await pendingFor(s._id)) === 1, String(await pendingFor(s._id)))

  /* And the next run delivers them. */
  await runDailyDigest()
  check('F2 the next run sends them', (await mailCount(s.email)) === 1,
    String(await mailCount(s.email)))
  check('F3 and clears the queue', (await pendingFor(s._id)) === 0,
    String(await pendingFor(s._id)))
}

/* ═════════════════ G — deactivated students ═════════════════ */
section('G. A deactivated student is not mailed, and does not accumulate')
{
  const s = await student({ active: false })
  await queue(s, 'New session in Forex', 'nobody home')

  await runDailyDigest()
  check('G1 no email is sent to a disabled account', (await noMail(s.email)) === 0)
  check('G2 but the rows are closed out rather than retried forever',
    (await pendingFor(s._id)) === 0, String(await pendingFor(s._id)))
}

/* ═════════════════ H — queued during a flush ═════════════════ */
section('H. A row queued after the flush starts is left for tomorrow')
{
  /* The flush claims by timestamp. A row created a moment later must not be
     stamped sent by a digest that never contained it — that would be a
     silently lost update, which is the one outcome worse than a late one. */
  const s = await student()
  await queue(s, 'New session in Forex', 'in this digest')
  await runDailyDigest()
  check('H1 the first item is delivered', (await mailCount(s.email)) === 1)

  await queue(s, 'New session in Forex', 'after the flush')
  check('H2 the later row is still pending', (await pendingFor(s._id)) === 1,
    String(await pendingFor(s._id)))

  /* The real concurrency case, and the one this section originally missed.

     Queuing AFTER runDailyDigest() has returned proves nothing: there is no
     overlap, so removing the claim window breaks none of it — a mutation run
     showed exactly that, by deleting `queuedAt <= claimedAt` and watching
     every assertion still pass.

     The row has to arrive WHILE the flush is in flight. The injected sender
     is the only place that is reliably mid-flush, so it queues one from
     there: the digest being sent cannot contain it, and without the claim
     window the sweep at the end would stamp it sent anyway — an update the
     student is told about in no email, ever. */
  const arrivedMidFlush = 'queued DURING the flush'
  await queue(s, 'New session in Forex', 'triggers a flush')
  await runDailyDigest(async (to, name, items, url) => {
    await queue(s, 'New session in Forex', arrivedMidFlush)
    await sendDailyDigest(to, name, items, url)
  })

  const midFlushRow = await DigestQueueModel.findOne({
    userId: s._id, body: arrivedMidFlush,
  }).lean() as any
  check('H5 a row queued mid-flush is NOT marked sent',
    midFlushRow?.sentAt == null, String(midFlushRow?.sentAt))

  /* And the mail that flush produced must not claim to contain it. */
  const thatMail = await latestMail(s.email)
  check('H6 and does not appear in the email that flush sent',
    !String(thatMail?.html ?? '').includes(arrivedMidFlush),
    String(thatMail?.html ?? '').slice(0, 160))

  /* The mid-flush row is still waiting. One more flush and it goes — which
     is the whole contract: deferred to the next digest, never dropped.

     Counting total mails here would only re-state how many flushes this
     section happens to run; what matters is that the row finally arrives. */
  const beforeFinal = await EmailOutboxModel.countDocuments({ to: s.email })
  await runDailyDigest()
  const afterFinal = await mailCount(s.email, beforeFinal + 1)
  check('H3 the next digest does send', afterFinal === beforeFinal + 1,
    `${beforeFinal} -> ${afterFinal}`)

  const mail = await latestMail(s.email)
  check('H4 and it carries the row that arrived mid-flush',
    String(mail?.html ?? '').includes(arrivedMidFlush),
    String(mail?.subject ?? ''))

  check('H7 nothing is left pending afterwards', (await pendingFor(s._id)) === 0,
    String(await pendingFor(s._id)))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ndigest.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
