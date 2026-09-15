/* ─────────────────────────────────────────────────────────────
   Do booked students actually get their class reminders?

   Three mails matter most to a student who booked a seat:

     30 minutes before  — "Starting in 30 mins"      (no link, by design)
      5 minutes before  — "Your Class Starts in 5 Minutes"  WITH the join link
        at start time   — "Class Has Started"                WITH the join link

   All three are cron jobs, and cron is exactly the kind of code that stops
   working without anyone finding out. The header of reminders.job.ts records
   what that already cost once: four bookings whose live class had been
   deleted populated to null, reading .scheduledStart off one threw inside a
   .filter(), and the exception escaped the whole job — so EVERY reminder for
   EVERY student stopped, once a minute, in silence.

   Nothing tested any of it. This suite drives each job directly against a
   seeded booking sitting in that job's window, and reads the mail back out of
   the outbox, so the questions it answers are the student's:

     A  the 30-minute mail goes, and says 30 minutes
     B  the 5-minute mail goes, and carries the Google Meet link
     C  the at-start mail goes, and carries the Google Meet link
     D  none of them is sent twice
     E  a class with no Meet link still gets a usable join URL
     F  cancelled bookings are left alone
     G  a booking whose class was deleted does not take the job down with it
        — the regression that caused the original outage

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_remindermails_suite), dropped on exit. NODE_ENV=test forces the
   console mail sender and EMAIL_OUTBOX=on records every message, so nothing
   leaves the machine and every assertion reads a real send.

   Run: bun run test:remindermails
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_remindermails_suite'
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
  UserModel, OrganizationModel, CourseModel, LiveClassModel,
  ClassBookingModel, EmailOutboxModel, NotificationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const {
  runPreSessionReminders, runFiveMinReminders, runAtTimeReminders,
} = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_remindermails_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const MEET = 'https://meet.google.com/abc-defg-hij'

/* Mail is written to the outbox before any send is attempted, but the job
   fires it without awaiting the write, so poll rather than sleep a guess. */
async function mailFor(to: string, subject: RegExp, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const rows = await EmailOutboxModel.find({ to }).sort({ createdAt: -1 }).lean() as any[]
    const hit = rows.find(r => subject.test(String(r.subject ?? '')))
    if (hit) return hit
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}
const mailCount = (to: string) => EmailOutboxModel.countDocuments({ to })

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword('Remind1x')
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@rm.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})
const course = await CourseModel.create({
  title: 'Forex', slug: 'forex-rm', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
})

let seq = 0
/** A booked student whose class starts `minutesFromNow` from now. */
async function seat(minutesFromNow: number, opts: { meetingUrl?: string | null; status?: string } = {}) {
  const n = seq++
  const student = await UserModel.create({
    name: `Student ${n}`, email: `s${n}@rm.local`, passwordHash: hash, role: 'student',
    isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
  })
  const lc = await LiveClassModel.create({
    title: `Session ${n}`, courseId: course._id, instructorId: teacher._id,
    organizationId: org._id,
    scheduledStart: new Date(Date.now() + minutesFromNow * 60 * 1000),
    durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1,
    ...(opts.meetingUrl === undefined ? { meetingUrl: MEET } : {}),
    ...(opts.meetingUrl ? { meetingUrl: opts.meetingUrl } : {}),
  })
  const booking = await ClassBookingModel.create({
    userId: student._id, liveClassId: lc._id,
    status: opts.status ?? 'booked', bookedAt: new Date(),
  })
  return { student, lc, booking }
}

/* ═════════════════ A — 30 minutes before ═════════════════ */
section('A. The 30-minute reminder')
{
  /* The job looks 25–35 minutes ahead, so 30 sits in the middle of it. */
  const { student, booking } = await seat(30)
  await runPreSessionReminders()

  const mail = await mailFor(student.email, /Starting in 30 mins/i)
  check('A1 the 30-minute email is sent', !!mail, String((await mailCount(student.email))))
  check('A2 its subject names the session',
    /Session/i.test(String(mail?.subject)), String(mail?.subject))

  const row = await ClassBookingModel.findById(booking._id).lean() as any
  check('A3 the booking is flagged so it cannot repeat', row?.reminderPreSessionSent === true,
    String(row?.reminderPreSessionSent))

  /* The student should also see it inside the app, even if mail fails. */
  const notes = await NotificationModel.countDocuments({ userId: student._id })
  check('A4 an in-app notification is created too', notes > 0, String(notes))
}

/* ═════════════════ B — 5 minutes before, WITH the link ═════════════════ */
section('B. The 5-minute reminder carries the Google Meet link')
{
  /* Window is 3–8 minutes ahead. */
  const { student, booking } = await seat(5)
  await runFiveMinReminders()

  const mail = await mailFor(student.email, /Starts in 5 Minutes/i)
  check('B1 the 5-minute email is sent', !!mail, String(await mailCount(student.email)))

  /* The whole point of this one: a link they can press. */
  check('B2 the Google Meet URL is in the body',
    String(mail?.html ?? '').includes(MEET), String(mail?.html ?? '').slice(0, 160))

  const row = await ClassBookingModel.findById(booking._id).lean() as any
  check('B3 the booking is flagged', row?.reminder5MinSent === true, String(row?.reminder5MinSent))
}

