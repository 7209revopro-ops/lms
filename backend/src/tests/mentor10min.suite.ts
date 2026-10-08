/* ─────────────────────────────────────────────────────────────
   The mentor's WhatsApp about ten minutes before an online class
   (jobs/reminders.job.ts → runMentor10MinWhatsApp).

   Against a real database, with WhatsApp in test mode (a send is queued and
   the console sender marks it delivered):
     A. an online class 9 minutes out, its mentor with a phone: exactly one
        mentor_class_in_10_min — the right params, the Start button to
        <id>/join — and the class marked done;
     B. a second run sends nothing new: once per class;
     C. nothing for a class in person, too far off, cancelled, or already
        started by its mentor;
     D. a mentor with no phone: nothing sent, and the class marked done so
        the job stops re-reading it every minute.
   Run: bun --no-env-file src/tests/mentor10min.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_mentor10min'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.WHATSAPP_API_KEY         = ''
process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.JWT_ACCESS_SECRET  ??= 'mentor10min-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mentor10min-suite-refresh-secret-0123456789'

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
const { UserModel, CourseModel, OrganizationModel, LiveClassModel, WhatsAppOutboxModel } = await import('@/models/schema.ts')
const { runMentor10MinWhatsApp } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_mentor10min') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const MIN = 60_000

try {
  const org = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const mentor = await UserModel.create({
    name: 'MOIZ SHAIKH', email: 'moiz@m10.local', passwordHash: 'x', role: 'instructor',
    isActive: true, organizationId: org._id, phone: '+971 50 123 4567',
  })
  const silent = await UserModel.create({
    name: 'NO PHONE', email: 'nophone@m10.local', passwordHash: 'x', role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'Course', slug: `course-${Date.now()}`, description: 'd', instructorId: mentor._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })
  const mk = (title: string, inMins: number, extra: Record<string, unknown> = {}) =>
    LiveClassModel.create({
      title, courseId: course._id, instructorId: mentor._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() + inMins * MIN), durationMins: 120,
      type: 'external', meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true,
      status: 'scheduled', sessionCapacity: 30, bookedCount: 0, ...extra,
    })

  const online  = await mk('MBT 4 · Hindi/English batch', 9, { bookedCount: 12 })
  const inRoom  = await mk('MBT 4 · HINDI/ENGLISH OFFLINE', 9, { isOnline: false, location: 'AL QUSAIS', room: '2', meetingUrl: undefined })
  const tooFar  = await mk('Too far off', 20)
  const gone    = await mk('Cancelled', 9, { status: 'cancelled' })
  const started = await mk('Started early', 9, { status: 'live' })
  const noPhone = await mk('Mentor has no phone', 9, { instructorId: silent._id })

  await runMentor10MinWhatsApp()
  const rows = await WhatsAppOutboxModel.find({ templateName: 'mentor_class_in_10_min' }).lean() as any[]

  section('A · an online class 9 minutes out, mentor with a phone')
  check('exactly one message', rows.length === 1, String(rows.length))
  const r = rows[0]
  check('to the mentor, normalised', r?.to === '971501234567', r?.to)
  check('params [name, class, time, booked]',
    r?.params?.[0] === 'MOIZ SHAIKH' && r?.params?.[1] === 'MBT 4 · Hindi/English batch' && /GST$/.test(r?.params?.[2] ?? '') && r?.params?.[3] === '12',
    JSON.stringify(r?.params))
  check('the Start button opens <id>/join', r?.buttonParam === `${String(online._id)}/join`, r?.buttonParam)
  check('and the class is marked done',
    (await LiveClassModel.findById(online._id).lean() as any)?.mentorWhatsApp10MinSent === true)

  section('B · once per class')
  await runMentor10MinWhatsApp()
  check('a second run sends nothing new',
    await WhatsAppOutboxModel.countDocuments({ templateName: 'mentor_class_in_10_min' }) === 1)

  section('C · nothing for the classes it is not for')
  const flag = async (id: unknown) => (await LiveClassModel.findById(id).lean() as any)?.mentorWhatsApp10MinSent === true
  check('in person: nothing, and left alone', !(await flag(inRoom._id)))
  check('20 minutes out: not yet', !(await flag(tooFar._id)))
  check('cancelled: nothing', !(await flag(gone._id)))
  check('already started by its mentor: nothing', !(await flag(started._id)))

  section('D · a mentor with no phone')
  check('nothing sent for them', rows.every(x => !String(x.buttonParam).startsWith(String(noPhone._id))))
  check('but the class is marked done', await flag(noPhone._id))
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
