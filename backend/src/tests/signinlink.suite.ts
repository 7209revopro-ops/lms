/* ─────────────────────────────────────────────────────────────
   Sign-in links and the two student WhatsApp messages that carry them —
   new_class_scheduled_v1 and todays_classes_v1 (signinLink.service.ts,
   POST /auth/signin-link/redeem, liveClass.service, classImport.service,
   runTodaysClassesWhatsApp).

   Over HTTP, against a real database:
     A. redeeming with no session signs the student in and names the page;
     B. a second tap with no session signs nobody in, but still names the page;
     C. the student's own session: the page, nothing issued; another
        student's session: refused;
     D. unknown, or past its 24 hours: refused; a foreign page is never kept;
     E. a class created on the form: WhatsApp to enrolled students whose
        module is open — not to one blocked from it, not without a phone;
     F. an import: ONE WhatsApp per student per course, counting only the
        classes whose module is open to them; done once;
     G. the 8 AM job: one message per student listing today's booked classes,
        only that academy's students, never twice.
   Run: bun --no-env-file src/tests/signinlink.suite.ts
───────────────────────────────────────────────────────────── */
import nodePath from 'node:path'
import nodeOs from 'node:os'

process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_signinlink'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.EMAIL_LOG_DIR = nodePath.join(nodeOs.tmpdir(), `lms-signinlink-mail-${process.pid}`)
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CLIENT_URL = 'https://lms.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'signinlink-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'signinlink-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { mintSigninCode, hashSigninCode, safeNextPath, SIGNIN_LINK_TTL_MS } = await import('@/services/signinLink.service.ts')
const { runTodaysClassesWhatsApp } = await import('@/jobs/reminders.job.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')
const { ClassImportService } = await import('@/services/classImport.service.ts')
const { zoneDateKey, zoneMidnight } = await import('@/utils/zoneDay.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_signinlink') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body, cookies: res.headers.getSetCookie?.() ?? [] }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const MIN = 60_000, HOUR = 60 * MIN, PW = 'CorrectHorse1'
const outbox = (name: string) => M.WhatsAppOutboxModel.find({ templateName: name }).lean() as Promise<any[]>
const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const teacher = await M.UserModel.create({ name: 'T', email: 't@sl.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'MBT Course', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const modA = await M.SectionModel.create({ courseId: course._id, title: 'MBT 1', order: 1 })
  const modB = await M.SectionModel.create({ courseId: course._id, title: 'MBT 2', order: 2 })
  const mkStudent = async (tag: string, o: { phone?: string; blocked?: unknown[]; orgId?: unknown; phoneDigits?: string } = {}) => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@sl.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
      enrollmentStatus: 'approved', organizationId: o.orgId ?? org._id, ...(o.phone ? { enrollmentApplication: { phone: o.phone } } : {}) })
    await M.EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', blockedLessons: o.blocked ?? [] })
    return u
  }
  const priya = await mkStudent('priya', { phone: '+971501111111' })
  const ravi  = await mkStudent('ravi',  { phone: '+971502222222', blocked: [modB._id] })
  const nophone = await mkStudent('nophone')
  const anil  = await mkStudent('anil',  { phone: '+919526288116', orgId: blr._id })

  /* ── A–D: redeeming ── */
  section('A · no session: signs in, names the page')
  const code = await mintSigninCode(String(priya._id), '/class-bookings')
  const jarA: Jar = new Map()
  const a = await call('POST', '/auth/signin-link/redeem', { jar: jarA, body: { token: code } })
  check('200', a.status === 200, why(a))
  check('signed in, next = /class-bookings', a.body?.data?.signedIn === true && a.body?.data?.next === '/class-bookings', JSON.stringify(a.body?.data))
  check('session cookie set', jarA.has('lms_at'), [...jarA.keys()].join(','))
  const me = await call('GET', '/auth/me', { jar: jarA })
  check('that session is priya', String(me.body?.data?.id ?? me.body?.data?._id ?? me.body?.data?.user?.id ?? '') === String(priya._id), why(me))

  section('B · a second tap with no session: nobody signed in, page still named')
  const jarB: Jar = new Map()
  const b = await call('POST', '/auth/signin-link/redeem', { jar: jarB, body: { token: code } })
  check('200, signedIn false, next kept', b.status === 200 && b.body?.data?.signedIn === false && b.body?.data?.next === '/class-bookings', why(b) + JSON.stringify(b.body?.data))
  check('no session cookie', !jarB.has('lms_at'))

  section("C · own session: the page; another student's: refused")
  const own = await call('POST', '/auth/signin-link/redeem', { jar: jarA, body: { token: code } })
  check('own session → 200, next', own.status === 200 && own.body?.data?.next === '/class-bookings', why(own))
  const raviJar: Jar = new Map()
  const login = await call('POST', '/auth/login', { jar: raviJar, body: { email: 'ravi@sl.local', password: PW } })
  check('ravi signed in (setup)', login.status === 200 && raviJar.has('lms_at'), why(login))
  const fresh = await mintSigninCode(String(priya._id), '/my-bookings')
  const other = await call('POST', '/auth/signin-link/redeem', { jar: raviJar, body: { token: fresh } })
  check("another student's session → 403 SIGNIN_LINK_OTHER_ACCOUNT", other.status === 403 && other.body?.error?.code === 'SIGNIN_LINK_OTHER_ACCOUNT', why(other))

  section('D · unknown or expired: refused; foreign pages never kept')
  const unknown = await call('POST', '/auth/signin-link/redeem', { jar: new Map(), body: { token: 'nope-nope-nope-nope-nope' } })
  check('unknown → 400 SIGNIN_LINK_EXPIRED', unknown.status === 400 && unknown.body?.error?.code === 'SIGNIN_LINK_EXPIRED', why(unknown))
  const old = await mintSigninCode(String(priya._id), '/my-bookings', Date.now() - SIGNIN_LINK_TTL_MS - MIN)
  const expired = await call('POST', '/auth/signin-link/redeem', { jar: new Map(), body: { token: old } })
  check('past 24 h → 400', expired.status === 400 && expired.body?.error?.code === 'SIGNIN_LINK_EXPIRED', why(expired))
  check('//evil.com → /my-bookings', safeNextPath('//evil.com') === '/my-bookings')
  check('https://evil.com → /my-bookings', safeNextPath('https://evil.com') === '/my-bookings')
  check('only the hash is stored', !!(await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(code) }).lean()) && !(await M.AuthTokenModel.findOne({ tokenHash: code }).lean()))

  /* ── E: a class created on the form ── */
  section('E · new class on the form: WhatsApp to students whose module is open')
  await M.WhatsAppOutboxModel.deleteMany({})
  await new LiveClassService().create({
    courseId: String(course._id), instructorId: String(teacher._id), title: 'MBT 2 · Breakouts',
    scheduledStart: new Date(Date.now() + 2 * 24 * HOUR), durationMins: 120, type: 'external',
    meetingUrl: 'https://meet.google.com/abc-defg-hij', sectionId: String(modB._id), isOnline: true,
    organizationId: String(org._id),
  } as any)
  let sent: any[] = []
  for (let i = 0; i < 30 && sent.length < 2; i++) { await settle(100); sent = await outbox('new_class_scheduled_v1') }
  await settle(300); sent = await outbox('new_class_scheduled_v1')
  const to = sent.map(s => s.to)
  check('priya (open, phone) got it', to.some(t => t.endsWith('501111111')), JSON.stringify(to))
  check('anil (another academy, open) got it', to.some(t => t.endsWith('9526288116')), JSON.stringify(to))
  check('ravi (MBT 2 blocked) did not', !to.some(t => t.endsWith('502222222')), JSON.stringify(to))
  check('exactly two messages (no phone → none)', sent.length === 2, String(sent.length))
  const p0 = sent.find(s => s.to.endsWith('501111111'))
  check('params: name, course, class, day, time', p0?.params?.[0] === 'priya' && p0?.params?.[1] === 'MBT Course' && p0?.params?.[2] === 'MBT 2 · Breakouts' && /^\w{3}, \d{1,2} \w{3}$/.test(p0?.params?.[3]) && /GST$/.test(p0?.params?.[4]), JSON.stringify(p0?.params))
  const codeE = p0?.buttonParam as string
  check('button = a sign-in code for /class-bookings', !!codeE && (await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(codeE), purpose: 'signin-link' }).lean() as any)?.nextPath === '/class-bookings')
  void nophone

  /* ── F: an import ── */
  section('F · import: one WhatsApp per student per course, open modules only')
  await M.WhatsAppOutboxModel.deleteMany({})
  const mkItem = (title: string, inDays: number, sectionId: unknown, status = 'created') => ({
    sessionId: title, seriesId: new mongoose.Types.ObjectId(), dateKey: `k${inDays}`, scheduledStart: new Date(Date.now() + inDays * 24 * HOUR),
    durationMins: 60, title, instructorId: teacher._id, platform: 'meet', importRef: `${title}:${inDays}`, courseId: course._id, sectionId, status,
  })
  const job = await M.ClassImportModel.create({
    createdBy: teacher._id, actor: { id: String(teacher._id), role: 'admin' }, organizationId: org._id, courseId: course._id,
    settings: { startDate: '2026-10-10', weeks: 2, capacity: 30, language: 'English', defaultPlatform: 'meet' }, status: 'completed',
    total: 4, created: 3, skipped: 0, failed: 0,
    items: [mkItem('MBT 1 · A', 3, modA._id), mkItem('MBT 2 · B', 4, modB._id), mkItem('MBT 1 · C', 10, modA._id), mkItem('Past', -1, modA._id)],
  } as any)
  await (new ClassImportService() as any).notifyStudents(job)
  sent = await outbox('new_class_scheduled_v1')
  const pf = sent.filter(s => s.to.endsWith('501111111')), rf = sent.filter(s => s.to.endsWith('502222222'))
  check('priya: one message', pf.length === 1, String(pf.length))
  check('priya: "MBT 1 · A + 2 more classes"', pf[0]?.params?.[2] === 'MBT 1 · A + 2 more classes', JSON.stringify(pf[0]?.params))
  check('ravi (MBT 2 blocked): one message, "+ 1 more class"', rf.length === 1 && rf[0]?.params?.[2] === 'MBT 1 · A + 1 more class', JSON.stringify(rf.map(r => r.params)))
  check('three messages in all (priya, ravi, anil)', sent.length === 3, String(sent.length))
  const digest = await M.DigestQueueModel.find({ userId: priya._id, kind: 'new-session', title: /3 new sessions/ }).lean()
  check('priya: one digest line "3 new sessions"', digest.length === 1, String(digest.length))
  check('studentsNotifiedAt stamped', !!(await M.ClassImportModel.findById(job._id).lean() as any)?.studentsNotifiedAt)

  /* ── G: the 8 AM job ── */
  section("G · today's classes at 8 AM: one per student, that academy only, never twice")
  await M.WhatsAppOutboxModel.deleteMany({})
  const eight = new Date(zoneMidnight(zoneDateKey(new Date(), 'Asia/Dubai'), 'Asia/Dubai').getTime() + 8 * HOUR)
  const mkClass = (title: string, at: Date) => M.LiveClassModel.create({
    title, courseId: course._id, instructorId: teacher._id, organizationId: org._id, scheduledStart: at, durationMins: 60, type: 'external',
    meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 1,
  })
  const c1 = await mkClass('MBT 1 · Morning', new Date(eight.getTime() + 2 * HOUR))
  const c2 = await mkClass('IM 3 · Evening', new Date(eight.getTime() + 8 * HOUR))
  const tomorrow = await mkClass('Tomorrow', new Date(eight.getTime() + 26 * HOUR))
  for (const c of [c2, c1, tomorrow]) await M.ClassBookingModel.create({ userId: priya._id, liveClassId: c._id, status: 'booked' })
  await M.ClassBookingModel.create({ userId: anil._id, liveClassId: c1._id, status: 'booked' })
  await runTodaysClassesWhatsApp('dubai', eight)
  sent = await outbox('todays_classes_v1')
  check('one message, to priya', sent.length === 1 && sent[0].to.endsWith('501111111'), JSON.stringify(sent.map(s => s.to)))
  check('the list: time-ordered, " · ", zone tag; tomorrow left out', sent[0]?.params?.[1] === '10:00 AM MBT 1 · Morning · 04:00 PM IM 3 · Evening (GST)', JSON.stringify(sent[0]?.params))
  const codeG = sent[0]?.buttonParam as string
  check('button = a sign-in code for /my-bookings', !!codeG && (await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(codeG) }).lean() as any)?.nextPath === '/my-bookings')
  await runTodaysClassesWhatsApp('dubai', eight)
  check('a re-run sends nothing', (await outbox('todays_classes_v1')).length === 1)
  await runTodaysClassesWhatsApp('bangalore', new Date(eight.getTime() - 90 * MIN))
  sent = await outbox('todays_classes_v1')
  const an = sent.find(s => s.to.endsWith('9526288116'))
  check('bangalore run: anil, in IST', !!an && an.params?.[1] === '11:30 AM MBT 1 · Morning (IST)', JSON.stringify(an?.params))
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
  ;(await import('node:fs')).rmSync(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
