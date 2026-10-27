/* ─────────────────────────────────────────────────────────────
   The instructor-review request dispatch — reminders.job.ts's
   runReviewRequestDispatch. Since 2026-10-27: 10 minutes after the class
   ends, to every seat that joined (attendedAt) or is 'attended' — not
   waiting for attendance to be finalized — once per seat; a seat marked
   present later is asked on a later run; a class handled the old way
   (reviewRequestSent) is never re-asked.

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

  const MIN = 60_000
  /* A 60-minute class that ended `endedAgoMin` minutes ago. */
  const mkClass = (endedAgoMin: number, extra: Record<string, unknown> = {}) => LiveClassModel.create({
    title: 'Finished Session', courseId: course._id, instructorId: instructor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() - (60 + endedAgoMin) * MIN), durationMins: 60, type: 'external', isOnline: true,
    ...extra,
  })
  const seat = (u: { _id: unknown }, c: { _id: unknown }, status: string, extra: Record<string, unknown> = {}) =>
    ClassBookingModel.create({ userId: u._id, liveClassId: c._id, status, bookedAt: new Date(), ...extra })
  const askedFor = async (classId: unknown) =>
    (await ClassBookingModel.find({ liveClassId: classId, reviewRequestedAt: { $exists: true } }).select('userId').lean()).map(x => String(x.userId))
  const count = () => NotificationModel.countDocuments({ kind: 'instructor-review-requested' })

  /* ═══════════════════════════════════════════════ */
  section('A · 10 minutes after the end, before attendance is finalized — joined seats only')
  {
    const early = await mkClass(8)
    await seat(attendee1, early, 'booked', { attendedAt: new Date() })
    await runReviewRequestDispatch()
    check('8 minutes after the end: nobody is asked yet', (await count()) === 0)

    const cls = await mkClass(10, { attendanceFinalized: false })
    await seat(attendee1, cls, 'booked', { attendedAt: new Date() })   // joined, not yet finalized
    await seat(attendee2, cls, 'attended')                              // marked present
    await seat(noShow,    cls, 'booked')                                // never joined
    await runReviewRequestDispatch()

    const notifs = await NotificationModel.find({ kind: 'instructor-review-requested' }).lean()
    const recipientIds = new Set(notifs.map(n => String(n.userId)))
    check('10 minutes after the end: the student who joined is asked (attendance not finalized)', recipientIds.has(String(attendee1._id)))
    check('...and the one marked present', recipientIds.has(String(attendee2._id)))
    check('the student who never joined is NOT asked', !recipientIds.has(String(noShow._id)))
    check('...the 8-minute class is still waiting', !(await askedFor(early._id)).length)
    check('the asked seats are stamped', (await askedFor(cls._id)).length === 2)

    const mail = await mailbox()
    check('attendee1 got an email', mail.some(m => m.to.includes(attendee1.email)))
    check('attendee2 got an email too', mail.some(m => m.to.includes(attendee2.email)))
    check('the no-show got NO email', !mail.some(m => m.to.includes(noShow.email)))

    const wa = await waOutbox()
    check('attendee1 (has a phone) got a WhatsApp message', wa.some(w => w.to === '15550001111'))
    check('the no-show (has a phone, but never joined) got NO WhatsApp message',
      !wa.some(w => w.to === '15550002222'))
    check('the WhatsApp template carries the student name and session title',
      wa.some(w => w.templateName === 'instructor_review_request_v1' && w.params?.[0] === 'Attendee One' && w.params?.[1] === 'Finished Session'),
      JSON.stringify(wa.map(w => w.params)))

    /* ═══════════════════════════════════════════════ */
    section('B · never twice per seat — but a seat marked present later is asked')
    const before = await count()
    await runReviewRequestDispatch()
    await runReviewRequestDispatch()
    check('running the dispatch again creates nothing new', (await count()) === before, `${before} -> ${await count()}`)

    await ClassBookingModel.updateOne({ liveClassId: cls._id, userId: noShow._id }, { $set: { status: 'attended' } })
    await runReviewRequestDispatch()
    check('a student marked present afterwards is asked on the next run', (await askedFor(cls._id)).includes(String(noShow._id)))
    check('...only them', (await count()) === before + 1, `${before} -> ${await count()}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · missed seats, cancelled classes and old-style classes')
  {
    const before = await count()
    const missed = await mkClass(30, { attendanceFinalized: true })
    await seat(attendee1, missed, 'missed')
    await seat(attendee2, missed, 'cancelled')
    const cancelled = await mkClass(30, { status: 'cancelled' })
    await seat(attendee1, cancelled, 'attended')
    const oldStyle = await mkClass(30, { attendanceFinalized: true, reviewRequestSent: true })
    await seat(attendee1, oldStyle, 'attended')
    const stale = await mkClass(48 * 60, { attendanceFinalized: true })
    await seat(attendee1, stale, 'attended')
    await runReviewRequestDispatch()
    check('missed and cancelled seats, a cancelled class, a class already asked the old way and one older than 48h: nobody asked',
      (await count()) === before, `${before} -> ${await count()}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('D · an in-person class: asked once the register says present')
  {
    const before = await count()
    const room = await mkClass(15, { isOnline: false, location: 'Campus', room: 'A1' })
    await seat(attendee2, room, 'booked')
    await runReviewRequestDispatch()
    check('not before the register is taken', (await count()) === before)
    await ClassBookingModel.updateOne({ liveClassId: room._id }, { $set: { status: 'attended' } })
    await runReviewRequestDispatch()
    check('asked once marked present', (await count()) === before + 1, `${before} -> ${await count()}`)
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
