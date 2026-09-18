/* ─────────────────────────────────────────────────────────────
   The browse feed is scoped to the caller's academy (plan phase 6a).

   GET /live-classes/upcoming had NO academy term at all — every other
   student-facing list is scoped and this one was not. So a student could see
   the other academy's entire upcoming timetable: titles, instructor names and
   times for classes they can neither book nor join.

   THIS IS THE ONE USER-VISIBLE CHANGE THAT SHIPS BEFORE THE FEATURE, AND IT
   SHIPS ALONE. It takes something away from students who have no stake in
   cross-academy classes, and some may have been using the feed as a catalogue.
   This repo has already lived through a support wave from live classes
   appearing to vanish, and that cause took real time to find precisely because
   the change was not isolated. Alone, it can be reverted alone.

   Run: bun run test:upcomingfeed
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_upcomingfeed_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* PINNED OFF. The narrowing this suite is about must hold in the state the
   product actually ships in, and a suite that inherits the operator's
   environment tests whatever they happened to export. */
process.env.CROSS_ORG_CLASSES = ''
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel, EnrollmentModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_upcomingfeed_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise(r => server.once('listening', r))
const port = (server.address() as { port: number }).port
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.jar?.size) headers['Cookie'] = [...opts.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, {
    method, headers, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  })
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const [k, v] = (pair ?? '').split('=')
    if (k && v && opts.jar) opts.jar.set(k.trim(), v.trim())
  }
  let body: any = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}
const why = (r: { status: number; body: any }) =>
  `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 60)}`
const PW = 'TestPass123'

try {
  const hash = await hashPassword(PW)
  const dubai = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'BLR', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  const mk = (email: string, role: string, org: any | null, extra: object = {}) =>
    UserModel.create({
      name: email.split('@')[0], email, passwordHash: hash, role,
      isActive: true, isVerified: true,
      ...(org ? { organizationId: org._id } : {}), ...extra,
    })

  const teacher = await mk('t@t.local', 'instructor', dubai)
  const mkCourse = (t: string, org: any) => CourseModel.create({
    title: t, slug: `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'x', price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, instructorId: teacher._id, category: 'ai', program: 'ai',
  })
  const dCourse = await mkCourse('dxb', dubai)
  const bCourse = await mkCourse('blr', blr)
  const dSec = await SectionModel.create({ courseId: dCourse._id, title: 'M2', order: 2 })
  const bSec = await SectionModel.create({ courseId: bCourse._id, title: 'M2', order: 2 })

  const soon = () => new Date(Date.now() + 86_400_000)
  const mkClass = (title: string, course: any, org: any, cohorts: unknown[] = []) =>
    LiveClassModel.create({
      courseId: course._id, instructorId: teacher._id, title, type: 'external',
      meetingUrl: 'https://meet.example/x', scheduledStart: soon(), durationMins: 60,
      organizationId: org._id, sessionCapacity: 20, bookedCount: 0,
      ...(cohorts.length ? {
        guestCohorts: cohorts, hostSeatsLeft: 10, overflowSeatsLeft: 0,
      } : {}),
    })

  const dubaiOnly = await mkClass('Dubai only class', dCourse, dubai)
  const blrOnly   = await mkClass('Bangalore only class', bCourse, blr)
  const shared    = await mkClass('Shared class', dCourse, dubai, [{
    organizationId: blr._id, courseId: bCourse._id, sectionId: bSec._id, seatFloor: 10, seatsLeft: 10,
  }])
  /* A class from before the field existed. Rule 2: it has no academy, so it
     belongs to nobody and must stay visible to everyone. */
  const legacy = await LiveClassModel.create({
    courseId: dCourse._id, instructorId: teacher._id, title: 'Legacy class', type: 'external',
    meetingUrl: 'https://meet.example/y', scheduledStart: soon(), durationMins: 60,
    sessionCapacity: 20, bookedCount: 0,
  })

  const blrStudent = await mk('blr.student@t.local', 'student', blr, { enrollmentStatus: 'approved', category: 'ai' })
  await EnrollmentModel.create({ userId: blrStudent._id, courseId: bCourse._id, status: 'active' })
  /* A student with NO academy on record — tenancy rule 3b says unscoped. */
  const orphan = await mk('orphan@t.local', 'student', null, { enrollmentStatus: 'approved', category: 'ai' })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return jar
  }
  const B = await login('blr.student@t.local')
  const O = await login('orphan@t.local')

  const feed = async (jar: Jar) => {
    const r = await call('GET', '/live-classes/upcoming?limit=100', { jar })
    return { r, titles: (r.body?.data ?? []).map((c: any) => String(c.title)) }
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A student sees their own academy, and no longer the other one')
  {
    const { r, titles } = await feed(B)
    check('the feed answers', r.status === 200, why(r))
    check('their own academy-s class is there', titles.includes('Bangalore only class'), titles.join(' | '))
    check('the OTHER academy-s class is gone — this is the leak that closes',
      !titles.includes('Dubai only class'), titles.join(' | '))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A shared class is DARK while the feature is switched off')
  {
    const { titles } = await feed(B)
    /* OFF MEANS DARK ON BOTH HALVES. Gating only entitlement produced a class
       that appeared on a guest academy's feed and then refused them at
       booking — visible but unbookable, which is worse than invisible because
       it generates a support ticket instead of silence.

       The ON case is crossorgclass.open.suite.ts, which pins the switch the
       other way and asserts this same class IS reachable. */
    check('a class with an authored guest cohort stays hidden while the switch is off',
      !titles.includes('Shared class'), titles.join(' | '))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('The exceptions the tenancy rules require')
  {
    const { titles } = await feed(B)
    check('a class with no academy at all stays visible to everyone (rule 2)',
      titles.includes('Legacy class'), titles.join(' | '))

    const { titles: orphanTitles } = await feed(O)
    check('a caller with no academy on record stays UNSCOPED (rule 3b)',
      orphanTitles.includes('Dubai only class') && orphanTitles.includes('Bangalore only class'),
      orphanTitles.join(' | '))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Narrowing did not break what the feed is for')
  {
    const { r, titles } = await feed(B)
    const rows = r.body?.data ?? []
    check('the rows still carry what the card needs',
      rows.every((c: any) => c.title && c.scheduledStart), JSON.stringify(rows[0] ?? {}).slice(0, 120))
    check('and entitlement is still annotated, not dropped by the new clause',
      rows.some((c: any) => c.isEnrolled === true), titles.join(' | '))
  }

  console.log(lines.join('\n'))
  console.log(`\nupcomingfeed.suite — ${pass} passed, ${failures.length} failed`)
  if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
} catch (err) {
  console.error(err)
  try { server.close(); await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
  process.exit(1)
}
