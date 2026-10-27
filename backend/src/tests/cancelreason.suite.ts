/* ─────────────────────────────────────────────────────────────
   Why a class was cancelled (2026-10-27).
     Cancelling through PATCH /admin/live-classes/:id needs a reason; it is
     stored with who cancelled and when, written to the audit trail, and shown
     to students — the bell (booked and enrolled), the cancellation email,
     My Bookings and the class page. Re-saving a cancelled class asks nothing.
   Run: bun --no-env-file src/tests/cancelreason.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_cancelreason_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-cancelreason'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'cancelreason-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'cancelreason-refresh-secret-0123456789'
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_cancelreason_suite') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const raw of res.headers.getSetCookie?.() ?? []) { const [pair] = raw.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  const text = await res.text(); let parsed: any = text; try { parsed = JSON.parse(text) } catch {}
  return { status: res.status, body: parsed }
}
async function waitFor(fn: () => Promise<number>, want: number) {
  let last = 0
  for (let i = 0; i < 50; i++) { last = await fn(); if (last >= want) return last; await new Promise(r => setTimeout(r, 120)) }
  return last
}

const PW = 'CancelWhy123'
const REASON = 'Mentor is unwell — a replacement class will be scheduled'
try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const admin = await M.UserModel.create({ name: 'Ops Lead', email: 'ops@cr.local', passwordHash: hash, role: 'admin', isActive: true, isVerified: true, organizationId: org._id })
  const teacher = await M.UserModel.create({ name: 'Teach', email: 't@cr.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'Forex', slug: 'forex-cr', description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const booked = await M.UserModel.create({ name: 'Booked Bee', email: 'b@cr.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id })
  const enrolled = await M.UserModel.create({ name: 'Enrolled Eve', email: 'e@cr.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id })
  for (const u of [booked, enrolled]) await M.EnrollmentModel.create({ userId: u._id, courseId: course._id })
  /* Starts in 5 minutes, so the cancellation mail goes from the request (urgent). */
  const lc = await M.LiveClassModel.create({
    title: 'Risk Session', courseId: course._id, instructorId: teacher._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + 5 * 60_000), durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
    language: 'English', sessionCapacity: 30, bookedCount: 1, meetingUrl: 'https://meet.google.com/abc-defg-hij',
  })
  await M.ClassBookingModel.create({ userId: booked._id, liveClassId: lc._id, status: 'booked', bookedAt: new Date() })

  const adminJar: Jar = new Map()
  check('setup: the admin signs in', (await call('POST', '/admin/auth/login', adminJar, { email: admin.email, password: PW })).status === 200)
  const studentJar: Jar = new Map()
  check('setup: the booked student signs in', (await call('POST', '/auth/login', studentJar, { email: booked.email, password: PW })).status === 200)

  const noWhy = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled' })
  check('cancelling without a reason is refused', noWhy.status === 400 && noWhy.body?.error?.code === 'CANCEL_REASON_REQUIRED', `${noWhy.status} ${JSON.stringify(noWhy.body?.error)}`)
  const blank = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled', cancelReason: '  ' })
  check('...and so is a blank one', blank.status === 400, String(blank.status))
  check('...the class is still scheduled', (await M.LiveClassModel.findById(lc._id).lean())?.status === 'scheduled')

  const ok = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled', cancelReason: `  ${REASON} ` })
  check('cancelling with a reason is accepted', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body?.error)}`)
  const row = await M.LiveClassModel.findById(lc._id).lean() as any
  check('the reason is stored, trimmed', row?.cancelReason === REASON, row?.cancelReason)
  check('...with who cancelled', String(row?.cancelledBy) === String(admin._id) && row?.cancelledByName === 'Ops Lead', `${row?.cancelledBy} ${row?.cancelledByName}`)
  check('...and when', row?.cancelledAt && Math.abs(Date.now() - new Date(row.cancelledAt).getTime()) < 60_000)
  check('the admin response carries reason, name and time', ok.body?.data?.cancelReason === REASON && ok.body?.data?.cancelledByName === 'Ops Lead' && !!ok.body?.data?.cancelledAt)

  const audited = await waitFor(() => M.AuditLogModel.countDocuments({ action: 'liveclass.update', entityId: String(lc._id), 'meta.cancelled': true, 'meta.reason': { $regex: 'Mentor is unwell' } }), 1)
  check('the audit trail records the cancellation and its reason', audited === 1, String(audited))

  const bell = async (u: any) => (await M.NotificationModel.find({ userId: u._id, title: /Class cancelled/ }).lean()).map((n: any) => n.body as string)
  await waitFor(async () => (await bell(booked)).length + (await bell(enrolled)).length, 2)
  check('the booked student\'s notice gives the reason', (await bell(booked)).some(b => b.includes(`Reason: ${REASON}`)), JSON.stringify(await bell(booked)))
  check('the enrolled student\'s notice gives it too', (await bell(enrolled)).some(b => b.includes(`Reason: ${REASON}`)), JSON.stringify(await bell(enrolled)))

  const mailN = await waitFor(() => M.EmailOutboxModel.countDocuments({ to: booked.email }), 1)
  const mail = await M.EmailOutboxModel.findOne({ to: booked.email }).lean() as any
  check('the cancellation email is sent', mailN >= 1 && /Cancellation/.test(mail?.subject ?? ''), mail?.subject)
  check('...and states the reason (HTML and text)', mail?.html?.includes('Reason:') && mail?.html?.includes('Mentor is unwell') && mail?.text?.includes(`Reason: ${REASON}`))

  const mine = await call('GET', '/bookings/me', studentJar)
  const seatRow = (mine.body?.data ?? []).find((b: any) => String(b.liveClassId?._id ?? b.liveClassId?.id) === String(lc._id))
  check('My Bookings shows the student the reason', seatRow?.liveClassId?.cancelReason === REASON, JSON.stringify(seatRow?.liveClassId?.cancelReason))
  const watch = await call('GET', `/live-classes/${lc._id}/watch`, studentJar)
  check('the class page says it was cancelled, with the reason', watch.status === 410 && String(watch.body?.error?.message).includes(`Reason: ${REASON}`), `${watch.status} ${watch.body?.error?.message}`)

  const resave = await call('PATCH', `/admin/live-classes/${lc._id}`, adminJar, { status: 'cancelled', title: 'Risk Session (old)' })
  check('re-saving an already cancelled class needs no reason', resave.status === 200, `${resave.status} ${JSON.stringify(resave.body?.error)}`)
  check('...and keeps the original one', (await M.LiveClassModel.findById(lc._id).lean() as any)?.cancelReason === REASON)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
  try { (await import('fs/promises')).rm('.logs/emails-cancelreason', { recursive: true, force: true }) } catch {}
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
