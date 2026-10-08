/* ─────────────────────────────────────────────────────────────
   The WhatsApp side of a booked class's critical change — class_cancelled_v1,
   class_rescheduled_v1, class_mentor_changed_v1 — sent by the critical-mail
   flush right after the email (jobs/criticalmail.job.ts).

     A. cancelled: name, class, day, time; button a sign-in code for the schedule;
     B. rescheduled: was / now with day and time; button for My Bookings;
     C. mentor changed: the new mentor's name;
     D. no phone: the email still goes, no WhatsApp;
     E. a failed email: no WhatsApp, the row stays pending;
     F. a student who withdrew inside the buffer: neither.
   Run: bun --no-env-file src/tests/changewhatsapp.suite.ts
───────────────────────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_changewhatsapp'
process.env.NODE_ENV     = 'test'
process.env.CLIENT_URL   = 'https://lms.example.test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CRITICAL_DEBOUNCE_MINS = '10'
process.env.CRITICAL_MAIL_CAP      = '5'
process.env.JWT_ACCESS_SECRET  ??= 'changewa-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'changewa-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const M = await import('@/models/schema.ts')
const job = await import('@/jobs/criticalmail.job.ts')
const { hashSigninCode } = await import('@/services/signinLink.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_changewhatsapp') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

const MIN = 60_000, HOUR = 60 * MIN
const mails: string[] = []
let failMail = false
const senders = {
  cancelled:   async (to: string) => { if (failMail) throw new Error('smtp down'); mails.push(`cancelled:${to}`) },
  rescheduled: async (to: string) => { mails.push(`rescheduled:${to}`) },
  delayed:     async (to: string) => { mails.push(`delayed:${to}`) },
  instructor:  async (to: string) => { mails.push(`instructor:${to}`) },
} as any
const outbox = (name: string) => M.WhatsAppOutboxModel.find({ templateName: name }).lean() as Promise<any[]>
const nextOf = async (code: string) => (await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(code), purpose: 'signin-link' }).lean() as any)?.nextPath

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const teacher = await M.UserModel.create({ name: 'T', email: 't@cw.local', passwordHash: 'x', role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  /* 13 Oct 2026 17:00 Dubai = 13:00 UTC */
  const at = new Date('2026-10-13T13:00:00Z'), moved = new Date('2026-10-14T15:00:00Z')
  const live = await M.LiveClassModel.create({ title: 'MBT 4 · MALAYALAM BATCH', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: at, durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30 })
  const mk = async (tag: string, phone?: string) => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@cw.local`, passwordHash: 'x', role: 'student', isActive: true, organizationId: org._id,
      ...(phone ? { enrollmentApplication: { phone } } : {}) })
    await M.ClassBookingModel.create({ userId: u._id, liveClassId: live._id, status: 'booked' })
    return u
  }
  const reema = await mk('reema', '+971504027626'), nophone = await mk('nophone'), left = await mk('left', '+971500000009')
  const t0 = new Date()
  const park = (u: any, kind: string, extra: Record<string, unknown> = {}) => job.parkCriticalMail({
    liveClassId: String(live._id), userId: String(u._id), email: u.email, name: u.name, kind: kind as any,
    title: live.title, scheduledStart: at, oldStart: at, newStart: at, ...extra,
  } as any, t0)
  const flush = () => job.flushCriticalMail({ now: new Date(t0.getTime() + 11 * MIN), senders })

  section('A · cancelled')
  await park(reema, 'cancelled'); await park(nophone, 'cancelled'); await park(left, 'cancelled')
  await M.ClassBookingModel.updateOne({ userId: left._id }, { $set: { status: 'cancelled' } })
  await flush()
  let wa = await outbox('class_cancelled_v1')
  check('one WhatsApp, to reema', wa.length === 1 && wa[0].to.endsWith('504027626'), JSON.stringify(wa.map(w => w.to)))
  check('params: name, class, day, time', JSON.stringify(wa[0]?.params) === JSON.stringify(['reema', 'MBT 4 · MALAYALAM BATCH', 'Tue, 13 Oct', '05:00 PM GST']), JSON.stringify(wa[0]?.params))
  check('button → /class-bookings', (await nextOf(wa[0]?.buttonParam)) === '/class-bookings')
  section('D · no phone: email only')
  check('nophone got the email', mails.includes('cancelled:nophone@cw.local'), mails.join(','))
  section('F · withdrew inside the buffer: neither')
  check('no email, no WhatsApp for "left"', !mails.includes('cancelled:left@cw.local') && !wa.some(w => w.to.endsWith('500000009')))

  section('B · rescheduled')
  await park(reema, 'rescheduled', { newStart: moved })
  await flush()
  wa = await outbox('class_rescheduled_v1')
  check('one WhatsApp', wa.length === 1, String(wa.length))
  check('was / now', wa[0]?.params?.[2] === 'Tue, 13 Oct, 05:00 PM GST' && wa[0]?.params?.[3] === 'Wed, 14 Oct, 07:00 PM GST', JSON.stringify(wa[0]?.params))
  check('button → /my-bookings', (await nextOf(wa[0]?.buttonParam)) === '/my-bookings')

  section('C · mentor changed')
  await park(reema, 'instructor', { oldInstructorName: 'Old', newInstructorName: 'Hafizulla' })
  await flush()
  wa = await outbox('class_mentor_changed_v1')
  check('one WhatsApp, new mentor named', wa.length === 1 && wa[0].params?.[3] === 'Hafizulla' && wa[0].params?.[2] === 'Tue, 13 Oct, 05:00 PM GST', JSON.stringify(wa[0]?.params))

  section('E · the email fails: no WhatsApp, row stays pending')
  await M.WhatsAppOutboxModel.deleteMany({})
  failMail = true
  await M.CriticalMailModel.deleteMany({})
  await park(reema, 'cancelled')
  const r = await flush()
  check('failed 1', r.failed === 1, JSON.stringify(r))
  check('no WhatsApp', (await outbox('class_cancelled_v1')).length === 0)
  failMail = false
  const r2 = await job.flushCriticalMail({ now: new Date(t0.getTime() + 12 * MIN), senders })
  check('next flush: mail + WhatsApp', r2.sent === 1 && (await outbox('class_cancelled_v1')).length === 1, JSON.stringify(r2))
  void HOUR
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
