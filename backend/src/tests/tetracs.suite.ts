/* ─────────────────────────────────────────────────────────────
   Students' CS and CS team from the commission portal, and the admin lists
   that show them (services/portalStudentCs.service.ts, POST /service/student-cs;
   the user, 2026-10-07: "show the cs name and team name … every student
   showing area").

   Pinned here, against a real database:

     A. what the portal says is kept on the student as tetraCs — by email
        whatever its capitals, by LMS user id even under another email; the
        open pool as no CS with its team; staff accounts and unknown addresses
        not written; told again unchanged, nothing written; a change written;
        the same student twice in a call — the first stands; not a list, or
        more than 500 — refused;
     B. over HTTP, only with the commission portal's secret (the CRM's): none
        or a wrong one 401, the Root portal's 403;
     C. the admin's student lists carry it — Students, Bookings, class
        verification (as the portal says now, else the snapshot from when this
        LMS first sent them), course students, express members, devices,
        enrolment requests, the attendance report and support tickets.

   Run: bun --no-env-file src/tests/tetracs.suite.ts
   (TETRACS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.TETRACS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_tetracs'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.DOTENV_CONFIG_PATH = '/nonexistent/tetracs-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'tetracs-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'tetracs-suite-refresh-secret-0123456789'
const CRM_SECRET  = 'tetracs-suite-crm-secret-0123456789'
const ROOT_SECRET = 'tetracs-suite-root-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ROOT_SECRET

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { studentCsFromPortal } = await import('@/services/portalStudentCs.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_tetracs') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const MIN = 60_000, PW = 'CorrectHorse1'
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return null } catch (e) { return e } }

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  await M.UserModel.create({ name: 'Admin', email: 'admin@tc.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const mentor = await M.UserModel.create({ name: 'MOIZ', email: 'moiz@tc.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const staff  = await M.UserModel.create({ name: 'Sam Staff', email: 'staff@tc.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const student = (name: string, email: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email, passwordHash: hash, role: 'student', isActive: true, organizationId: org._id,
    enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'], ...extra,
  })
  const aisha = await student('Aisha', 'aisha@tc.local')
  const bilal = await student('Bilal', 'bilal@tc.local')
  const cara  = await student('Cara', 'cara@tc.local', { commissionSync: { state: 'sent', mentorName: 'CS 1- MH', team: 'Hawks', studentCode: 'STU-1' } })
  const dev   = await student('Dev', 'dev@tc.local', { signupType: 'express', enrollmentStatus: 'rejected' })

  step('A · what the portal says is kept on the student')
  check('not a list: refused', (await refused(() => studentCsFromPortal({ students: 'everyone' }))) instanceof PortalError)
  check('more than 500 at a time: refused', (await refused(() => studentCsFromPortal({ students: Array.from({ length: 501 }, (_, i) => ({ email: `x${i}@tc.local` })) }))) instanceof PortalError)
  let r = await studentCsFromPortal({ students: [
    { email: 'AISHA@TC.LOCAL', cs: 'CS 2- AB', team: 'Falcons', code: 'STU-10', open: false },
    { email: 'old.bilal@elsewhere.test', lmsUserId: String(bilal._id), cs: 'CS 3- KT', team: 'Eagles', code: 'STU-11' },
    { email: 'dev@tc.local', cs: '', team: 'Delta Open Students', code: 'STU-12', open: true },
    { email: 'staff@tc.local', cs: 'CS 9', team: 'Nope', code: 'STU-99' },
    { email: 'nobody@tc.local', cs: 'CS 9', team: 'Nope', code: 'STU-98' },
    {},
  ] })
  check('three written; a staff account and an unknown address not found', r.updated === 3 && r.unchanged === 0 && r.notFound.join(',') === 'staff@tc.local,nobody@tc.local', JSON.stringify(r))
  const get = async (id: unknown) => (await M.UserModel.findById(id).lean() as any)?.tetraCs
  const a1 = await get(aisha._id)
  check('by email, whatever its capitals: CS, team, code, when', a1?.name === 'CS 2- AB' && a1?.team === 'Falcons' && a1?.code === 'STU-10' && a1?.open === false && !!a1?.at, JSON.stringify(a1))
  check('by LMS user id, even under another email', (await get(bilal._id))?.name === 'CS 3- KT')
  const d1 = await get(dev._id)
  check('the open pool: no CS, its team, open', d1?.name === '' && d1?.team === 'Delta Open Students' && d1?.open === true, JSON.stringify(d1))
  check('the staff account with that email: untouched', !(await get(staff._id)))
  r = await studentCsFromPortal({ students: [
    { email: 'aisha@tc.local', cs: 'CS 2- AB', team: 'Falcons', code: 'STU-10', open: false },
    { lmsUserId: String(bilal._id), cs: 'CS 3- KT', team: 'Eagles', code: 'STU-11' },
    { email: 'dev@tc.local', cs: '', team: 'Delta Open Students', code: 'STU-12', open: true },
  ] })
  check('told again, unchanged: nothing written', r.updated === 0 && r.unchanged === 3 && new Date((await get(aisha._id))?.at).getTime() === new Date(a1.at).getTime(), JSON.stringify(r))
  r = await studentCsFromPortal({ students: [{ email: 'aisha@tc.local', cs: 'CS 2- AB', team: 'Ravens', code: 'STU-10' }] })
  check('another team: written', r.updated === 1 && (await get(aisha._id))?.team === 'Ravens', JSON.stringify(r))
  r = await studentCsFromPortal({ students: [
    { email: 'aisha@tc.local', cs: 'CS 4- NN', team: 'Falcons', code: 'STU-10' },
    { email: 'aisha@tc.local', cs: 'CS 5- ZZ', team: 'Owls', code: 'STU-10' },
  ] })
  check('the same student twice in a call: the first stands', r.updated === 1 && (await get(aisha._id))?.name === 'CS 4- NN', JSON.stringify(await get(aisha._id)))

  step('B · over HTTP, only from the commission portal')
  const tell = { students: [{ email: 'aisha@tc.local', cs: 'CS 2- AB', team: 'Falcons', code: 'STU-10' }] }
  check('no secret: 401', (await call('POST', '/service/student-cs', undefined, tell)).status === 401)
  check('a wrong secret: 401', (await call('POST', '/service/student-cs', undefined, tell, { 'x-portal-secret': 'guess' })).status === 401)
  const root = await call('POST', '/service/student-cs', undefined, tell, { 'x-portal-secret': ROOT_SECRET })
  check("the Root portal's secret: 403 — only the commission portal says who looks after a student", root.status === 403, why(root))
  const crm = await call('POST', '/service/student-cs', undefined, tell, { 'x-portal-secret': CRM_SECRET })
  check("the commission portal's: written", crm.status === 200 && crm.body?.data?.updated === 1 && (await get(aisha._id))?.name === 'CS 2- AB', why(crm))

  step('C · the admin lists carry it')
  const course = await M.CourseModel.create({ title: 'MBT', slug: 'mbt-' + Date.now(), description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program: '4x-trading' })
  await M.EnrollmentModel.create({ userId: aisha._id, courseId: course._id, status: 'active' })
  const cls = await M.LiveClassModel.create({
    title: 'MBT 4', courseId: course._id, instructorId: mentor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() - 240 * MIN), durationMins: 120, type: 'external', isOnline: true,
    status: 'ended', sessionCapacity: 30, bookedCount: 2, attendanceFinalized: true,
  })
  await M.ClassBookingModel.create({ userId: aisha._id, liveClassId: cls._id, status: 'attended', attendedAt: new Date(), attendanceSource: 'click' })
  await M.ClassBookingModel.create({ userId: cara._id, liveClassId: cls._id, status: 'missed' })
  await M.DeviceModel.create({ userId: aisha._id, deviceId: 'device-1', status: 'pending' })
  await M.SupportTicketModel.create({ userId: aisha._id, organizationId: org._id, subject: 'Cannot open module 2', category: 'course', status: 'open',
    messages: [{ senderRole: 'student', senderId: aisha._id, body: 'Module 2 is locked', createdAt: new Date() }], lastMessageAt: new Date(), lastSenderRole: 'student' })

  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { email: 'admin@tc.local', password: PW })
  check('(the admin signs in)', login.status === 200, why(login))
  const cs = (x: any) => x?.tetraCs?.name

  const users = await call('GET', '/admin/users?role=student&per_page=50', jar)
  check('Students table: Aisha with her CS and team', cs(users.body?.data?.find((u: any) => u.email === 'aisha@tc.local')) === 'CS 2- AB'
    && users.body?.data?.find((u: any) => u.email === 'aisha@tc.local')?.tetraCs?.team === 'Falcons', why(users))
  const bookings = await call('GET', '/admin/bookings?per_page=50', jar)
  check('Bookings: each booking\'s student with theirs', cs(bookings.body?.data?.find((b: any) => b.userId?.email === 'aisha@tc.local')?.userId) === 'CS 2- AB', why(bookings))
  const verify = await call('GET', `/admin/class-verification/${cls._id}`, jar)
  const vs = (name: string) => verify.body?.data?.students?.find((s: any) => s.name === name)
  check('class verification: as the portal says now', vs('Aisha')?.cs === 'CS 2- AB' && vs('Aisha')?.team === 'Falcons' && vs('Aisha')?.studentCode === 'STU-10', JSON.stringify(vs('Aisha')))
  check('…and, before it has said, what it answered when first sent', vs('Cara')?.cs === 'CS 1- MH' && vs('Cara')?.team === 'Hawks', JSON.stringify(vs('Cara')))
  const courseStudents = await call('GET', `/admin/courses/${course._id}/students`, jar)
  const rows = courseStudents.body?.data?.rows ?? courseStudents.body?.data ?? []
  check('course students', cs((Array.isArray(rows) ? rows : []).find((x: any) => x.student?.email === 'aisha@tc.local')?.student) === 'CS 2- AB', why(courseStudents) + ' ' + JSON.stringify(courseStudents.body?.data).slice(0, 200))
  const express = await call('GET', '/admin/express-members', jar)
  const devRow = express.body?.data?.find((x: any) => x.email === 'dev@tc.local')
  check('express members: the open pool, no CS', devRow?.tetraCs?.open === true && devRow?.tetraCs?.team === 'Delta Open Students', why(express) + ' ' + JSON.stringify(devRow))
  const devices = await call('GET', '/admin/devices', jar)
  check('devices', cs(devices.body?.data?.find((x: any) => x.email === 'aisha@tc.local')) === 'CS 2- AB', why(devices))
  const requests = await call('GET', '/admin/enrollment-requests?status=approved', jar)
  check('enrolment requests', cs(requests.body?.data?.find((x: any) => x.email === 'aisha@tc.local')) === 'CS 2- AB', why(requests))
  const report = await call('GET', '/admin/reports/attendance', jar)
  check('the attendance report', cs(report.body?.data?.find((x: any) => x.user?.email === 'aisha@tc.local')?.user) === 'CS 2- AB', why(report))
  const tickets = await call('GET', '/support/admin', jar)
  const tdata = tickets.body?.data?.tickets ?? tickets.body?.data ?? []
  check('support tickets', cs((Array.isArray(tdata) ? tdata : []).find((t: any) => t.userId?.email === 'aisha@tc.local')?.userId) === 'CS 2- AB', why(tickets) + ' ' + JSON.stringify(tickets.body?.data).slice(0, 200))
} catch (err) {
  fail++; console.log(`  \x1b[31m✗ suite threw — ${(err as Error).message}\n${(err as Error).stack}\x1b[0m`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
