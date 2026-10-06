/* ─────────────────────────────────────────────────────────────
   What a student STUDIES vs what they were APPROVED into.

   Reported: an AI student an admin added to a Digital Marketing course showed
   only "AI" in the Students table, and never saw that course's classes on
   their dashboard. `categories` stays the approval record by design
   (programscope.suite.ts §E); the enrolled programmes are derived from
   enrolments (utils/enrolledPrograms.ts) and shown beside them.

   Run: bun run test:enrolledprograms
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_enrolledprograms_suite'
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
const { UserModel, OrganizationModel, CourseModel, EnrollmentModel, LiveClassModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { enrolledProgramsOf } = await import('@/utils/enrolledPrograms.ts')
const { OrderService } = await import('@/services/order.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_enrolledprograms_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
await EnrollmentModel.syncIndexes().catch(() => {})

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const cats = async (id: unknown) => {
  const u = await UserModel.findById(id).select('category categories').lean() as any
  return { category: u?.category as string | undefined, categories: (u?.categories ?? []) as string[] }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

try {
  const org  = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mkUser = (role: string, extra: Record<string, unknown> = {}) => UserModel.create({
    name: `${role} ${seq}`, email: `${role}-${seq++}@ep.local`, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org._id, ...extra,
  })
  const teacher = await mkUser('instructor', { category: 'ai' })
  const mkCourse = (program: string | undefined) => CourseModel.create({
    title: `Course ${seq}`, slug: `course-${seq++}`, description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
    ...(program ? { program } : {}),
  })
  const aiCourse   = await mkCourse('ai')
  const aiCourse2  = await mkCourse('ai')
  const dmCourse   = await mkCourse('digital-marketing')
  const juraCourse = await mkCourse('jura')
  const fxCourse   = await mkCourse('4x-trading')
  const noProgram  = await mkCourse(undefined)

  const admin = await mkUser('admin')
  const adminJar: Jar = new Map()
  { const r = await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: admin.email, password: PW } })
    if (r.status !== 200) throw new Error(`admin login ${r.status} ${JSON.stringify(r.body)}`) }
  const adminEnroll = (userId: unknown, courseId: unknown) =>
    call('POST', `/admin/users/${userId}/enrollments`, { jar: adminJar, body: { courseId: String(courseId) } })
  const approvedStudent = (extra: Record<string, unknown> = {}) =>
    mkUser('student', { category: 'ai', categories: ['ai'], enrollmentStatus: 'approved', ...extra })
  const tableRow = async (s: any) => {
    const list = await call('GET', `/admin/users?role=student&search=${encodeURIComponent(s.email)}`, { jar: adminJar })
    return (list.body?.data ?? []).find((u: any) => u.email === s.email)
  }

  /* ═══ A — the reported case ═══ */
  section('A. Admin adds a Digital Marketing course to an AI student')
  {
    const s = await approvedStudent()
    await adminEnroll(s._id, aiCourse._id)
    const r = await adminEnroll(s._id, dmCourse._id)
    check('A1 the enrolment is created', r.status === 201, String(r.status))
    const row = await tableRow(s)
    check('A2 the Students table data lists both programmes studied', same(row?.enrolledPrograms, ['digital-marketing', 'ai']), JSON.stringify(row?.enrolledPrograms))
    check('A3 the approval record is unchanged — still approved into AI only', same(row?.categories, ['ai']), JSON.stringify(row?.categories))
    const c = await cats(s._id)
    check('A4 nothing was written to the stored programme', same(c.categories, ['ai']) && c.category === 'ai', JSON.stringify(c))
  }

  /* ═══ B — derived, so removal follows ═══ */
  section('B. Removing the course removes the programme from the table')
  {
    const s = await approvedStudent()
    const e = await adminEnroll(s._id, dmCourse._id)
    check('B0 shown while enrolled', same((await tableRow(s))?.enrolledPrograms, ['digital-marketing']))
    const del = await call('DELETE', `/admin/enrollments/${e.body?.data?.id ?? e.body?.data?._id}`, { jar: adminJar })
    check('B1 removing the enrolment succeeds', del.status === 200, `${del.status} ${JSON.stringify(del.body?.error)}`)
    const after = (await tableRow(s))?.enrolledPrograms
    check('B2 gone from the table once the course is removed', same(after, []), JSON.stringify(after))
  }

  /* ═══ C — what is never counted ═══ */
  section('C. Dropped enrolments and programme-less courses are not programmes')
  {
    const s = await approvedStudent()
    await EnrollmentModel.create({ userId: s._id, courseId: dmCourse._id, status: 'dropped', source: 'admin' })
    await adminEnroll(s._id, noProgram._id)
    const row = await tableRow(s)
    check('C1 neither counts', same(row?.enrolledPrograms, []), JSON.stringify(row?.enrolledPrograms))
    await adminEnroll(s._id, aiCourse._id)
    await adminEnroll(s._id, aiCourse2._id)
    check('C2 two courses of one programme list it once', same((await tableRow(s))?.enrolledPrograms, ['ai']))
  }

  /* ═══ D — path independence ═══ */
  section('D. Every way onto a course shows up — self-enrol, purchase, script')
  {
    const s = await approvedStudent()
    const jar: Jar = new Map()
    const login = await call('POST', '/auth/login', { jar, body: { email: s.email, password: PW } })
    check('D0 student signs in', login.status === 200, String(login.status))
    const r = await call('POST', '/enrollments', { jar, body: { courseId: String(juraCourse._id) } })
    check('D1 free self-enrolment succeeds', r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body?.error)}`)
    await (new OrderService() as any)._createEnrollment(String(s._id), String(fxCourse._id))
    await EnrollmentModel.create({ userId: s._id, courseId: dmCourse._id, source: 'script' })
    const row = await tableRow(s)
    check('D2 all three appear, in a stable order', same(row?.enrolledPrograms, ['4x-trading', 'digital-marketing', 'jura']), JSON.stringify(row?.enrolledPrograms))
    check('D3 and the approval record is still AI alone', same((await cats(s._id)).categories, ['ai']))
  }

  /* ═══ E — every row in a page ═══ */
  section('E. A whole page of students each gets their own programmes')
  {
    const a = await approvedStudent(); const b = await approvedStudent(); const n = await approvedStudent()
    await adminEnroll(a._id, dmCourse._id)
    await adminEnroll(b._id, juraCourse._id)
    const list = await call('GET', '/admin/users?role=student&per_page=100', { jar: adminJar })
    const rows: any[] = list.body?.data ?? []
    const by = (s: any) => rows.find(u => u.email === s.email)
    check('E1 each student carries their own',
      same(by(a)?.enrolledPrograms, ['digital-marketing']) && same(by(b)?.enrolledPrograms, ['jura']),
      JSON.stringify([by(a)?.enrolledPrograms, by(b)?.enrolledPrograms]))
    check('E2 no enrolments → an empty list, not a missing field', same(by(n)?.enrolledPrograms, []), JSON.stringify(by(n)?.enrolledPrograms))
    check('E3 rows stay sanitised — no password hash, ids present',
      rows.length > 0 && rows.every(u => !('passwordHash' in u) && !!u.id), JSON.stringify(Object.keys(rows[0] ?? {})))

    const staff = await call('GET', '/admin/users?per_page=100', { jar: adminJar })
    const adminRow = (staff.body?.data ?? []).find((u: any) => u.email === admin.email)
    check('E4 staff rows are unchanged — no enrolledPrograms on them', !!adminRow && !('enrolledPrograms' in adminRow), JSON.stringify(adminRow && Object.keys(adminRow)))
  }

  /* ═══ F — the dashboard feed ═══ */
  section('F. The upcoming feed shows every studied programme\'s classes')
  {
    const s = await approvedStudent()
    await adminEnroll(s._id, aiCourse._id)
    await adminEnroll(s._id, dmCourse._id)
    const mkClass = (course: any) => LiveClassModel.create({
      title: `Class ${seq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() + 2 * 3_600_000), durationMins: 60, type: 'external',
      meetingUrl: 'https://meet.google.com/ep-test', isOnline: true, status: 'scheduled',
      language: 'English', sessionCapacity: 30, bookedCount: 0,
    })
    const aiClass   = await mkClass(aiCourse)
    const dmClass   = await mkClass(dmCourse)
    const juraClass = await mkClass(juraCourse)
    const jar: Jar = new Map()
    await call('POST', '/auth/login', { jar, body: { email: s.email, password: PW } })
    const r = await call('GET', '/live-classes/upcoming?limit=50', { jar })
    const ids = (r.body?.data ?? []).map((x: any) => String(x.id ?? x._id))
    check('F1 the approved programme\'s class is listed', ids.includes(String(aiClass._id)), JSON.stringify(ids))
    check('F2 the studied programme\'s class is listed too', ids.includes(String(dmClass._id)), JSON.stringify(ids))
    check('F3 a programme they neither approved into nor study stays out', !ids.includes(String(juraClass._id)), JSON.stringify(ids))
  }

  /* ═══ G — helper edges ═══ */
  section('G. The helper itself')
  {
    const s = await approvedStudent()
    check('G1 nothing enrolled → []', same(await enrolledProgramsOf(String(s._id)), []))
    check('G2 an invalid id is not an error', same(await enrolledProgramsOf('not-an-id'), []))
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  server.close()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
