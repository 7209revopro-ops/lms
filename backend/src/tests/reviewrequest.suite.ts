/* ─────────────────────────────────────────────────────────────
   The instructor-review request dispatch — reminders.job.ts's
   runReviewRequestDispatch. Fires once a class's attendance has already
   finalized, only for seats that finalized to 'attended', never twice for
   the same class.

   Run: bun run test:reviewrequest
───────────────────────────────────────────────────────────── */
const nodePathBoot = await import('path')
process.env.EMAIL_LOG_DIR    = nodePathBoot.join(process.cwd(), '.logs', 'emails-reviewrequest-' + String(process.pid))
process.env.WHATSAPP_LOG_DIR = nodePathBoot.join(process.cwd(), '.logs', 'whatsapp-reviewrequest-' + String(process.pid))
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_reviewrequest_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

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

const nodeFs   = await import('fs/promises')
const nodePath = await import('path')
const MAILDIR = process.env.EMAIL_LOG_DIR!
const WADIR   = process.env.WHATSAPP_LOG_DIR!

interface Mail { to: string; subject: string }
async function mailbox(): Promise<Mail[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(MAILDIR) } catch { return [] }
  const out: Mail[] = []
  for (const n of names) {
    if (!n.endsWith('.html')) continue
    const raw  = await nodeFs.readFile(nodePath.join(MAILDIR, n), 'utf8')
    const head = raw.slice(0, raw.indexOf('\n') + 1)
    out.push({
      to:      (head.match(/to:\s*([^|]+)\|/)?.[1] ?? '').trim(),
      subject: (head.match(/subject:\s*(.*?)\s*-->/)?.[1] ?? '').trim(),
    })
  }
  return out
}

interface Wa { to: string; templateName: string; params: string[] }
async function waOutbox(): Promise<Wa[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(WADIR) } catch { return [] }
  const out: Wa[] = []
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const raw = await nodeFs.readFile(nodePath.join(WADIR, n), 'utf8')
    try { out.push(JSON.parse(raw)) } catch { /* skip */ }
  }
  return out
}

