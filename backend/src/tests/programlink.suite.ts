/* ─────────────────────────────────────────────────────────────
   Programmes, 2026-10-17 — quiet, and a shareable link.
     A. made: its students get the in-app notice only — no email, no WhatsApp
     B. it has a link ({CLIENT_URL}/p/{code}) in the admin list
     C. the link's page (no sign-in): what it is and when; a bad code is 404
     D. the form: checked; a guest is kept (once per email); the Meet link only
        while the class can be joined; an LMS student on it goes straight to Meet too (2026-10-18)
     E. the admin sees who filled it in
     F. its reminders: in-app only; at its start the WhatsApp "Join now" only
     G. a change (cancelled): in-app only — no email, no WhatsApp
     H. the link knows an LMS student who is signed in: on it → straight to the class
   Run: bun --no-env-file src/tests/programlink.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_programlink'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_OUTBOX = 'on'
process.env.CRITICAL_DEBOUNCE_MINS = '0'
process.env.CLIENT_URL = 'https://lms.example'
process.env.JWT_ACCESS_SECRET  ??= 'programlink-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'programlink-refresh-secret-0123456789abcdef'
export {}
let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_programlink') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.ProgramModel.syncIndexes(); await M.ProgramGuestModel.syncIndexes()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'CorrectHorse1', DAY = 864e5, LINK = 'https://meet.google.com/abc-defg-hij'
const dubaiDay = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const settle = () => new Promise(r => setTimeout(r, 800))

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...extra })
  await mk('Admin', 'admin@pl.local', 'admin')
  const mentor = await mk('MOIZ', 'moiz@pl.local', 'instructor')
  const stu = await mk('Stu', 'stu@pl.local', 'student', { enrollmentApplication: { phone: '+971500000401' } })
  const admin: Jar = new Map()
  if ((await call('POST', '/admin/auth/login', admin, { email: 'admin@pl.local', password: PW })).status !== 200) throw new Error('admin login')

  section('A · made: in-app only')
  const made = await call('POST', '/admin/programs', admin, { title: 'NY Live Trade', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: dubaiDay(1), endDate: dubaiDay(2), time: '19:00', durationMins: 60, isOnline: true, meetingMode: 'link', meetingUrl: LINK,
    instructorId: String(mentor._id), students: [String(stu._id)] })
  check('created', made.status === 200, why(made))
  await settle()
  check('the student gets the in-app notice', (await M.NotificationModel.countDocuments({ userId: stu._id, title: /^New program/ })) === 1)
  check('...no email', (await M.EmailOutboxModel.countDocuments({ to: 'stu@pl.local' })) === 0)
  check('...no WhatsApp', (await M.WhatsAppOutboxModel.countDocuments({})) === 0)

  section('B · its link')
  const prog = made.body?.data
  check('a link in the admin list', /^https:\/\/lms\.example\/p\/[a-z0-9]{8}$/.test(String(prog?.joinUrl)) && prog?.joinCode?.length === 8, String(prog?.joinUrl))
  const code = String(prog?.joinCode)

  section('C · the link\'s page, signed out')
  const pub = await call('GET', `/public/programs/${code}`, null)
  check('what it is and when', pub.status === 200 && pub.body?.data?.title === 'NY Live Trade' && pub.body.data.mentor === 'MOIZ' && !!pub.body.data.nextClass?.startsAt, why(pub))
  check('nothing about who is on it', !JSON.stringify(pub.body?.data ?? {}).includes('stu@pl.local'))
  check('a bad code: 404', (await call('GET', '/public/programs/zzzzzzzz', null)).status === 404)

  section('D · the form')
  check('a bad email is refused', (await call('POST', `/public/programs/${code}/join`, null, { name: 'Ann', email: 'nope', phone: '+971500000000' })).status === 400)
  check('no phone is refused', (await call('POST', `/public/programs/${code}/join`, null, { name: 'Ann', email: 'ann@x.com', phone: '' })).status === 400)
  const early = await call('POST', `/public/programs/${code}/join`, null, { name: 'Ann Guest', email: 'Ann@X.com', phone: '+971 50 000 0000' })
  check('a day ahead: kept, and the Meet link already (redirect any time, 2026-10-18)', early.status === 200 && early.body?.data?.member === false && early.body.data.joinUrl === LINK, JSON.stringify(early.body?.data))
  const first = await M.LiveClassModel.findOne({ programId: prog.id }).sort({ scheduledStart: 1 })
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() + 5 * 60_000) } })
  const now = await call('POST', `/public/programs/${code}/join`, null, { name: 'Ann Guest', email: 'ann@x.com', phone: '+971500000000' })
  check('5 minutes before: the Meet link', now.body?.data?.joinUrl === LINK, JSON.stringify(now.body?.data))
  check('one guest per email (kept once), each redirect counted', (await M.ProgramGuestModel.countDocuments({ programId: prog.id })) === 1 && (await M.ProgramGuestModel.findOne({ email: 'ann@x.com' }).lean() as any)?.joins === 2)
  const member = await call('POST', `/public/programs/${code}/join`, null, { name: 'Stu', email: 'stu@pl.local', phone: '+971500000401' })
  check('an LMS student on it: straight to Meet too, not kept as a guest (2026-10-18)', member.body?.data?.member === true && member.body.data.joinUrl === LINK && (await M.ProgramGuestModel.countDocuments({ email: 'stu@pl.local' })) === 0, JSON.stringify(member.body?.data))
  check('...their join recorded on their seat (the class is 5 minutes away)', !!(await M.ClassBookingModel.findOne({ liveClassId: first!._id, userId: stu._id }).lean() as any)?.attendedAt)
  await M.ClassBookingModel.updateMany({ liveClassId: first!._id }, { $unset: { attendedAt: 1, attendanceSource: 1 } })

  section('E · the admin sees them')
  const guests = await call('GET', `/admin/programs/${prog.id}/guests`, admin)
  check('Ann, with her phone', guests.status === 200 && guests.body?.data?.length === 1 && guests.body.data[0].phone === '+971500000000', why(guests))

  section('F · reminders')
  const R = await import('@/jobs/reminders.job.ts')
  await M.EmailOutboxModel.deleteMany({}); await M.WhatsAppOutboxModel.deleteMany({})
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() + 25 * 60_000) } })
  await R.runPreSessionReminders()
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() + 5 * 60_000) } })
  await R.runFiveMinReminders()
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() - 60_000) } })
  await R.runAtTimeReminders()
  await settle()
  check('no reminder email', (await M.EmailOutboxModel.countDocuments({ to: 'stu@pl.local' })) === 0, String(await M.EmailOutboxModel.countDocuments({})))
  const wa = (await M.WhatsAppOutboxModel.find({}).lean() as any[]).map(r => r.templateName)
  check('one WhatsApp: "Join now" at its start', JSON.stringify(wa) === JSON.stringify(['class_has_started_v2']), JSON.stringify(wa))
  check('in-app reminders still come', (await M.NotificationModel.countDocuments({ userId: stu._id })) >= 3)

  section('F2 · program WhatsApp switched off (PROGRAM_WHATSAPP, 2026-10-18)')
  const F = await import('@/utils/featureFlags.ts')
  const env = { pw: process.env.PROGRAM_WHATSAPP, ne: process.env.NODE_ENV }
  process.env.PROGRAM_WHATSAPP = ''; process.env.NODE_ENV = 'production'
  check('unset in production: off', F.programWhatsAppOn() === false)
  process.env.PROGRAM_WHATSAPP = 'on'
  check('PROGRAM_WHATSAPP=on: on', F.programWhatsAppOn() === true)
  process.env.NODE_ENV = env.ne; process.env.PROGRAM_WHATSAPP = 'off'
  check('off: the program "added" message is refused', F.whatsappTemplateOn('course_update_v1', 'program') === false)
  check('off: other templates unaffected', F.whatsappTemplateOn('class_has_started_v2') === true)
  await M.WhatsAppOutboxModel.deleteMany({}); await M.NotificationModel.deleteMany({})
  await M.ClassBookingModel.updateMany({ liveClassId: first!._id }, { $set: { reminderAtTimeSent: false, reminder5MinSent: false } })
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() + 5 * 60_000) } })
  await R.runFiveMinReminders()
  await M.LiveClassModel.updateOne({ _id: first!._id }, { $set: { scheduledStart: new Date(Date.now() - 60_000) } })
  await R.runAtTimeReminders()
  await settle()
  check('off: no WhatsApp at its start', (await M.WhatsAppOutboxModel.countDocuments({})) === 0, JSON.stringify((await M.WhatsAppOutboxModel.find({}).lean() as any[]).map(r => r.templateName)))
  check('off: the in-app notices still come', (await M.NotificationModel.countDocuments({ userId: stu._id })) >= 1)
  check('off: the booking is marked, so nothing goes later', !!(await M.ClassBookingModel.findOne({ liveClassId: first!._id, userId: stu._id }).lean() as any)?.reminderAtTimeSent)
  if (env.pw === undefined) delete process.env.PROGRAM_WHATSAPP; else process.env.PROGRAM_WHATSAPP = env.pw

  section('G · a change')
  await M.EmailOutboxModel.deleteMany({}); await M.WhatsAppOutboxModel.deleteMany({}); await M.NotificationModel.deleteMany({})
  const second = await M.LiveClassModel.findOne({ programId: prog.id, _id: { $ne: first!._id } })
  const cancel = await call('PATCH', `/admin/live-classes/${second!._id}`, admin, { status: 'cancelled' })
  check('cancelled', cancel.status === 200, why(cancel))
  await settle()
  check('in-app', (await M.NotificationModel.countDocuments({ userId: stu._id, title: /cancelled/i })) >= 1)
  check('no email, no WhatsApp', (await M.EmailOutboxModel.countDocuments({ to: 'stu@pl.local' })) === 0 && (await M.WhatsAppOutboxModel.countDocuments({})) === 0)

  section('H · an LMS student opening the link, signed in')
  const out = await call('GET', `/public/programs/${code}/me`, null)
  check('signed out: nothing known', out.status === 200 && out.body?.data?.signedIn === false && out.body.data.member === false, why(out))
  const sj: Jar = new Map()
  const sl = await call('POST', '/auth/login', sj, { email: 'stu@pl.local', password: PW })
  if (sl.status === 200) {
    const me = await call('GET', `/public/programs/${code}/me`, sj)
    check('on the programme: member, with the Meet link to go straight to', me.body?.data?.member === true && !!me.body.data.classId && me.body.data.meetUrl === LINK, JSON.stringify(me.body?.data))
  } else check('student signs in (device check)', sl.body?.error?.code === 'DEVICE_PENDING', why(sl))
  await mk('Other', 'other@pl.local', 'student')
  const oj: Jar = new Map()
  const ol = await call('POST', '/auth/login', oj, { email: 'other@pl.local', password: PW })
  if (ol.status === 200) {
    const me2 = await call('GET', `/public/programs/${code}/me`, oj)
    check('a student not on it: signed in, not a member (gets the form)', me2.body?.data?.signedIn === true && me2.body.data.member === false, JSON.stringify(me2.body?.data))
  }
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await new Promise(r => setTimeout(r, 500))
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
