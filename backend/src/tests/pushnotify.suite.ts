/* ─────────────────────────────────────────────────────────────
   Phone / desktop notifications (Web Push, 2026-10-21).
     A  subscribe: the key; a device saved once per endpoint; junk refused; unsubscribe
     B  every bell notification is pushed — to the user's own devices only, with an absolute link
     C  a device the push service reports gone (410) is deleted; no keys → no push, the bell still made
     D  1 minute before a class: bell + push to the booked students only, once
     E  the morning: ONE "your classes today" per student, instead of a bell per class
   The push services are never called — a stub records what would be sent.
   Run: bun --no-env-file src/tests/pushnotify.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_pushnotify'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'pushnotify-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'pushnotify-refresh-secret-0123456789abcdef'
process.env.CLIENT_URL = 'https://lms.test'
/* A real-format VAPID pair, made for this test only. */
process.env.VAPID_PUBLIC_KEY  = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
process.env.VAPID_PRIVATE_KEY = 'tUxbf-Mm2_GJbZ2-yBV6QtIy7v6-cM9pfDnF2PIu8Q0'
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
const P = await import('@/services/push.service.ts')
const { NotificationService } = await import('@/services/notification.service.ts')
const R = await import('@/jobs/reminders.job.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_pushnotify') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.PushSubscriptionModel.syncIndexes()
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
const settle = (ms = 250) => new Promise(r => setTimeout(r, ms))

