/* ─────────────────────────────────────────────────────────────
   Class Verification — the mentor's attendance check and class review after
   every class (reminders.job.ts runMentorVerification, /admin/class-verification).

     A. 9 AM next morning, on the academy's clock
     B. the job: asks once attendance is decided, reminds at +2 h, last call
        the next morning (then Overdue); a class nobody booked needs nothing
     C. the list: a mentor sees their own classes only, an admin sees them all
     D. one class: students with phone and their commission-portal CS; another
        mentor gets nothing
     E. submit: refused before the end; marks + review saved, class verified,
        a cancelled seat never resurrected, audited
   Run: bun --no-env-file src/tests/classverification.suite.ts
───────────────────────────────────────────────────────────── */
import nodePath from 'node:path'
import nodeOs from 'node:os'

process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_classverification'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.EMAIL_LOG_DIR = nodePath.join(nodeOs.tmpdir(), `lms-classverify-mail-${process.pid}`)
process.env.ADMIN_URL = 'https://admin.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'classverify-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'classverify-suite-refresh-secret-0123456789'

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
const { runMentorVerification, nextMorningNine } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_classverification') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const MIN = 60_000, HOUR = 60 * MIN, PW = 'CorrectHorse1'

try {
  section('A · 9 AM next morning, on the academy\'s clock')
  const end = Date.parse('2026-10-07T18:00:00Z')   // 22:00 Dubai, 23:30 India
  check('Dubai: 9:00 next day', new Date(nextMorningNine(end, 'Asia/Dubai')).toISOString() === '2026-10-08T05:00:00.000Z', new Date(nextMorningNine(end, 'Asia/Dubai')).toISOString())
  check('India: 9:00 next day', new Date(nextMorningNine(end, 'Asia/Kolkata')).toISOString() === '2026-10-08T03:30:00.000Z', new Date(nextMorningNine(end, 'Asia/Kolkata')).toISOString())

  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mentor = await M.UserModel.create({ name: 'MOIZ', email: 'moiz@cv.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const other  = await M.UserModel.create({ name: 'OTHER', email: 'other@cv.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  await M.UserModel.create({ name: 'Admin', email: 'admin@cv.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt-' + Date.now(), description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const s1 = await M.UserModel.create({ name: 'Aisha', email: 'aisha@cv.local', passwordHash: hash, role: 'student', isActive: true, organizationId: org._id,
    enrollmentApplication: { phone: '+971501112222' }, commissionSync: { state: 'sent', mentorName: 'CS 1- MH', team: 'Hawks', studentCode: 'STU-1' } })
  const s2 = await M.UserModel.create({ name: 'Bilal', email: 'bilal@cv.local', passwordHash: hash, role: 'student', isActive: true, organizationId: org._id })
  const s3 = await M.UserModel.create({ name: 'Cara', email: 'cara@cv.local', passwordHash: hash, role: 'student', isActive: true, organizationId: org._id })
  const mk = (title: string, endedAgoMs: number, extra: Record<string, unknown> = {}) => M.LiveClassModel.create({
    title, courseId: course._id, instructorId: mentor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() - endedAgoMs - 120 * MIN), durationMins: 120, type: 'external', isOnline: true,
    status: 'ended', sessionCapacity: 30, bookedCount: 3, attendanceFinalized: true, ...extra,
  })
  const cls = await mk('MBT 4 · Hindi/English batch', 30 * MIN)
  const b1 = await M.ClassBookingModel.create({ userId: s1._id, liveClassId: cls._id, status: 'attended', attendedAt: new Date(), attendanceSource: 'click' })
  const b2 = await M.ClassBookingModel.create({ userId: s2._id, liveClassId: cls._id, status: 'missed' })
  const b3 = await M.ClassBookingModel.create({ userId: s3._id, liveClassId: cls._id, status: 'cancelled' })
  const empty = await mk('Nobody booked', 30 * MIN, { bookedCount: 0 })
  const undecided = await mk('Attendance not decided yet', 30 * MIN, { attendanceFinalized: false })

  section('B · the job: ask, remind at +2 h, last call next morning')
  const get = async (id: unknown) => await M.LiveClassModel.findById(id).lean() as any
  await runMentorVerification()
  let c = await get(cls._id)
  check('asked once attendance is decided', !!c.verifyRequestedAt && !c.verifyReminderAt)
  const note = await M.NotificationModel.findOne({ userId: mentor._id }).lean() as any
  check('the mentor gets an in-app notice to the class page', note?.link === `/class-verification/${cls._id}`, JSON.stringify(note?.link))
  const fs = await import('node:fs')
  const mails = () => fs.existsSync(process.env.EMAIL_LOG_DIR!) ? fs.readdirSync(process.env.EMAIL_LOG_DIR!).map(f => fs.readFileSync(nodePath.join(process.env.EMAIL_LOG_DIR!, f), 'utf8')) : []
  check('and an email with the admin-site link', mails().some(m => m.includes(`https://admin.example.test/class-verification/${cls._id}`)), `${mails().length} mails`)
  check('not before attendance is decided', !(await get(undecided._id)).verifyRequestedAt)
  check('nobody booked: nothing to check — verified, no verifier', !!(await get(empty._id)).verifiedAt && !(await get(empty._id)).verifiedBy)
  await runMentorVerification()
  check('no second ask within 2 hours', !(await get(cls._id)).verifyReminderAt)

  await M.LiveClassModel.updateOne({ _id: cls._id }, { $set: { scheduledStart: new Date(Date.now() - 3 * HOUR - 120 * MIN) } })
  await runMentorVerification()
  c = await get(cls._id)
  check('reminded 2 hours after the end', !!c.verifyReminderAt)
  const endNow = new Date(c.scheduledStart).getTime() + 120 * MIN
  const finalDue = Date.now() >= nextMorningNine(endNow, 'Asia/Dubai')
  await runMentorVerification()
  check(`last call only once 9 AM next morning has come (${finalDue ? 'it has' : 'not yet'})`, !!(await get(cls._id)).verifyFinalReminderAt === finalDue)
  await M.LiveClassModel.updateOne({ _id: cls._id }, { $set: { scheduledStart: new Date(Date.now() - 40 * HOUR) } })
  await runMentorVerification()
  check('the next morning: last call sent — Overdue from here', !!(await get(cls._id)).verifyFinalReminderAt)

  section('C · the list')
  const mJar: Jar = new Map(), oJar: Jar = new Map(), aJar: Jar = new Map()
  for (const [jar, email] of [[mJar, 'moiz@cv.local'], [oJar, 'other@cv.local'], [aJar, 'admin@cv.local']] as const) {
    const r = await call('POST', '/admin/auth/login', jar, { email, password: PW })
    check(`(${email} signs in)`, r.status === 200, why(r))
  }
  const ml = await call('GET', '/admin/class-verification?status=overdue', mJar)
  check('the mentor sees their overdue class', ml.status === 200 && ml.body?.data?.rows?.some((r: any) => r.id === String(cls._id)), why(ml))
  const row = ml.body?.data?.rows?.find((r: any) => r.id === String(cls._id))
  check('with its counts: 2 students, 1 attended, 1 missed', row?.students === 2 && row?.attended === 1 && row?.missed === 1, JSON.stringify(row))
  check('and the tab counts', ml.body?.data?.counts?.overdue >= 1, JSON.stringify(ml.body?.data?.counts))
  const ol = await call('GET', '/admin/class-verification?status=overdue', oJar)
  check('another mentor sees none of it', ol.status === 200 && !ol.body?.data?.rows?.some((r: any) => r.id === String(cls._id)), why(ol))
  const al = await call('GET', '/admin/class-verification?status=overdue', aJar)
  check('an admin sees it', al.status === 200 && al.body?.data?.rows?.some((r: any) => r.id === String(cls._id)), why(al))

  section('D · one class: students, phone, CS')
  const d = await call('GET', `/admin/class-verification/${cls._id}`, mJar)
  const aisha = d.body?.data?.students?.find((x: any) => x.name === 'Aisha')
  check('two live seats listed (the cancelled one is not)', d.status === 200 && d.body?.data?.students?.length === 2, why(d))
  check("the commission portal's CS, team and phone", aisha?.cs === 'CS 1- MH' && aisha?.team === 'Hawks' && aisha?.phone === '+971501112222', JSON.stringify(aisha))
  check('and how they joined', !!aisha?.joinedAt && aisha?.joinedVia === 'click')
  check('no CS on file: null, not a guess', d.body?.data?.students?.find((x: any) => x.name === 'Bilal')?.cs === null)
  const od = await call('GET', `/admin/class-verification/${cls._id}`, oJar)
  check('another mentor: not found', od.status === 404 || od.status === 403, why(od))

  section('E · submit')
  const future = await M.LiveClassModel.create({ title: 'Later', courseId: course._id, instructorId: mentor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + HOUR), durationMins: 60, type: 'external', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 0 })
  const early = await call('POST', `/admin/class-verification/${future._id}`, mJar, { marks: [], rating: 4 })
  check('before the class ends: refused', early.status === 400 && early.body?.error?.code === 'CLASS_NOT_ENDED', why(early))
  const bad = await call('POST', `/admin/class-verification/${cls._id}`, mJar, { marks: [], rating: 9 })
  check('a rating outside 1–5: refused', bad.status === 422 || bad.status === 400, why(bad))
  const ok = await call('POST', `/admin/class-verification/${cls._id}`, mJar, {
    marks: [
      { bookingId: String(b2._id), status: 'attended', note: 'Joined from his phone — not on the join log' },
      { bookingId: String(b3._id), status: 'attended' },
    ],
    rating: 4, topics: 'Order blocks', issues: 'Audio dropped once',
  })
  check('submitted', ok.status === 200 && ok.body?.data?.verified === true, why(ok))
  const b2Now = await M.ClassBookingModel.findById(b2._id).lean() as any
  check("the mentor's correction is saved, with the note", b2Now?.status === 'attended' && /phone/.test(b2Now?.mentorNote ?? ''), JSON.stringify({ s: b2Now?.status, n: b2Now?.mentorNote }))
  check('a cancelled seat is never resurrected', (await M.ClassBookingModel.findById(b3._id).lean() as any)?.status === 'cancelled')
  check('untouched seats keep their status', (await M.ClassBookingModel.findById(b1._id).lean() as any)?.status === 'attended')
  c = await get(cls._id)
  check('the class is verified, by the mentor, with the review',
    !!c.verifiedAt && String(c.verifiedBy) === String(mentor._id) && c.mentorReview?.rating === 4 && c.mentorReview?.topics === 'Order blocks')
  const v = await call('GET', '/admin/class-verification?status=verified', mJar)
  check('and moves to Verified', v.body?.data?.rows?.some((r: any) => r.id === String(cls._id) && r.status === 'verified'), why(v))
  await new Promise(r => setTimeout(r, 300))
  check('audited', !!(await M.AuditLogModel.findOne({ action: 'class.verify', entityId: String(cls._id) }).lean()))
  const theft = await call('POST', `/admin/class-verification/${cls._id}`, oJar, { marks: [], rating: 1 })
  check("another mentor cannot submit for this class", theft.status === 404 || theft.status === 403, why(theft))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
  ;(await import('node:fs')).rmSync(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
