/* ─────────────────────────────────────────────────────────────
   class_link_changed_v1 — the WhatsApp a booked student gets when their
   class's joining link changes (notifySessionEdited, liveClass.controller.ts).

     A. booked, with a phone: one message — name, class, day, time; button a
        sign-in code for the class page;
     B. no phone, or a cancelled booking: none;
     C. a minor edit only (no link change): none;
     D. a class already over: none (the in-app notice still goes).
   Run: bun --no-env-file src/tests/linkchangewhatsapp.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_linkchangewa'
process.env.NODE_ENV     = 'test'
process.env.CLIENT_URL   = 'https://lms.example.test'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'linkchange-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'linkchange-suite-refresh-secret-0123456789'

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
const { notifySessionEdited } = await import('@/controllers/liveClass.controller.ts')
const { hashSigninCode } = await import('@/services/signinLink.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_linkchangewa') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const outbox = () => M.WhatsAppOutboxModel.find({ templateName: 'class_link_changed_v1' }).lean() as Promise<any[]>

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const teacher = await M.UserModel.create({ name: 'T', email: 't@lc.local', passwordHash: 'x', role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const mkClass = (start: Date) => M.LiveClassModel.create({ title: 'MBT 5 · MALAYALAM BATCH', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: start, durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/new-room-abc', isOnline: true, status: 'scheduled', sessionCapacity: 30 })
  /* 9 Oct 2099 17:00 Dubai */
  const live = await mkClass(new Date('2099-10-09T13:00:00Z'))
  const mk = async (tag: string, cls: any, phone?: string, status = 'booked') => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@lc.local`, passwordHash: 'x', role: 'student', isActive: true, organizationId: org._id,
      ...(phone ? { enrollmentApplication: { phone } } : {}) })
    await M.ClassBookingModel.create({ userId: u._id, liveClassId: cls._id, status })
    return u
  }
  await mk('asha', live, '+971501111111'); await mk('nophone', live); await mk('gone', live, '+971502222222', 'cancelled')

  section('A · link changed: booked student with a phone')
  await notifySessionEdited({ liveClassId: String(live._id), title: live.title, linkChanged: true, minorChanges: [] })
  let wa = await outbox()
  check('one message, to asha', wa.length === 1 && wa[0].to.endsWith('501111111'), JSON.stringify(wa.map(w => w.to)))
  check('params: name, class, day, time', JSON.stringify(wa[0]?.params) === JSON.stringify(['asha', 'MBT 5 · MALAYALAM BATCH', 'Fri, 9 Oct', '05:00 PM GST']), JSON.stringify(wa[0]?.params))
  const tok = await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(wa[0]?.buttonParam ?? ''), purpose: 'signin-link' }).lean() as any
  check('button → the class page', tok?.nextPath === `/live-classes/${live._id}/watch`, tok?.nextPath)
  section('B · no phone, cancelled booking')
  check('neither got one (covered by A: exactly one)', wa.length === 1)

  section('C · minor edit only')
  await M.WhatsAppOutboxModel.deleteMany({})
  await notifySessionEdited({ liveClassId: String(live._id), title: live.title, linkChanged: false, minorChanges: ['the room'] })
  check('no WhatsApp', (await outbox()).length === 0)

  section('D · class already over')
  const past = await mkClass(new Date(Date.now() - 3 * 3600_000))
  const p = await mk('late', past, '+971503333333')
  const r = await notifySessionEdited({ liveClassId: String(past._id), title: past.title, linkChanged: true, minorChanges: [] })
  check('no WhatsApp', (await outbox()).length === 0)
  check('in-app notice still sent', r.notified === 1 && !!(await M.NotificationModel.findOne({ userId: p._id }).lean()), JSON.stringify(r))
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
