/* ─────────────────────────────────────────────────────────────
   The admin topbar's org switcher, for a super_admin, arrives on every
   request as the X-Organization-Id header (authenticateAdmin populates
   req.user.organizationId from it — see auth.middleware.ts). A run of
   endpoints across the admin panel keyed their org-scoping off
   `caller.role !== 'super_admin'` instead of off whether that field was
   actually set, which meant a super_admin who had picked ONE academy in the
   switcher still saw every academy's rows anyway — the switcher was cosmetic
   for that role. This suite pins the fix on the endpoints that had it:
   Announcements and Impersonation Sessions (Class Assignments and
   Recordings each have their own dedicated suites already).

   It also covers a second, unrelated bug the same audit turned up: the
   attendance report crashed with a 500 ("null is not an object") whenever a
   booking's student account had been deleted — populate() resolves a
   dangling ref to null, and the aggregation read `u.id` off it unguarded.

   Run: bun run test:orgswitcherscope
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_orgswitcherscope'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, AnnouncementModel, ImpersonationSessionModel,
  CourseModel, LiveClassModel, ClassBookingModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_orgswitcherscope') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@oss.local`

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const root = await UserModel.create({
    name: 'root', email: email('root'), passwordHash: hash, role: 'super_admin', isActive: true,
  })
  const rootJar: Jar = new Map()
  {
    const r = await call('POST', '/admin/auth/login', { jar: rootJar, body: { email: root.email, password: PW } })
    if (r.status !== 200) throw new Error(`root login: ${r.status} ${JSON.stringify(r.body)}`)
  }
  const asBlr = { jar: rootJar, headers: { 'x-organization-id': String(blr._id) } }

  /* ═══════════════════════════════════════════════ */
  section('A · Announcements — the switcher scopes a super_admin, not just an org admin')
  {
    await AnnouncementModel.create({
      title: 'Dubai maintenance window', description: 'd', organizationId: dubai._id,
      startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000), createdBy: root._id,
    })
    await AnnouncementModel.create({
      title: 'Bangalore maintenance window', description: 'd', organizationId: blr._id,
      startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000), createdBy: root._id,
    })

    const all = await call('GET', '/admin/announcements', { jar: rootJar })
    check('on "All Orgs", the super admin sees both', (all.body?.data ?? []).length === 2,
      JSON.stringify((all.body?.data ?? []).map((a: any) => a.title)))

    const switched = await call('GET', '/admin/announcements', asBlr)
    const titles = (switched.body?.data ?? []).map((a: any) => a.title)
    check('switched to Bangalore, only Bangalore\'s announcement is returned',
      titles.length === 1 && titles[0] === 'Bangalore maintenance window', JSON.stringify(titles))
    check('...and Dubai\'s is not in it', !titles.includes('Dubai maintenance window'), JSON.stringify(titles))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · Impersonation Sessions — same fix, same reason')
  {
    const dubaiStaff = await UserModel.create({ name: 'ds', email: email('ds'), passwordHash: hash, role: 'admin', organizationId: dubai._id, isActive: true })
    const dubaiStudent = await UserModel.create({ name: 'dstu', email: email('dstu'), passwordHash: hash, role: 'student', organizationId: dubai._id, isActive: true })
    const blrStaff = await UserModel.create({ name: 'bs', email: email('bs'), passwordHash: hash, role: 'admin', organizationId: blr._id, isActive: true })
    const blrStudent = await UserModel.create({ name: 'bstu', email: email('bstu'), passwordHash: hash, role: 'student', organizationId: blr._id, isActive: true })

    await ImpersonationSessionModel.create({
      actorId: dubaiStaff._id, actorEmail: dubaiStaff.email, targetId: dubaiStudent._id, targetEmail: dubaiStudent.email,
      organizationId: dubai._id, expiresAt: new Date(Date.now() + 3_600_000),
    })
    await ImpersonationSessionModel.create({
      actorId: blrStaff._id, actorEmail: blrStaff.email, targetId: blrStudent._id, targetEmail: blrStudent.email,
      organizationId: blr._id, expiresAt: new Date(Date.now() + 3_600_000),
    })

    const all = await call('GET', '/admin/impersonation-sessions', { jar: rootJar })
    check('on "All Orgs", the super admin sees both academies\' sessions',
      (all.body?.data ?? []).length === 2, String((all.body?.data ?? []).length))

    const switched = await call('GET', '/admin/impersonation-sessions', asBlr)
    const rows = switched.body?.data ?? []
    check('switched to Bangalore, only Bangalore\'s session is returned', rows.length === 1, String(rows.length))
    check('...and it is really Bangalore\'s, not Dubai\'s',
      rows[0]?.targetEmail === blrStudent.email, JSON.stringify(rows.map((r: any) => r.targetEmail)))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · Attendance report — a deleted student\'s booking is skipped, not a 500')
  {
    const instructor = await UserModel.create({ name: 'teach', email: email('teach'), passwordHash: hash, role: 'instructor', organizationId: dubai._id, isActive: true })
    const course = await CourseModel.create({
      title: 'C', slug: `c-${Date.now()}`, description: 'd', instructorId: instructor._id,
      price: 0, isFree: true, status: 'published', language: 'English', organizationId: dubai._id,
    })
    const cls = await LiveClassModel.create({
      title: 'S', courseId: course._id, instructorId: instructor._id, organizationId: dubai._id,
      scheduledStart: new Date(Date.now() - 72 * 3_600_000), durationMins: 60, type: 'external', isOnline: true,
    })
    const ghostId = new mongoose.Types.ObjectId()   // never a real user — simulates a deleted account
    await ClassBookingModel.create({ userId: ghostId, liveClassId: cls._id, status: 'attended', bookedAt: new Date() })

    const r = await call('GET', '/admin/reports/attendance', { jar: rootJar })
    check('the endpoint answers 200, not a 500 crash', r.status === 200, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
    check('the ghost booking is silently excluded, not surfaced as a broken row',
      !(r.body?.data ?? []).some((row: any) => String(row?.user?.id) === String(ghostId)),
      JSON.stringify(r.body?.data))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