/* ═════════════════ C — at start time, WITH the link ═════════════════ */
section('C. The at-start reminder carries the Google Meet link')
{
  /* Window is the five minutes AFTER the start time, so a class that began
     one minute ago is due. */
  const { student, booking } = await seat(-1)
  await runAtTimeReminders()

  const mail = await mailFor(student.email, /Class Has Started/i)
  check('C1 the at-start email is sent', !!mail, String(await mailCount(student.email)))
  check('C2 the Google Meet URL is in the body',
    String(mail?.html ?? '').includes(MEET), String(mail?.html ?? '').slice(0, 160))

  const row = await ClassBookingModel.findById(booking._id).lean() as any
  check('C3 the booking is flagged', row?.reminderAtTimeSent === true, String(row?.reminderAtTimeSent))
}

/* ═════════════════ D — never twice ═════════════════ */
section('D. Running the jobs again sends nothing more')
{
  /* Cron fires every five minutes and the windows are ten minutes wide, so
     every reminder is looked at more than once by design. The flags are the
     only thing stopping a student being mailed repeatedly. */
  const before = await EmailOutboxModel.countDocuments({})
  await runPreSessionReminders()
  await runFiveMinReminders()
  await runAtTimeReminders()
  await new Promise(r => setTimeout(r, 800))
  const after = await EmailOutboxModel.countDocuments({})
  check('D1 a second pass sends no duplicate mail', after === before, `${before} -> ${after}`)
}

/* ═════════════════ E — no Meet link configured ═════════════════ */
section('E. A session with no Meet link still gets somewhere to go')
{
  const { student } = await seat(5, { meetingUrl: null })
  await runFiveMinReminders()

  const mail = await mailFor(student.email, /Starts in 5 Minutes/i)
  check('E1 the email is still sent', !!mail)
  /* Falls back to the in-app watch page rather than an empty href. */
  check('E2 it links to the watch page instead',
    /\/live-classes\/[^"']+\/watch/.test(String(mail?.html ?? '')),
    String(mail?.html ?? '').slice(0, 200))
}

/* ═════════════════ F — cancelled bookings ═════════════════ */
section('F. A cancelled booking is not reminded')
{
  const { student } = await seat(5, { status: 'cancelled' })
  await runFiveMinReminders()
  await new Promise(r => setTimeout(r, 600))
  check('F1 no mail for a cancelled seat', (await mailCount(student.email)) === 0,
    String(await mailCount(student.email)))
}

/* ═════════════════ G — the outage that started it all ═════════════════ */
section('G. A booking whose class was deleted does not stop everyone else')
{
  /* Recreating the original fault exactly: delete the live class but leave
     the booking. Before the guard, reading .scheduledStart off the null
     populate threw inside .filter() and the whole job died — so the HEALTHY
     student below got nothing either. That is the assertion that matters. */
  const orphan = await seat(5)
  await LiveClassModel.deleteOne({ _id: orphan.lc._id })

  const healthy = await seat(5)

  await runFiveMinReminders()

  const mail = await mailFor(healthy.student.email, /Starts in 5 Minutes/i)
  check('G1 the healthy student is still reminded', !!mail,
    'a throw on the orphan row would have taken this with it')
  check('G2 the orphaned booking gets nothing', (await mailCount(orphan.student.email)) === 0,
    String(await mailCount(orphan.student.email)))
}

/* ═════════════════ H — the in-app notification link ═════════════════ */
section('H. The class-has-started notification points at the meeting itself')
{
  /* Students reported they could not get the meeting link. They were right
     about the notification: every reminder created one pointing at
     /class-bookings, so the link lived ONLY inside the emails. Somebody
     working from the notification bell had no way to reach the room.

     Only the at-start reminder carries it -- that is the moment the room is
     the one thing they need. */
  const { student } = await seat(-1)
  await runAtTimeReminders()

  const note = await NotificationModel.findOne({
    userId: student._id, kind: 'class-reminder',
  }).sort({ createdAt: -1 }).lean() as any
  check('H1 an at-start notification exists', !!note, String(note?.title))
  check('H2 it links to the Google Meet room, not the schedule',
    String(note?.link) === MEET, String(note?.link))
}

/* ═════════════════ I — and only that one ═════════════════ */
section('I. Earlier reminders still point at the schedule')
{
  /* The 30-minute and 5-minute notifications were deliberately left alone.
     If they ever start carrying the room too, that is a decision somebody
     should make on purpose rather than inherit from this change. */
  const a = await seat(30)
  await runPreSessionReminders()
  const n30 = await NotificationModel.findOne({ userId: a.student._id }).sort({ createdAt: -1 }).lean() as any
  check('I1 the 30-minute notification still goes to the schedule',
    String(n30?.link) === '/class-bookings', String(n30?.link))

  const b = await seat(5)
  await runFiveMinReminders()
  const n5 = await NotificationModel.findOne({ userId: b.student._id }).sort({ createdAt: -1 }).lean() as any
  check('I2 the 5-minute notification still goes to the schedule',
    String(n5?.link) === '/class-bookings', String(n5?.link))
}

/* ═════════════════ J — no Meet link to point at ═════════════════ */
section('J. With no Meet link, the notification still goes somewhere usable')
{
  const { student } = await seat(-1, { meetingUrl: null })
  await runAtTimeReminders()
  const note = await NotificationModel.findOne({ userId: student._id }).sort({ createdAt: -1 }).lean() as any
  check('J1 it falls back to the in-app watch page',
    /\/live-classes\/[^/]+\/watch$/.test(String(note?.link)), String(note?.link))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\nremindermails.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