const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel, NotificationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runReviewRequestDispatch } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_reviewrequest_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/* Boots the real app only so model registration / connection plumbing is
   identical to every other suite — this job is invoked directly, not over
   HTTP. */
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@rr.local`

try {
  const org  = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const instructor = await UserModel.create({ name: 'Teacher', email: email('teach'), passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = await CourseModel.create({
    title: 'Course', slug: `c-${Date.now()}`, description: 'd', instructorId: instructor._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })
  const attendee1 = await UserModel.create({ name: 'Attendee One', email: email('a1'), passwordHash: hash, role: 'student', isActive: true, organizationId: org._id, phone: '+15550001111' })
  const attendee2 = await UserModel.create({ name: 'Attendee Two', email: email('a2'), passwordHash: hash, role: 'student', isActive: true, organizationId: org._id })  // no phone
  const noShow    = await UserModel.create({ name: 'No Show', email: email('ns'), passwordHash: hash, role: 'student', isActive: true, organizationId: org._id, phone: '+15550002222' })

  const mkClass = (extra: Record<string, unknown> = {}) => LiveClassModel.create({
    title: 'Finished Session', courseId: course._id, instructorId: instructor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() - 2 * 3_600_000), durationMins: 60, type: 'external', isOnline: true,
    ...extra,
  })

  /* ═══════════════════════════════════════════════ */
  section('A · only attendance-finalized classes are considered, only attended seats asked')
  {
    const notFinalized = await mkClass({ attendanceFinalized: false })
    await ClassBookingModel.create({ userId: attendee1._id, liveClassId: notFinalized._id, status: 'attended', bookedAt: new Date() })

    const cls = await mkClass({ attendanceFinalized: true })
    await ClassBookingModel.create({ userId: attendee1._id, liveClassId: cls._id, status: 'attended', bookedAt: new Date() })
    await ClassBookingModel.create({ userId: attendee2._id, liveClassId: cls._id, status: 'attended', bookedAt: new Date() })
    await ClassBookingModel.create({ userId: noShow._id,    liveClassId: cls._id, status: 'missed',   bookedAt: new Date() })

    await runReviewRequestDispatch()

    const notifs = await NotificationModel.find({ kind: 'instructor-review-requested' }).lean()
    const recipientIds = new Set(notifs.map(n => String(n.userId)))
    check('attendee1 (finalized class) is asked', recipientIds.has(String(attendee1._id)))
    check('attendee2 (finalized class) is asked', recipientIds.has(String(attendee2._id)))
    check('the no-show is NOT asked', !recipientIds.has(String(noShow._id)))

    const notFinalizedCls = await LiveClassModel.findById(notFinalized._id).select('reviewRequestSent').lean()
    check('the NOT-yet-finalized class is left alone — not marked sent', notFinalizedCls?.reviewRequestSent !== true,
      String(notFinalizedCls?.reviewRequestSent))

    const finalizedCls = await LiveClassModel.findById(cls._id).select('reviewRequestSent').lean()
    check('the finalized class is marked sent', finalizedCls?.reviewRequestSent === true, String(finalizedCls?.reviewRequestSent))

    const mail = await mailbox()
    check('attendee1 got an email', mail.some(m => m.to.includes(attendee1.email)))
    check('attendee2 got an email too', mail.some(m => m.to.includes(attendee2.email)))
    check('the no-show got NO email', !mail.some(m => m.to.includes(noShow.email)))

    const wa = await waOutbox()
    check('attendee1 (has a phone) got a WhatsApp message', wa.some(w => w.to === '15550001111'))
    check('attendee2 (NO phone on file) got none — per-recipient, not all-or-nothing',
      !wa.some(w => w.to === attendee2.email))
    check('the no-show (has a phone, but never attended) got NO WhatsApp message either',
      !wa.some(w => w.to === '15550002222'))
    check('the WhatsApp template carries the student name and session title',
      wa.some(w => w.templateName === 'instructor_review_request_v1' && w.params?.[0] === 'Attendee One'),
      JSON.stringify(wa.map(w => w.params)))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · a second pass never re-sends for the same class')
  {
    const before = await NotificationModel.countDocuments({ kind: 'instructor-review-requested' })
    await runReviewRequestDispatch()
    await runReviewRequestDispatch()
    const after = await NotificationModel.countDocuments({ kind: 'instructor-review-requested' })
    check('running the dispatch again creates nothing new', after === before, `${before} -> ${after}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · a class with zero attended seats is still marked done, never rescanned forever')
  {
    const allMissed = await mkClass({ attendanceFinalized: true })
    await ClassBookingModel.create({ userId: noShow._id, liveClassId: allMissed._id, status: 'missed', bookedAt: new Date() })

    await runReviewRequestDispatch()
    const row = await LiveClassModel.findById(allMissed._id).select('reviewRequestSent').lean()
    check('marked sent even with nobody to ask', row?.reviewRequestSent === true, String(row?.reviewRequestSent))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · a cancelled class is never dispatched')
  {
    const cancelled = await mkClass({ attendanceFinalized: true, status: 'cancelled' })
    await ClassBookingModel.create({ userId: attendee1._id, liveClassId: cancelled._id, status: 'attended', bookedAt: new Date() })

    const before = await NotificationModel.countDocuments({ kind: 'instructor-review-requested' })
    await runReviewRequestDispatch()
    const after = await NotificationModel.countDocuments({ kind: 'instructor-review-requested' })
    check('a cancelled class dispatches nothing', after === before, `${before} -> ${after}`)
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  try {
    await nodeFs.rm(MAILDIR, { recursive: true, force: true })
    await nodeFs.rm(WADIR, { recursive: true, force: true })
  } catch { /* best effort */ }
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
