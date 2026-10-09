/* ─────────────────────────────────────────────────────────────
   Class join links — /j/<code> in the 5-minute and start-time reminders
   (services/joinLink.service.ts, POST /auth/join-link/redeem, the reminder jobs).

   Over HTTP, against a real database:
     A. redeeming with no session signs the student in, and the join that
        follows records the join and returns the meeting link;
     B. taps 2 and 3 with no session sign in too (3 sign-ins per link); a 4th
        signs nobody in, but still names the class;
     C. the student's own session: the class, nothing issued; another
        student's session: refused;
     D. unknown, or past its 2 hours: refused;
     E. before the room opens: the join says "too early" with the seconds to wait;
     F. the 5-minute job puts a fresh code in the email and in WhatsApp v2 —
        with the Meet code (?m=) for a Google Meet class, never another link's;
     I. the 30-second way straight in: the join recorded from the code, only
        where the ordinary join would have been allowed.
   Run: bun --no-env-file src/tests/joinlink.suite.ts
───────────────────────────────────────────────────────────── */
import nodePath from 'node:path'
import nodeOs from 'node:os'

process.env.DATABASE_URL = process.env.JOINLINK_DB_URL || 'mongodb://localhost:27017/lms_joinlink'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.EMAIL_LOG_DIR = nodePath.join(nodeOs.tmpdir(), `lms-joinlink-mail-${process.pid}`)
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CLIENT_URL = 'https://lms.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'joinlink-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'joinlink-suite-refresh-secret-0123456789'

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
const { mintJoinCode, hashJoinCode, JOIN_LINK_TTL_MS, meetCodeOf } = await import('@/services/joinLink.service.ts')
const { runFiveMinReminders } = await import('@/jobs/reminders.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinlink') { console.error('REFUSING TO RUN'); process.exit(1) }
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
const MIN = 60_000, PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const teacher = await M.UserModel.create({ name: 'T', email: 't@jl.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const mkStudent = async (tag: string) => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@jl.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
      enrollmentStatus: 'approved', organizationId: org._id, enrollmentApplication: { phone: '+971501234567' } })
    await M.EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active' })
    return u
  }
  const mkClass = (startsInMs: number) => M.LiveClassModel.create({
    title: 'MBT 1 · TEST', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + startsInMs), durationMins: 120, type: 'external',
    meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 1,
  })
  const priya = await mkStudent('priya'), ravi = await mkStudent('ravi')
  const live = await mkClass(-2 * MIN)
  await M.ClassBookingModel.create({ userId: priya._id, liveClassId: live._id, status: 'booked' })
  const code = await mintJoinCode(String(priya._id), String(live._id))

  section('A · no session: signs in, then the join records it and opens the meeting')
  const jar: Jar = new Map()
  const r1 = await call('POST', '/auth/join-link/redeem', { jar, body: { token: code } })
  check('redeemed', r1.status === 200 && r1.body?.data?.liveClassId === String(live._id), why(r1))
  check('and signed in (session cookies set)', r1.body?.data?.signedIn === true && jar.has('lms_at'), [...jar.keys()].join(','))
  const j1 = await call('POST', `/live-classes/${live._id}/join`, { jar })
  check('the join returns the meeting link', j1.status === 200 && j1.body?.data?.url === 'https://meet.google.com/abc-defg-hij', why(j1))
  await new Promise(r => setTimeout(r, 300))   // the join writes its attendance evidence without waiting on it
  const bk = await M.ClassBookingModel.findOne({ userId: priya._id, liveClassId: live._id }).lean() as any
  check('and records the join for attendance (attendedAt, source click)', !!bk?.attendedAt && bk?.attendanceSource === 'click',
    JSON.stringify({ s: bk?.status, a: bk?.attendedAt, src: bk?.attendanceSource }))

  section('B · up to 3 sign-ins per link, then the class only')
  /* Same phone (its device cookie), a browser with no session — e.g. the
     link first opened inside Gmail, then again in the real browser. */
  const sameDevice = (): Jar => new Map(jar.has('lms_device') ? [['lms_device', jar.get('lms_device')!]] : [])
  for (const n of [2, 3]) {
    const rn = await call('POST', '/auth/join-link/redeem', { jar: sameDevice(), body: { token: code } })
    check(`tap ${n}: signs in`, rn.status === 200 && rn.body?.data?.signedIn === true && rn.cookies.some(c => c.startsWith('lms_at=')), why(rn))
  }
  const r2 = await call('POST', '/auth/join-link/redeem', { jar: sameDevice(), body: { token: code } })
  check('tap 4: still names the class', r2.status === 200 && r2.body?.data?.liveClassId === String(live._id), why(r2))
  check('tap 4: but issues no session', r2.body?.data?.signedIn === false && !r2.cookies.some(c => c.startsWith('lms_at=')), r2.cookies.join(' | '))

  section("C · the student's own session, and somebody else's")
  const r3 = await call('POST', '/auth/join-link/redeem', { jar, body: { token: code } })
  check('own session: the class, nothing issued', r3.status === 200 && r3.body?.data?.signedIn === false, why(r3))
  const raviJar: Jar = new Map(jar.has('lms_device') ? [['lms_device', jar.get('lms_device')!]] : [])
  const login = await call('POST', '/auth/login', { jar: raviJar, body: { email: 'ravi@jl.local', password: PW, remember: true } })
  check('(another student signs in)', login.status === 200, why(login))
  const r4 = await call('POST', '/auth/join-link/redeem', { jar: raviJar, body: { token: await mintJoinCode(String(priya._id), String(live._id)) } })
  check("another student's session: refused", r4.status === 403 && r4.body?.error?.code === 'JOIN_LINK_OTHER_ACCOUNT', why(r4))

  section('D · unknown, or past its 2 hours')
  const r5 = await call('POST', '/auth/join-link/redeem', { jar: new Map(), body: { token: 'not-a-real-join-code-xyz' } })
  check('unknown: refused', r5.status === 400 && r5.body?.error?.code === 'JOIN_LINK_EXPIRED', why(r5))
  const old = await mintJoinCode(String(priya._id), String(live._id), Date.now() - JOIN_LINK_TTL_MS - MIN)
  const r6 = await call('POST', '/auth/join-link/redeem', { jar: new Map(), body: { token: old } })
  check('older than 2 hours: refused', r6.status === 400 && r6.body?.error?.code === 'JOIN_LINK_EXPIRED', why(r6))
  const stored = await M.AuthTokenModel.findOne({ tokenHash: hashJoinCode(code) }).lean() as any
  check('only the hash is stored, never the code', !!stored && !JSON.stringify(stored).includes(code))

  section('E · before the room opens')
  const later = await mkClass(10 * MIN)
  await M.ClassBookingModel.create({ userId: priya._id, liveClassId: later._id, status: 'booked' })
  const early = await call('POST', '/auth/join-link/redeem', { jar, body: { token: await mintJoinCode(String(priya._id), String(later._id)) } })
  const j2 = await call('POST', `/live-classes/${later._id}/join`, { jar })
  check('redeemed', early.status === 200, why(early))
  check('the join says too early, with the seconds to wait', j2.status === 425 && (j2.body?.error?.retryAfter ?? 0) > 0, why(j2))

  section('F · the 5-minute job: a fresh code in the email and in WhatsApp v2')
  const soon = await mkClass(5 * MIN)
  await M.ClassBookingModel.create({ userId: priya._id, liveClassId: soon._id, status: 'booked' })
  const before = await M.AuthTokenModel.countDocuments({ purpose: 'join-link', liveClassId: soon._id })
  await runFiveMinReminders()
  await new Promise(r => setTimeout(r, 400))
  check('one code made for the booking', await M.AuthTokenModel.countDocuments({ purpose: 'join-link', liveClassId: soon._id }) === before + 1)
  const wa = await M.WhatsAppOutboxModel.findOne({ templateName: 'class_starts_in_5_min_v2' }).lean() as any
  check('WhatsApp v2 sent, its button the code with the Meet code', !!wa && typeof wa.buttonParam === 'string' && wa.buttonParam.length >= 20 && !wa.buttonParam.includes('/')
    && wa.buttonParam.endsWith('?m=abc-defg-hij'), JSON.stringify(wa?.buttonParam))
  const fs = await import('node:fs')
  const mails = fs.existsSync(process.env.EMAIL_LOG_DIR!) ? fs.readdirSync(process.env.EMAIL_LOG_DIR!).map(f => fs.readFileSync(nodePath.join(process.env.EMAIL_LOG_DIR!, f), 'utf8')) : []
  check('the email Join button is the same join link', !!wa && mails.some(m => m.includes(`https://lms.example.test/j/${wa.buttonParam}`)), `${mails.length} mails`)

  section('G · the answer was lost: tapping again signs the student in again')
  {
    const anil = await mkStudent('anil')
    const cls = await mkClass(-2 * MIN)
    await M.ClassBookingModel.create({ userId: anil._id, liveClassId: cls._id, status: 'booked' })
    const c = await mintJoinCode(String(anil._id), String(cls._id))
    const first: Jar = new Map()
    const g1 = await call('POST', '/auth/join-link/redeem', { jar: first, body: { token: c } })
    check('first tap signs in', g1.body?.data?.signedIn === true, why(g1))
    /* The browser kept only its device cookie — the session cookies never arrived. */
    const lost: Jar = new Map([['lms_device', first.get('lms_device')!]])
    const g2 = await call('POST', '/auth/join-link/redeem', { jar: lost, body: { token: c } })
    check('the same browser retrying is signed in again', g2.status === 200 && g2.body?.data?.signedIn === true && lost.has('lms_at'), why(g2))
    const gj = await call('POST', `/live-classes/${cls._id}/join`, { jar: lost })
    check('and the join then opens the meeting', gj.status === 200 && !!gj.body?.data?.url, why(gj))
  }

  section('H · a laptop waiting for device approval does not burn the link')
  {
    const alwin = await mkStudent('alwin')
    const phone: Jar = new Map()
    const pl = await call('POST', '/auth/login', { jar: phone, body: { email: 'alwin@jl.local', password: PW } })
    check('(signed up and signed in on a phone — device 1, approved)', pl.status === 200, why(pl))
    const cls = await mkClass(-2 * MIN)
    await M.ClassBookingModel.create({ userId: alwin._id, liveClassId: cls._id, status: 'booked' })
    const c = await mintJoinCode(String(alwin._id), String(cls._id))
    const laptop: Jar = new Map()
    const h1 = await call('POST', '/auth/join-link/redeem', { jar: laptop, body: { token: c } })
    check('the laptop is refused while its approval is pending', h1.status === 403 && h1.body?.error?.code === 'DEVICE_PENDING', why(h1))
    const tok = await M.AuthTokenModel.findOne({ tokenHash: hashJoinCode(c) }).lean() as any
    check('and no sign-in is spent by that refusal', !tok?.useCount && !tok?.usedAt, `useCount=${tok?.useCount}`)
    await M.DeviceModel.updateOne({ userId: alwin._id, deviceId: laptop.get('lms_device') }, { $set: { status: 'approved', approvedAt: new Date() } })
    const h2 = await call('POST', '/auth/join-link/redeem', { jar: laptop, body: { token: c } })
    check('once approved, the SAME link signs the laptop in', h2.status === 200 && h2.body?.data?.signedIn === true, why(h2))
    const hj = await call('POST', `/live-classes/${cls._id}/join`, { jar: laptop })
    check('and opens the class', hj.status === 200 && !!hj.body?.data?.url, why(hj))
  }

  check('only a Google Meet link gives a code', meetCodeOf('https://meet.google.com/ABC-defg-hij?authuser=0') === 'abc-defg-hij'
    && meetCodeOf('https://zoom.us/j/123456789?pwd=x') === null && meetCodeOf('https://meet.google.com/lookup/abc') === null && meetCodeOf(undefined) === null)

  section('I · the 30-second way straight in: the join recorded from the code')
  const now2 = await mkClass(-1 * MIN)
  await M.ClassBookingModel.create({ userId: ravi._id, liveClassId: now2._id, status: 'booked' })
  const fb = await call('POST', '/auth/join-link/fallback', { body: { token: await mintJoinCode(String(ravi._id), String(now2._id)) } })
  const rb = await M.ClassBookingModel.findOne({ userId: ravi._id, liveClassId: now2._id }).lean() as any
  check('no session needed: recorded, attended by click', fb.status === 200 && fb.body?.data?.recorded === true && !!rb?.attendedAt && rb?.attendanceSource === 'click', why(fb))
  check('...and no session is issued', !fb.cookies.some(c => c.startsWith('lms_at=')), fb.cookies.join(' | '))
  const unknownFb = await call('POST', '/auth/join-link/fallback', { body: { token: 'not-a-real-code-at-all' } })
  check('an unknown code: nothing recorded, no error', unknownFb.status === 200 && unknownFb.body?.data?.recorded === false, why(unknownFb))
  const early2 = await mkClass(20 * MIN)
  await M.ClassBookingModel.create({ userId: ravi._id, liveClassId: early2._id, status: 'booked' })
  const fbEarly = await call('POST', '/auth/join-link/fallback', { body: { token: await mintJoinCode(String(ravi._id), String(early2._id)) } })
  const rbEarly = await M.ClassBookingModel.findOne({ userId: ravi._id, liveClassId: early2._id }).lean() as any
  check('before the room opens: not recorded', fbEarly.body?.data?.recorded === false && !rbEarly?.attendedAt, why(fbEarly))
  const noSeat = await mkClass(-1 * MIN)
  const fbNoSeat = await call('POST', '/auth/join-link/fallback', { body: { token: await mintJoinCode(String(ravi._id), String(noSeat._id)) } })
  check('no seat booked: not recorded', fbNoSeat.body?.data?.recorded === false, why(fbNoSeat))
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