/* What would have gone to the push services. */
const sent: Array<{ endpoint: string; data: any }> = []
let failWith: number | null = null
P.__setPushSender(async (sub, data) => {
  if (failWith) { const e: any = new Error('gone'); e.statusCode = failWith; throw e }
  sent.push({ endpoint: sub.endpoint, data: JSON.parse(data) })
})
const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `p256dh-key-${n}`, auth: `auth-${n}` } })

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword('CorrectHorse1')
  const mk = (email: string) => M.UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role: 'student', isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved' })
  const amy = await mk('amy@push.local'), ben = await mk('ben@push.local'), cara = await mk('cara@push.local')
  const login = async (email: string) => { const j: Jar = new Map(); const x = await call('POST', '/auth/login', j, { email, password: 'CorrectHorse1' }); if (x.status !== 200) throw new Error(`${email} ${why(x)}`); return j }
  const aj = await login('amy@push.local'), bj = await login('ben@push.local')

  section('A · subscribe')
  const key = await call('GET', '/notifications/push/key', aj)
  check('the public key', key.body?.data?.publicKey === process.env.VAPID_PUBLIC_KEY, why(key))
  check('signed out: no key', (await call('GET', '/notifications/push/key', null)).status === 401)
  check('a device subscribes', (await call('POST', '/notifications/push/subscribe', aj, { subscription: sub(1) })).status === 200)
  await call('POST', '/notifications/push/subscribe', aj, { subscription: sub(1) })
  check('...the same device twice: one row', await M.PushSubscriptionModel.countDocuments({ endpoint: sub(1).endpoint }) === 1)
  await call('POST', '/notifications/push/subscribe', aj, { subscription: sub(2) })
  check('a second device: two rows', await M.PushSubscriptionModel.countDocuments({ userId: amy._id }) === 2)
  check('a non-https endpoint is refused', (await call('POST', '/notifications/push/subscribe', aj, { subscription: { ...sub(3), endpoint: 'http://evil.local/x' } })).status === 400)
  check('no keys is refused', (await call('POST', '/notifications/push/subscribe', aj, { subscription: { endpoint: sub(4).endpoint } })).status === 400)
  await call('POST', '/notifications/push/subscribe', bj, { subscription: sub(5) })
  await call('POST', '/notifications/push/unsubscribe', aj, { endpoint: sub(5).endpoint })
  check("someone else's device cannot be unsubscribed", await M.PushSubscriptionModel.countDocuments({ endpoint: sub(5).endpoint }) === 1)
  await call('POST', '/notifications/push/unsubscribe', bj, { endpoint: sub(5).endpoint })
  check('your own device is', await M.PushSubscriptionModel.countDocuments({ endpoint: sub(5).endpoint }) === 0)

  section('B · every bell notification is pushed')
  sent.length = 0
  await new NotificationService().create(String(amy._id), { kind: 'live-class-scheduled', title: 'Live class scheduled in MBT', body: 'MBT 3 on Tue', link: '/class-bookings?view=sessions' })
  await settle()
  check('to both of Amy\'s devices', sent.length === 2 && new Set(sent.map(s => s.endpoint)).size === 2, JSON.stringify(sent))
  check('...title, body and an absolute link', sent[0]?.data.title === 'Live class scheduled in MBT' && sent[0]?.data.body === 'MBT 3 on Tue' && sent[0]?.data.url === 'https://lms.test/class-bookings?view=sessions', JSON.stringify(sent[0]?.data))
  sent.length = 0
  await new NotificationService().create(String(cara._id), { kind: 'system', title: 'x' })
  await settle()
  check('no devices: nothing pushed, the bell is still made', sent.length === 0 && await M.NotificationModel.countDocuments({ userId: cara._id }) === 1)

  section('C · gone devices; push off')
  failWith = 410
  const r = await P.pushToUser(String(amy._id), { title: 't' })
  check('410 from the push service: the device is deleted', r.removed === 2 && await M.PushSubscriptionModel.countDocuments({ userId: amy._id }) === 0, JSON.stringify(r))
  failWith = null
  await call('POST', '/notifications/push/subscribe', aj, { subscription: sub(1) })
  const savedKey = process.env.VAPID_PRIVATE_KEY
  delete process.env.VAPID_PRIVATE_KEY; P.__setPushSender(null)
  sent.length = 0
  const off = await P.pushToUser(String(amy._id), { title: 't' })
  check('no VAPID keys: push is off, quietly', off.sent === 0 && sent.length === 0)
  process.env.VAPID_PRIVATE_KEY = savedKey
  P.__setPushSender(async (s, data) => { sent.push({ endpoint: s.endpoint, data: JSON.parse(data) }) })

  section('D · 1 minute before')
  const teacher = await M.UserModel.create({ name: 'Mentor', email: 'm@push.local', role: 'instructor', isActive: true, organizationId: org._id })
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt', description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const now = new Date()
  const soon = await M.LiveClassModel.create({ courseId: course._id, instructorId: teacher._id, title: 'MBT 3', scheduledStart: new Date(now.getTime() + 70_000), durationMins: 60, type: 'external', status: 'scheduled', organizationId: org._id, meetingUrl: 'https://meet.google.com/abc-defg-hij' })
  const later = await M.LiveClassModel.create({ courseId: course._id, instructorId: teacher._id, title: 'MBT 4', scheduledStart: new Date(now.getTime() + 20 * 60_000), durationMins: 60, type: 'external', status: 'scheduled', organizationId: org._id })
  await M.ClassBookingModel.create({ userId: amy._id, liveClassId: soon._id, status: 'booked' })
  await M.ClassBookingModel.create({ userId: ben._id, liveClassId: soon._id, status: 'cancelled' })
  await M.ClassBookingModel.create({ userId: amy._id, liveClassId: later._id, status: 'booked' })
  sent.length = 0
  const n1 = await R.runOneMinReminders(now)
  await settle()
  check('one reminder — the booked student of the class about to start', n1 === 1, String(n1))
  const bell = await M.NotificationModel.findOne({ userId: amy._id, title: 'Starting in 1 min: MBT 3' }).lean() as any
  check('...a bell that opens the class', bell?.link === `/live-classes/${soon._id}/watch`, JSON.stringify(bell))
  check('...and a push', sent.some(s => s.data.title === 'Starting in 1 min: MBT 3'))
  check('a cancelled booking: nothing', !(await M.NotificationModel.exists({ userId: ben._id, title: /1 min/ })))
  check('a class 20 minutes away: not yet', !(await M.NotificationModel.exists({ userId: amy._id, title: 'Starting in 1 min: MBT 4' })))
  check('the next tick: not again', await R.runOneMinReminders(now) === 0)

  section('E · the morning summary')
  await M.NotificationModel.deleteMany({})
  const day = new Date(); day.setHours(23, 0, 0, 0)
  const c1 = await M.LiveClassModel.create({ courseId: course._id, instructorId: teacher._id, title: 'IM 1', scheduledStart: new Date(day.getTime() - 60 * 60_000), durationMins: 60, type: 'external', status: 'scheduled', organizationId: org._id })
  const c2 = await M.LiveClassModel.create({ courseId: course._id, instructorId: teacher._id, title: 'IM 2', scheduledStart: day, durationMins: 60, type: 'external', status: 'scheduled', organizationId: org._id })
  await M.ClassBookingModel.updateMany({}, { $set: { reminderDayOfSent: true } })
  await M.ClassBookingModel.create({ userId: cara._id, liveClassId: c1._id, status: 'booked', reminderDayOfSent: false })
  await M.ClassBookingModel.create({ userId: cara._id, liveClassId: c2._id, status: 'booked', reminderDayOfSent: false })
  await R.runDayOfReminders()
  await settle()
  const caraBells = await M.NotificationModel.find({ userId: cara._id }).lean() as any[]
  check('one bell for two classes', caraBells.length === 1, JSON.stringify(caraBells.map(b => b.title)))
  check('..."Your 2 classes today", both listed in order', caraBells[0]?.title === 'Your 2 classes today' && /IM 1[\s\S]*IM 2/.test(caraBells[0]?.body ?? ''), JSON.stringify(caraBells[0]))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
