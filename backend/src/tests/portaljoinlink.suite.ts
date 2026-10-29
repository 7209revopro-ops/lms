/* ─────────────────────────────────────────────────────────────
   A booked student's join link from the CS Portal (portal.service.ts
   classJoinLinkForPortal, POST /service/classes/:id/join-link), and the
   class card's students with their booking and address.

   Pinned here: the /j/ link (with the Meet code) for that student and class,
   lasting until the join window closes (at least 2 hours); audited as the
   person; refused for a cancelled seat, a class over, cancelled or in person,
   another academy's class.

   Run: bun --no-env-file src/tests/portaljoinlink.suite.ts
   (PORTALJOINLINK_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALJOINLINK_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portaljoinlink'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portaljoinlink-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portaljoinlink-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portaljoinlink-suite-refresh-secret-0123456789'
process.env.PORTAL_SUPPORT_USER_EMAIL = 'desk@lms.test'
process.env.CLIENT_URL = 'https://lms.test'
const CRM_SECRET = 'portaljoinlink-suite-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET = ''

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}

const mongoose = (await import('mongoose')).default
const { UserModel, CourseModel, LiveClassModel, ClassBookingModel, OrganizationModel, AuthTokenModel, AuditLogModel } = await import('@/models/schema.ts')
const { classJoinLinkForPortal, getClassForPortal } = await import('@/services/portal.service.ts')
const { hashJoinCode } = await import('@/services/joinLink.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portaljoinlink') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = Date.now(), MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const at = (ms: number) => new Date(now + ms)
const org = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', createdAt: at(-DAY), updatedAt: at(-DAY) })).insertedId
const other = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', createdAt: at(-DAY), updatedAt: at(-DAY) })).insertedId
const course = (await CourseModel.collection.insertOne({ title: 'Digital Marketing', status: 'published', createdAt: at(-DAY), updatedAt: at(-DAY) })).insertedId
const person = async (email: string, name: string, role = 'student') =>
  (await UserModel.collection.insertOne({ email, name, role, isActive: true, createdAt: at(-DAY), updatedAt: at(-DAY) })).insertedId
const mentor = await person('aalia@lms.test', 'Aalia Parveen', 'instructor')
await person('desk@lms.test', 'Help Desk', 'support')
const suja = await person('Suja@lms.test', 'Suja K')
const saji = await person('saji@lms.test', 'Saji H')
const klass = async (o: Record<string, unknown>) => (await LiveClassModel.collection.insertOne({
  courseId: course, instructorId: mentor, organizationId: org, title: 'SMM 2', type: 'external', provider: 'mux', status: 'scheduled',
  isOnline: true, durationMins: 90, meetingUrl: 'https://meet.google.com/ser-azir-rwf', scheduledStart: at(DAY), createdAt: at(-DAY), updatedAt: at(-DAY), ...o,
})).insertedId
const seat = async (userId: unknown, liveClassId: unknown, status = 'booked') => (await ClassBookingModel.collection.insertOne({
  userId, liveClassId, status, bookedAt: at(-DAY), createdAt: at(-DAY), updatedAt: at(-DAY),
})).insertedId
const tomorrow = await klass({})
const sujaSeat = await seat(suja, tomorrow), sajiSeat = await seat(saji, tomorrow, 'cancelled')
const soon = await klass({ scheduledStart: at(10 * MIN), durationMins: 30 })
const soonSeat = await seat(suja, soon)
const over = await klass({ scheduledStart: at(-3 * HOUR), status: 'ended' })
const overSeat = await seat(suja, over, 'attended')
const cancelled = await klass({ status: 'cancelled' }); const cancelledSeat = await seat(suja, cancelled)
const inPerson = await klass({ isOnline: false }); const inPersonSeat = await seat(suja, inPerson)
const theirs = await klass({ organizationId: other }); const theirsSeat = await seat(suja, theirs)
const remoteOrgId = String(org)

const card: any = await getClassForPortal({ remoteOrgId, classId: String(tomorrow), contacts: true })
const sj = card.students.find((s: any) => s.name === 'Suja K')
check('the class card\'s students carry their booking and address, for the CS Portal', sj?.bookingId === String(sujaSeat) && sj.email === 'suja@lms.test', JSON.stringify(card.students))
const plain: any = await getClassForPortal({ remoteOrgId, classId: String(tomorrow) })
check('…names only otherwise (the sales CRM)', plain.students.every((s: any) => !('email' in s) && !('bookingId' in s)), JSON.stringify(plain.students))

const r: any = await classJoinLinkForPortal({ remoteOrgId, classId: String(tomorrow), bookingId: String(sujaSeat), byName: 'CS One', byEmail: 'cs1@delta.test' })
const raw = r.joinUrl.split('/j/')[1].split('?')[0]
const tok = await AuthTokenModel.findOne({ tokenHash: hashJoinCode(raw) }).lean() as any
const closes = now + DAY + (90 + 15) * MIN
check('a /j/ link with the Meet code, for that student and class', r.joinUrl.startsWith('https://lms.test/j/') && r.joinUrl.endsWith('?m=ser-azir-rwf') && tok?.purpose === 'join-link' && String(tok.userId) === String(suja) && String(tok.liveClassId) === String(tomorrow), JSON.stringify({ r, tok }))
check('…lasting until the join window closes (tomorrow\'s class: a day and more, not 2 hours)', Math.abs(new Date(tok.expiresAt).getTime() - closes) < 5000 && Math.abs(Date.parse(r.expiresAt) - closes) < 5000, String(tok?.expiresAt))
check('…with what the message needs', r.meetingUrl === 'https://meet.google.com/ser-azir-rwf' && r.class.title === 'SMM 2' && r.class.course === 'Digital Marketing' && r.class.mentor === 'Aalia Parveen' && r.student.name === 'Suja K', JSON.stringify(r))
const audit = await AuditLogModel.findOne({ action: 'liveClass.joinLink' }).lean() as any
check('…audited with who made it (the shared account)', audit?.meta?.byName === 'CS One' && audit.meta.from === 'shared' && audit.meta.bookingId === String(sujaSeat), JSON.stringify(audit))

const s2: any = await classJoinLinkForPortal({ remoteOrgId, classId: String(soon), bookingId: String(soonSeat), byName: 'CS One', byEmail: '' })
const t2 = await AuthTokenModel.findOne({ tokenHash: hashJoinCode(s2.joinUrl.split('/j/')[1].split('?')[0]) }).lean() as any
check('a class starting soon: the usual 2 hours (longer than its window)', Math.abs(new Date(t2.expiresAt).getTime() - (now + 2 * HOUR)) < 10_000, String(t2?.expiresAt))

for (const [label, classId, bookingId, status, msg] of [
  ['a cancelled seat', tomorrow, sajiSeat, 400, /book again/],
  ['a class over', over, overSeat, 400, /over/],
  ['a cancelled class', cancelled, cancelledSeat, 400, /cancelled/],
  ['an in-person class', inPerson, inPersonSeat, 400, /in person/],
  ['another academy\'s class', theirs, theirsSeat, 404, /No such class/],
  ['a seat of another class', soon, sujaSeat, 404, /No such booking/],
] as const) {
  let e: any = null
  try { await classJoinLinkForPortal({ remoteOrgId, classId: String(classId), bookingId: String(bookingId), byName: 'x', byEmail: '' }) } catch (err) { e = err }
  check(`${label}: refused`, e?.statusCode === status && msg.test(String(e?.message)), `${e?.statusCode} ${e?.message}`)
}

// Over HTTP with the sales CRM's key — the one the CS Portal's Mentor Calendar calls with (2026-10-29).
{
  const express = (await import('express')).default
  const portalRoutes = (await import('@/routes/portal.routes.ts')).default
  const { errorMiddleware } = await import('@/middleware/error.middleware.ts')
  const app = express(); app.use(express.json()); app.use('/service', portalRoutes); app.use(errorMiddleware)
  const server = await new Promise<import('node:http').Server>(resolve => { const s2 = app.listen(0, '127.0.0.1', () => resolve(s2)) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/service`
  const ask = async (path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-portal-secret': CRM_SECRET }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: res.status, body: await res.json().catch(() => ({})) as any }
  }
  const withC = await ask(`/classes/${tomorrow}?remoteOrgId=${remoteOrgId}&contacts=1`)
  check('the CS Portal\'s key (the sales CRM\'s) asking for contacts: the bookings and addresses', withC.status === 200 && withC.body.data.students.some((x: any) => x.bookingId === String(sujaSeat) && x.email === 'suja@lms.test'), JSON.stringify(withC.body).slice(0, 300))
  const without = await ask(`/classes/${tomorrow}?remoteOrgId=${remoteOrgId}`)
  check('…not asking: names only', without.status === 200 && without.body.data.students.every((x: any) => !('email' in x)), JSON.stringify(without.body).slice(0, 300))
  const made = await ask(`/classes/${tomorrow}/join-link?remoteOrgId=${remoteOrgId}`, { bookingId: String(sujaSeat), byName: 'CS One', byEmail: '' })
  check('…and the join link, with that key', made.status === 200 && String(made.body.data?.joinUrl).startsWith('https://lms.test/j/'), JSON.stringify(made.body).slice(0, 300))
  server.close()
}

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

export {}
