/* ─────────────────────────────────────────────────────────────
   "Did the class end?" pop-up, auto-cancel of empty classes, and Meet
   recordings on the Recordings page (2026-11-18, classOutcome.service.ts).

     A. waiting: 30 min after the start, the class's own mentor only; not a
        cancelled / verified / old one; an admin has nothing; their next class
     B. "still going": asked again at the timetable end, then every 15 min
     C. "it ended": checked; class ended + verified + reviewed; once only;
        Google Meet's own end kept
     D. students' "rate your class" follows the mentor's earlier end
     E. auto-cancel: report mode notes only; on cancels and tells the mentor;
        never in person, a Program's, booked, made late, early, twice; off
     F. the Recordings page lists a class with a Drive recording link
   Run: bun --no-env-file src/tests/classoutcome.suite.ts
───────────────────────────────────────────────────────────── */
import nodePath from 'node:path'
import nodeOs from 'node:os'

process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_classoutcome'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.EMAIL_LOG_DIR = nodePath.join(nodeOs.tmpdir(), `lms-classoutcome-mail-${process.pid}`)
process.env.ADMIN_URL = 'https://admin.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'classoutcome-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'classoutcome-suite-refresh-secret-0123456789'
process.env.CLASS_OUTCOME_FROM = new Date(Date.now() - 5 * 864e5).toISOString()
delete process.env.AUTO_CANCEL_EMPTY

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
const { runAutoCancelEmpty, autoCancelMode, AUTO_CANCEL_REASON } = await import('@/services/classOutcome.service.ts')
const { runReviewRequestDispatch } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_classoutcome') { console.error('REFUSING TO RUN'); process.exit(1) }
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
const get = async (id: unknown) => (await M.LiveClassModel.findById(id).lean()) as any

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mentor = await M.UserModel.create({ name: 'MOIZ', email: 'moiz@co.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const other  = await M.UserModel.create({ name: 'OTHER', email: 'other@co.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  await M.UserModel.create({ name: 'Admin', email: 'admin@co.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const student = await M.UserModel.create({ name: 'Aisha', email: 'aisha@co.local', passwordHash: hash, role: 'student', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt-' + Date.now(), description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const mk = (title: string, startOffsetMs: number, extra: Record<string, unknown> = {}) => M.LiveClassModel.create({
    title, courseId: course._id, instructorId: mentor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + startOffsetMs), durationMins: 90, type: 'external', isOnline: true,
    status: 'scheduled', sessionCapacity: 30, bookedCount: 0, ...extra,
  })

  const mJar: Jar = new Map(), oJar: Jar = new Map(), aJar: Jar = new Map()
  for (const [jar, email] of [[mJar, 'moiz@co.local'], [oJar, 'other@co.local'], [aJar, 'admin@co.local']] as const) {
    const r = await call('POST', '/admin/auth/login', jar, { email, password: PW })
    check(`(${email} signs in)`, r.status === 200, why(r))
  }
  const pending = async (jar: Jar) => (await call('GET', '/admin/class-outcomes/pending', jar)).body?.data
  const ids = (d: any) => (d?.classes ?? []).map((c: any) => c.id) as string[]

  section('A · waiting for the mentor')
  const due      = await mk('Due — started 40 min ago', -40 * MIN)
  const early    = await mk('Started 20 min ago', -20 * MIN, { meetingUrl: 'https://meet.google.com/run-ning-now' })
  const othersC  = await mk("Another mentor's", -40 * MIN, { instructorId: other._id })
  const cancelled = await mk('Cancelled', -40 * MIN, { status: 'cancelled', cancelReason: 'x', cancelCause: 'admin' })
  const verified = await mk('Verified on the page', -3 * HOUR, { verifiedAt: new Date() })
  const old      = await mk('Before the pop-up existed', -6 * 864e5)
  const next     = await mk('Next class', 20 * MIN, { meetingUrl: 'https://meet.google.com/abc-defg-hij' })
  const p1 = await pending(mJar)
  check('a class 30+ min after its start is asked about', ids(p1).includes(String(due._id)), JSON.stringify(ids(p1)))
  check('not one started less than 30 min ago', !ids(p1).includes(String(early._id)))
  check("not another mentor's class", !ids(p1).includes(String(othersC._id)))
  check('not a cancelled one', !ids(p1).includes(String(cancelled._id)))
  check('not one already verified', !ids(p1).includes(String(verified._id)))
  check('not one from before CLASS_OUTCOME_FROM', !ids(p1).includes(String(old._id)))
  check('the class going on now comes along, with its Meet link', p1?.next?.id === String(early._id) && p1?.next?.meetingUrl === 'https://meet.google.com/run-ning-now', JSON.stringify(p1?.next))
  const o0 = await pending(oJar)
  check('(another mentor\'s next class is not theirs)', o0?.next?.id !== String(next._id))
  const a1 = await pending(aJar)
  check('an admin has nothing to answer', Array.isArray(a1?.classes) && a1.classes.length === 0, JSON.stringify(a1))
  const o1 = await pending(oJar)
  check("the other mentor sees only their own", ids(o1).includes(String(othersC._id)) && !ids(o1).includes(String(due._id)))
  const tooEarly = await call('POST', `/admin/class-outcomes/${early._id}`, mJar, { stillRunning: true })
  check('answering before 30 min is refused', tooEarly.status === 400, why(tooEarly))

  section('B · "still going"')
  const sr = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { stillRunning: true })
  const dueEnd = new Date(due.scheduledStart).getTime() + 90 * MIN
  check('saved: ask again at the timetable end', sr.status === 200 && Date.parse(sr.body?.data?.askAgainAt) === dueEnd, `${why(sr)} ${sr.body?.data?.askAgainAt}`)
  check('and it stops waiting until then', !ids(await pending(mJar)).includes(String(due._id)))
  await M.LiveClassModel.updateOne({ _id: due._id }, { $set: { scheduledStart: new Date(Date.now() - 100 * MIN), endAskAfter: new Date(Date.now() - MIN) } })
  check('once that time passes it is asked again', ids(await pending(mJar)).includes(String(due._id)))
  const sr2 = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { stillRunning: true })
  const in15 = Date.parse(sr2.body?.data?.askAgainAt) - Date.now()
  check('past the timetable end, "still going" asks again in 15 min', sr2.status === 200 && in15 > 14 * MIN && in15 <= 15 * MIN + 5000, `${why(sr2)} ${in15}`)
  await M.LiveClassModel.updateOne({ _id: due._id }, { $unset: { endAskAfter: '' } })

  section('C · "it ended"')
  const bad1 = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { topics: 'Pivot tables' })
  check('no rating: refused', bad1.status === 422, why(bad1))
  const bad2 = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { rating: 4, topics: 'x' })
  check('no topics: refused', bad2.status === 422, why(bad2))
  const bad3 = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { rating: 4, topics: 'Pivot tables', endedAt: new Date(Date.now() - 5 * HOUR).toISOString() })
  check('an end before the start: refused', bad3.status === 400 && bad3.body?.error?.code === 'INVALID_TIME', why(bad3))
  const theft = await call('POST', `/admin/class-outcomes/${due._id}`, oJar, { rating: 1, topics: 'Nothing at all' })
  check("another mentor cannot answer for it", theft.status === 404, why(theft))
  const endedAt = new Date(Date.now() - 10 * MIN)
  const ok = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { rating: 4, topics: 'Pivot tables', issues: 'Mic dropped once', summary: 'Good class', endedAt: endedAt.toISOString() })
  const after = await get(due._id)
  check('saved', ok.status === 200, why(ok))
  check('the class is ended, at the mentor\'s time, by the mentor', after.status === 'ended' && +new Date(after.endedAt) === +endedAt && after.endSource === 'mentor', `${after.status} ${after.endedAt} ${after.endSource}`)
  check('and verified, with the review', !!after.verifiedAt && String(after.verifiedBy) === String(mentor._id) && after.mentorReview?.rating === 4 && after.mentorReview?.topics === 'Pivot tables' && after.mentorReview?.issues === 'Mic dropped once')
  check('it no longer waits', !ids(await pending(mJar)).includes(String(due._id)))
  const again = await call('POST', `/admin/class-outcomes/${due._id}`, mJar, { rating: 5, topics: 'Twice' })
  check('answering twice: 409', again.status === 409, why(again))
  await new Promise(r => setTimeout(r, 300))
  check('audited', !!(await M.AuditLogModel.findOne({ action: 'class.outcome', entityId: String(due._id) }).lean()))

  const meetEnd = new Date(Date.now() - 20 * MIN)
  const byMeet = await mk('Ended by Google Meet', -2 * HOUR, { status: 'ended', endedAt: meetEnd, endSource: 'meet' })
  const okMeet = await call('POST', `/admin/class-outcomes/${byMeet._id}`, mJar, { rating: 5, topics: 'Dashboards', endedAt: new Date().toISOString() })
  const bm = await get(byMeet._id)
  check("Google Meet's end is kept; only the review is added", okMeet.status === 200 && +new Date(bm.endedAt) === +meetEnd && bm.endSource === 'meet' && bm.mentorReview?.rating === 5, `${why(okMeet)} ${bm.endedAt} ${bm.endSource}`)

  section("D · students' rating request follows the mentor's end")
  const short = await mk('Ended early by the mentor', -60 * MIN)   // timetable end: +30 min from now
  await M.ClassBookingModel.create({ userId: student._id, liveClassId: short._id, courseId: course._id, status: 'attended', organizationId: org._id } as any)
  await runReviewRequestDispatch()
  const before = await M.ClassBookingModel.findOne({ liveClassId: short._id }).lean() as any
  check('before the mentor answers: not asked yet (timetable end is ahead)', !before?.reviewRequestedAt)
  await call('POST', `/admin/class-outcomes/${short._id}`, mJar, { rating: 4, topics: 'Ended early', endedAt: new Date(Date.now() - 15 * MIN).toISOString() })
  await runReviewRequestDispatch()
  const afterB = await M.ClassBookingModel.findOne({ liveClassId: short._id }).lean() as any
  check('ended 15 min ago by the mentor: the student is asked now', !!afterB?.reviewRequestedAt)

  section('E · no bookings 10 minutes before the start')
  const longAgo = new Date(Date.now() - 2 * 864e5)
  const mkSoon = async (title: string, inMs: number, extra: Record<string, unknown> = {}, createdAt = longAgo) => {
    const c = await mk(title, inMs, extra)
    await M.LiveClassModel.collection.updateOne({ _id: c._id }, { $set: { createdAt } })
    return c
  }
  check('report is the default mode', autoCancelMode() === 'report')
  const empty1   = await mkSoon('Empty — report', 8 * MIN)
  const r1 = await runAutoCancelEmpty()
  const e1 = await get(empty1._id)
  check('report mode: noted, not cancelled', e1.status === 'scheduled' && e1.emptyWouldCancel === true && !!e1.emptyCheckedAt, `${e1.status} ${e1.emptyWouldCancel}`)
  check('and counted', r1.wouldCancel === 1 && r1.cancelled === 0, JSON.stringify(r1))

  process.env.AUTO_CANCEL_EMPTY = 'on'
  const told: string[] = []
  const notify = async (m: { email: string }, c: { title: string }) => { told.push(`${m.email}|${c.title}`) }
  const empty2   = await mkSoon('Empty — on', 9 * MIN)
  const offline  = await mkSoon('In person', 9 * MIN, { isOnline: false, location: 'Al Barsha' })
  const program  = await mkSoon("A Program's", 9 * MIN, { programId: new mongoose.Types.ObjectId() })
  const booked   = await mkSoon('Booked', 9 * MIN, { bookedCount: 1 })
  const ghost    = await mkSoon('Counter 0 but a seat exists', 9 * MIN)
  await M.ClassBookingModel.create({ userId: student._id, liveClassId: ghost._id, courseId: course._id, status: 'booked', organizationId: org._id } as any)
  const late     = await mkSoon('Made 5 min before', 9 * MIN, {}, new Date(Date.now() - 5 * MIN))
  const later    = await mkSoon('Starts in 20 min', 20 * MIN)
  const r2 = await runAutoCancelEmpty(new Date(), { notify })
  const e2 = await get(empty2._id)
  check('on: the empty online class is cancelled', e2.status === 'cancelled', e2.status)
  check('with the reason, "low booking" cause, by the system', e2.cancelReason === AUTO_CANCEL_REASON && e2.cancelCause === 'student' && /System/.test(e2.cancelledByName ?? ''), `${e2.cancelReason} ${e2.cancelCause} ${e2.cancelledByName}`)
  check('its mentor is told', told.includes(`moiz@co.local|Empty — on`), JSON.stringify(told))
  check('in person: left alone', (await get(offline._id)).status === 'scheduled')
  check("a Program's class: left alone", (await get(program._id)).status === 'scheduled')
  check('a booked class: left alone', (await get(booked._id)).status === 'scheduled')
  check('a seat on it (counter 0): left alone', (await get(ghost._id)).status === 'scheduled')
  check('made after bookings closed: left alone', (await get(late._id)).status === 'scheduled')
  check('starting in 20 min: not yet', (await get(later._id)).status === 'scheduled' && !(await get(later._id)).emptyCheckedAt)
  check('exactly one cancelled', r2.cancelled === 1, JSON.stringify(r2))
  const r3 = await runAutoCancelEmpty(new Date(), { notify })
  check('a second run does nothing again', r3.looked === 0 && r3.cancelled === 0 && told.length === 1, JSON.stringify(r3))
  check('the report-mode class is not cancelled later either (looked at once)', (await get(empty1._id)).status === 'scheduled')

  process.env.AUTO_CANCEL_EMPTY = 'off'
  const empty3 = await mkSoon('Empty — off', 9 * MIN)
  await runAutoCancelEmpty(new Date(), { notify })
  check('off: nothing happens', (await get(empty3._id)).status === 'scheduled' && !(await get(empty3._id)).emptyCheckedAt)
  delete process.env.AUTO_CANCEL_EMPTY

  section('F · the Recordings page')
  const rec = await mk('Recorded Meet class', -3 * HOUR, { status: 'ended', recordingUrl: 'https://drive.google.com/file/d/abc/view?usp=sharing' })
  const list = await call('GET', '/admin/recordings', aJar)
  const row = (list.body?.data ?? []).find((r: any) => r.id === String(rec._id))
  check('a class with a Drive recording link is listed', list.status === 200 && !!row, why(list))
  check('with its link to open', row?.recordingUrl === 'https://drive.google.com/file/d/abc/view?usp=sharing' && row?.cltRecordingId === null, JSON.stringify(row))
  check('a class without a recording is not', !(list.body?.data ?? []).some((r: any) => r.id === String(early._id)))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
  ;(await import('node:fs')).rmSync(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
