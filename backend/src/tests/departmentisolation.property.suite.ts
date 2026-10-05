/* ─────────────────────────────────────────────────────────────
   Department isolation — PROPERTY suite (plan.md §10).

   Random worlds — two academies, four departments, students who belong,
   apply, enrol, or once ticked another department's option — and one
   property for every admin list a department head can open:

       L(head) == { r ∈ L(admin of the head's academy) : r is the head's department's }

   The admin's own view carries every filter that is NOT about departments
   (tenancy, status defaults, date windows), so the oracle only encodes the
   department rules of plan.md §10.3 — written here from the spec, never
   imported from utils/departmentScope.ts. A row the head sees and should not
   is a leak; a row they should see and do not is over-blocking.

   Also, per world: every detail endpoint opens exactly for the department's
   records; paging adds up to meta.total_count with no duplicates; the same
   lists fired concurrently by every head answer exactly as they did one at a
   time; and a head's department follows their record on the very next
   request (moved, removed, deactivated, promoted).

   Seeded: SEED=<n> reproduces a run, ROUNDS=<n> worlds (default 3).
   CROSS_ORG_CLASSES=true adds shared classes with guest cohorts.
   Boots against an ISOLATED throwaway database, dropped on exit.
   Run: bun run test:departmentisolation-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_departmentisolation_prop_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.WHATSAPP_API_KEY         = ''
process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.GOOGLE_CLIENT_ID       = ''
process.env.GOOGLE_CLIENT_SECRET   = ''
process.env.GOOGLE_REFRESH_TOKEN   = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''
process.env.GOOGLE_CALENDAR_ID     = ''
process.env.CLT_BASE_URL           = ''
process.env.RATE_LIMIT_AUTH_MAX = '5000'
process.env.RATE_LIMIT_API_MAX  = '90000'
/* Bun loads backend/.env first: blank every outside service it may configure,
   so no check here can reach a real finance, ERP, portal, payment or media API. */
for (const k of ['FINANCE_API_URL', 'FINANCE_S2S_SECRET', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET',
  'COMMISSION_API_URL', 'COMMISSION_S2S_SECRET', 'CLT_PUBLIC_URL', 'CLT_S2S_SECRET', 'SALES_CRM_SECRET',
  'SMTP_BACKUP_HOST', 'SMTP_BACKUP_USER', 'SMTP_BACKUP_PASS', 'WHATSAPP_WABA_ID', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET',
  'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'TABBY_SECRET_KEY', 'TABBY_PUBLIC_KEY', 'TAMARA_API_KEY',
  'ABZER_ACCESS_KEY', 'ABZER_SECRET_KEY', 'SENTRY_DSN', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']) {
  process.env[k] = ''
}

export {}

const SEED   = Number(process.env['SEED'] ?? Math.floor(Math.random() * 2 ** 31))
const ROUNDS = Math.max(1, Number(process.env['ROUNDS'] ?? 3))
const CROSS  = String(process.env['CROSS_ORG_CLASSES'] ?? '').toLowerCase() === 'true'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

await import('./financeStandIn.ts')   // finance-check asks finance first; this one knows everybody
const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, EnrollmentModel, LiveClassModel, ClassBookingModel,
  DeviceModel, MentorAvailabilityModel, ClassAssignmentModel, SupportTicketModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_departmentisolation_prop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

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
const code = (r: { body: any }) => String(r.body?.error?.code ?? '')
const idOf = (x: any) => String(x?.id ?? x?._id ?? x)

/* ── Randomness ───────────────────────────────────────── */
function mulberry32(a: number) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
let rnd = mulberry32(SEED)
const pick   = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!
const chance = (p: number) => rnd() < p
const subset = <T>(arr: readonly T[], max: number): T[] => {
  const pool = [...arr]; const out: T[] = []
  const n = Math.floor(rnd() * (max + 1))
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!)
  return out
}

/* ── The spec (plan.md §10.3) ─────────────────────────── */
type Dept = '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
const DEPTS: readonly Dept[] = ['4x-trading', 'digital-marketing', 'ai', 'jura']
const PROGRAM_OF: Record<Dept, string> = { '4x-trading': 'forex', 'digital-marketing': 'digital_marketing', 'ai': 'ai', 'jura': 'jura' }
/* Application picks and the department each one names — option ids from the
   signup form plus labels older forms wrote. The oracle trusts THIS table. */
const PICKS: ReadonlyArray<readonly [string, Dept]> = [
  ['forex-beginner', '4x-trading'], ['forex-advanced', '4x-trading'], ['Forex Trading', '4x-trading'],
  ['dm-seo', 'digital-marketing'], ['dm-social', 'digital-marketing'], ['Digital Marketing', 'digital-marketing'], ['Social Media Marketing', 'digital-marketing'],
  ['ai-fundamentals', 'ai'], ['ai-trading', 'ai'], ['AI & Data Science', 'ai'], ['AI Trading Automation', 'ai'],
  ['jura-core', 'jura'], ['jura-labour-law', 'jura'], ['UAE Labour Law', 'jura'],
]
const DEPT_OF_PICK = new Map(PICKS.map(([p, d]) => [p, d]))
const APPLICANT = new Set(['pending', 'rejected', 'cancelled'])

const PW = 'CorrectHorse1'
const H = 3_600_000
const pwHash = await hashPassword(PW)

/* ── One world ────────────────────────────────────────── */
type World = Awaited<ReturnType<typeof buildWorld>>

async function buildWorld(round: number) {
  await mongoose.connection.db!.dropDatabase()
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const orgs = [dubai._id, blr._id]
  const otherOrg = (o: unknown) => String(o) === String(dubai._id) ? blr._id : dubai._id
  let n = 0
  const email = (k: string) => `${k}.${round}.${++n}@prop.test`

  const user = (name: string, role: string, extra: Record<string, unknown>) =>
    UserModel.create({ name, email: email(role), passwordHash: pwHash, role, isActive: true, isVerified: true, ...extra })

  /* Staff who log in. */
  const heads: Record<string, any> = {}
  for (const d of DEPTS) heads[`dubai:${d}`] = await user(`Head ${d} Dubai`, 'sub_admin', { organizationId: dubai._id, program: PROGRAM_OF[d] })
  heads['bangalore:4x-trading'] = await user('Head 4x-trading Bangalore', 'sub_admin', { organizationId: blr._id, program: 'forex' })
  const admins = {
    [String(dubai._id)]: await user('Admin Dubai', 'admin', { organizationId: dubai._id }),
    [String(blr._id)]:   await user('Admin Bangalore', 'admin', { organizationId: blr._id }),
  }

  /* Instructors: a category, maybe extra categories, maybe none at all. */
  const instructors: any[] = []
  for (let i = 0; i < 12; i++) {
    const org = chance(0.8) ? dubai._id : blr._id
    const category = chance(0.85) ? pick(DEPTS) : undefined
    const categories = subset(DEPTS, 2)
    instructors.push(await user(`Teacher ${i}`, 'instructor', { organizationId: org, ...(category ? { category } : {}), categories }))
  }
  const instructorIn = (org: unknown) => instructors.filter(t => String(t.organizationId) === String(org))

  /* Courses: one per department per academy for coverage, then random ones,
     some with no programme. */
  const courses: any[] = []
  const mkCourse = async (org: unknown, program?: Dept) => {
    const pool = instructorIn(org); const inst = pool.length ? pick(pool) : instructors[0]
    const c = await CourseModel.create({
      title: `${program ?? 'none'} course ${courses.length}`, slug: `prop-${round}-${courses.length}-${Date.now()}`,
      description: 'd', instructorId: inst._id, price: 0, isFree: true, status: chance(0.85) ? 'published' : 'draft',
      language: 'English', organizationId: org, ...(program ? { program } : {}),
    })
    courses.push(c)
  }
  for (const org of orgs) for (const d of DEPTS) await mkCourse(org, d)
  for (let i = 0; i < 6; i++) await mkCourse(chance(0.75) ? dubai._id : blr._id, chance(0.8) ? pick(DEPTS) : undefined)
  const courseById = new Map(courses.map(c => [String(c._id), c]))
  const coursesIn = (org: unknown) => courses.filter(c => String(c.organizationId) === String(org))

  /* Students: members, applicants, enrolled-only, approved-but-once-ticked. */
  const students: any[] = []
  for (let i = 0; i < 44; i++) {
    const org = chance(0.8) ? dubai._id : blr._id
    const status = pick(['approved', 'approved', 'approved', 'pending', 'pending', 'rejected', 'cancelled'] as const)
    const member = status === 'approved' || chance(0.2)
    const categories = member ? subset(DEPTS, 2) : []
    const category = member && categories.length && chance(0.7) ? categories[0] : undefined
    const programs = chance(0.75) ? subset(PICKS.map(p => p[0]), 3) : []
    const passport = chance(0.6) ? { passportUrl: `/uploads/images/prop-${round}-${i}.jpg` } : {}
    students.push(await user(`Student ${i}`, 'student', {
      organizationId: org, enrollmentStatus: status, categories, ...(category ? { category } : {}),
      enrollmentApplication: { programs, ...passport },
    }))
  }
  const userById = new Map([...students, ...instructors, ...Object.values(heads), ...Object.values(admins)].map(u => [String(u._id), u]))

  const enrollments: Array<{ userId: string; courseId: string }> = []
  for (const s of students) {
    for (const c of subset(coursesIn(s.organizationId), 2)) {
      await EnrollmentModel.create({ userId: s._id, courseId: c._id, status: 'active', organizationId: s.organizationId })
      enrollments.push({ userId: String(s._id), courseId: String(c._id) })
    }
  }

  /* Classes: hosted by an academy on one of its courses; with the flag on,
     some are shared with the other academy through ITS course — whose
     department need not match the host's. */
  const classes: any[] = []
  for (let i = 0; i < 26; i++) {
    const host = chance(0.7) ? dubai._id : blr._id
    const course = pick(coursesIn(host))
    const pool = instructorIn(host); const inst = pool.length ? pick(pool) : instructors[0]
    const offset = (Math.floor(rnd() * 20) - 10) * 24 * H + Math.floor(rnd() * 20) * H
    const past = offset < 0
    const guest = CROSS && chance(0.35)
      ? [{ organizationId: otherOrg(host), courseId: pick(coursesIn(otherOrg(host)))._id, seatFloor: 5, seatsLeft: 5 }]
      : []
    classes.push(await LiveClassModel.create({
      title: `Class ${i}`, courseId: course._id, instructorId: inst._id, organizationId: host,
      scheduledStart: new Date(Date.now() + offset), durationMins: 60, type: 'external', isOnline: false,
      location: 'Campus', sessionCapacity: 30, language: 'English', guestCohorts: guest,
      /* host + overflow + every cohort's seats = capacity (the schema's invariant) */
      ...(guest.length ? { hostSeatsLeft: 20, overflowSeatsLeft: 5 } : {}),
      ...(past ? { status: chance(0.7) ? 'ended' : 'scheduled', ...(chance(0.5) ? { mentorNoShowAlertSent: true } : {}) } : {}),
    }))
  }
  const classById = new Map(classes.map(c => [String(c._id), c]))

  const bookings: any[] = []
  const seated = new Set<string>()
  for (let i = 0; i < 70; i++) {
    const s = pick(students), c = pick(classes)
    const key = `${s._id}:${c._id}`
    if (seated.has(key)) continue
    seated.add(key)
    bookings.push(await ClassBookingModel.create({
      userId: s._id, liveClassId: c._id, status: pick(['booked', 'booked', 'attended', 'missed', 'cancelled'] as const),
      bookedAt: new Date(Date.now() - 5 * 24 * H),
    }))
  }
  const bookingById = new Map(bookings.map(b => [String(b._id), b]))

  const assignments: any[] = []
  const assigned = new Set<string>()
  for (let i = 0; i < 18; i++) {
    const c = pick(classes)
    const s = pick(students.filter(x => String(x.organizationId) === String(c.organizationId)))
    if (!s || assigned.has(`${s._id}:${c._id}`)) continue   // one per student per class (unique index)
    assigned.add(`${s._id}:${c._id}`)
    assignments.push(await ClassAssignmentModel.create({
      studentId: s._id, liveClassId: c._id, courseId: c.courseId, instructorId: c.instructorId,
      organizationId: c.organizationId, title: `Homework ${i}`,
    }))
  }
  const assignmentById = new Map(assignments.map(a => [String(a._id), a]))

  const tickets: any[] = []
  for (let i = 0; i < 22; i++) {
    const s = pick(students)
    const program = chance(0.7) ? pick(DEPTS) : undefined
    tickets.push(await SupportTicketModel.create({
      userId: s._id, subject: `Ticket ${i}`, category: 'technical', organizationId: s.organizationId,
      ...(program ? { program } : {}),
      messages: [{ senderId: s._id, senderRole: 'student', body: 'help', createdAt: new Date() }],
    }))
  }
  const ticketById = new Map(tickets.map(t => [String(t._id), t]))

  const devices: any[] = []
  for (let i = 0; i < 24; i++) {
    const s = pick(students)
    devices.push(await DeviceModel.create({ userId: s._id, deviceId: `prop-dev-${round}-${i}`, status: pick(['pending', 'approved'] as const) }))
  }
  const deviceById = new Map(devices.map(d => [String(d._id), d]))
  for (const t of instructors) if (chance(0.5)) await MentorAvailabilityModel.create({ mentorId: t._id, slots: [] })

  /* ── The oracle ── */
  const memberOf = (u: any, d: Dept) => u?.category === d || (u?.categories ?? []).includes(d)
  const enrolledOn = (u: any, d: Dept) => enrollments.some(e => e.userId === String(u?._id) && courseById.get(e.courseId)?.program === d)
  const appliedTo = (u: any, d: Dept) => APPLICANT.has(String(u?.enrollmentStatus)) &&
    (u?.enrollmentApplication?.programs ?? []).some((p: string) => DEPT_OF_PICK.get(p) === d)
  const reach = (u: any, d: Dept) => memberOf(u, d) || appliedTo(u, d) || enrolledOn(u, d)
  const classBelongs = (c: any, d: Dept, org: string) => !!c && (
    (String(c.organizationId) === org && courseById.get(String(c.courseId))?.program === d) ||
    (CROSS && (c.guestCohorts ?? []).some((g: any) => String(g.organizationId) === org && courseById.get(String(g.courseId))?.program === d)))
  const ticketBelongs = (t: any, d: Dept) => !!t && (t.program === d || (!t.program && memberOf(userById.get(String(t.userId)), d)))

  return {
    dubai, blr, heads, admins, students, instructors, courses, classes, bookings, assignments, tickets, devices,
    courseById, userById, classById, bookingById, assignmentById, ticketById, deviceById,
    memberOf, enrolledOn, appliedTo, reach, classBelongs, ticketBelongs,
  }
}

/* ── Reading a whole list ─────────────────────────────── */
async function walk(jar: Jar, path: string) {
  const items: any[] = []; const seen = new Set<string>(); let dups = 0; let total: number | undefined
  for (let page = 1; page <= 60; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await call('GET', `${path}${sep}page=${page}&per_page=100`, { jar })
    if (r.status !== 200) return { status: r.status, code: code(r), items, dups, total }
    const data: any[] = Array.isArray(r.body?.data) ? r.body.data : []
    for (const x of data) { const id = idOf(x); if (seen.has(id)) dups++; seen.add(id); items.push(x) }
    total = r.body?.meta?.total_count
    if (!r.body?.meta?.has_next || data.length === 0) break
  }
  return { status: 200, code: '', items, dups, total }
}

const day = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 10)
type ListSpec = { key: string; path: string; belongs: (w: World, id: string, d: Dept, org: string) => boolean }
const LISTS: ListSpec[] = [
  { key: 'courses', path: '/admin/courses?status=all',
    belongs: (w, id, d) => w.courseById.get(id)?.program === d },
  { key: 'instructors', path: '/admin/users?role=instructor',
    belongs: (w, id, d) => w.memberOf(w.userById.get(id), d) },
  { key: 'students', path: '/admin/users?role=student',
    belongs: (w, id, d) => w.memberOf(w.userById.get(id), d) || w.enrolledOn(w.userById.get(id), d) },
  { key: 'requests:pending', path: '/admin/enrollment-requests?status=pending',
    belongs: (w, id, d) => w.reach(w.userById.get(id), d) },
  { key: 'requests:rejected', path: '/admin/enrollment-requests?status=rejected',
    belongs: (w, id, d) => w.reach(w.userById.get(id), d) },
  { key: 'requests:all', path: '/admin/enrollment-requests?status=all',
    /* an approved row answers the approval question (categories), as the approved tab does */
    belongs: (w, id, d) => {
      const u = w.userById.get(id)
      return u?.enrollmentStatus === 'approved' ? w.memberOf(u, d) : w.reach(u, d)
    } },
  { key: 'requests:approved', path: '/admin/enrollment-requests?status=approved',
    belongs: (w, id, d) => w.memberOf(w.userById.get(id), d) },
  { key: 'live-classes', path: '/admin/live-classes?status=all&limit=2000',
    belongs: (w, id, d, org) => w.classBelongs(w.classById.get(id), d, org) },
  { key: 'no-shows', path: '/admin/live-classes/no-shows',
    belongs: (w, id, d, org) => w.classBelongs(w.classById.get(id), d, org) },
  { key: 'bookings', path: `/admin/bookings?dateFrom=${day(-40 * 24 * H)}&dateTo=${day(40 * 24 * H)}`,
    belongs: (w, id, d, org) => w.classBelongs(w.classById.get(String(w.bookingById.get(id)?.liveClassId)), d, org) },
  { key: 'assignments', path: '/class-assignments/review?status=all',
    belongs: (w, id, d) => w.courseById.get(String(w.assignmentById.get(id)?.courseId))?.program === d },
  { key: 'support', path: '/support/admin?status=all',
    belongs: (w, id, d) => w.ticketBelongs(w.ticketById.get(id), d) },
  { key: 'devices', path: '/admin/devices',
    belongs: (w, id, d) => w.reach(w.userById.get(String(w.deviceById.get(id)?.userId)), d) },
]

const login = async (u: any) => {
  const jar: Jar = new Map()
  const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW } })
  if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${JSON.stringify(r.body)}`)
  return jar
}

console.log(`departmentisolation.property — SEED=${SEED} ROUNDS=${ROUNDS} CROSS_ORG_CLASSES=${CROSS}`)
const coverage: Record<string, number> = {}

try {
  for (let round = 1; round <= ROUNDS; round++) {
    rnd = mulberry32(SEED + round * 7919)
    const w = await buildWorld(round)
    section(`Round ${round} (seed ${SEED} · world of ${w.students.length} students, ${w.classes.length} classes, ${w.bookings.length} seats)`)

    const jars: Record<string, Jar> = {}
    for (const [k, u] of Object.entries(w.heads)) jars[k] = await login(u)
    const adminJar: Record<string, Jar> = {}
    for (const [org, u] of Object.entries(w.admins)) adminJar[org] = await login(u)

    /* 1. Every list, every head, against the admin's view. */
    const seqResult = new Map<string, string>()
    for (const L of LISTS) {
      const adminViews: Record<string, Awaited<ReturnType<typeof walk>>> = {}
      for (const org of Object.keys(w.admins)) adminViews[org] = await walk(adminJar[org]!, L.path)
      for (const [k, u] of Object.entries(w.heads)) {
        const d = k.split(':')[1] as Dept
        const org = String(u.organizationId)
        const A = adminViews[org]!
        const Hv = await walk(jars[k]!, L.path)
        if (A.status !== 200 || Hv.status !== 200) {
          check(`${L.key} · ${k}: both views load`, false, `admin ${A.status} ${A.code} / head ${Hv.status} ${Hv.code}`)
          continue
        }
        const expected = new Set(A.items.map(idOf).filter(id => L.belongs(w, id, d, org)))
        const got = new Set(Hv.items.map(idOf))
        const leaks = [...got].filter(id => !expected.has(id))
        const missing = [...expected].filter(id => !got.has(id))
        coverage[L.key] = (coverage[L.key] ?? 0) + expected.size
        const nm = (id: string) => w.userById.get(id)?.name ?? w.classById.get(id)?.title ?? w.courseById.get(id)?.title ?? w.ticketById.get(id)?.subject ?? id
        check(`${L.key} · ${k}: exactly the department's rows (${expected.size})`,
          leaks.length === 0 && missing.length === 0,
          `leaks=[${leaks.slice(0, 3).map(nm).join(', ')}] missing=[${missing.slice(0, 3).map(nm).join(', ')}]`)
        if (Hv.total !== undefined) {
          check(`${L.key} · ${k}: paging adds up (${Hv.items.length} = total ${Hv.total}, no duplicates)`,
            Hv.items.length === Hv.total && Hv.dups === 0, `items=${Hv.items.length} total=${Hv.total} dups=${Hv.dups}`)
        }
        seqResult.set(`${L.key}|${k}`, [...got].sort().join(','))
      }
    }

    /* 2. The approved tab agrees with the "all" tab's approved rows. */
    for (const [k] of Object.entries(w.heads)) {
      const all = await walk(jars[k]!, '/admin/enrollment-requests?status=all')
      const appr = await walk(jars[k]!, '/admin/enrollment-requests?status=approved')
      const fromAll = new Set(all.items.filter(u => u.enrollmentStatus === 'approved').map(idOf))
      const tab = new Set(appr.items.map(idOf))
      const onlyAll = [...fromAll].filter(id => !tab.has(id)).map(id => w.userById.get(id)?.name ?? id)
      const onlyTab = [...tab].filter(id => !fromAll.has(id)).map(id => w.userById.get(id)?.name ?? id)
      check(`requests · ${k}: the approved tab = the approved rows of the "all" tab`,
        onlyAll.length === 0 && onlyTab.length === 0, `only in all=[${onlyAll.slice(0, 3)}] only in approved=[${onlyTab.slice(0, 3)}]`)
    }

    /* 3. Detail endpoints open exactly for the department's records. */
    const sample = <T>(arr: T[], k: number) => subset(arr, Math.min(k, arr.length)).concat(arr.slice(0, 2))
    for (const [k, u] of Object.entries(w.heads)) {
      const d = k.split(':')[1] as Dept
      const org = String(u.organizationId)
      const jar = jars[k]!
      const sameOrg = (x: any) => String(x.organizationId) === org
      const bad: string[] = []
      for (const c of sample(w.classes.filter(c => sameOrg(c) || (c.guestCohorts ?? []).some((g: any) => String(g.organizationId) === org)), 6)) {
        const r = await call('GET', `/admin/live-classes/${c._id}`, { jar })
        const ok = w.classBelongs(c, d, org) ? r.status === 200 : (r.status === 403 || r.status === 404)
        if (!ok) bad.push(`class ${c.title} → ${r.status}`)
      }
      for (const c of sample(w.courses.filter(sameOrg), 5)) {
        const r = await call('GET', `/admin/courses/${c._id}/students`, { jar })
        const ok = c.program === d ? r.status === 200 : r.status === 404
        if (!ok) bad.push(`roster ${c.title} → ${r.status}`)
      }
      for (const t of sample(w.tickets.filter(sameOrg), 6)) {
        const r = await call('GET', `/support/${t._id}`, { jar })
        const ok = w.ticketBelongs(t, d) ? r.status === 200 : (r.status === 403 || r.status === 404)
        if (!ok) bad.push(`ticket ${t.subject} → ${r.status}`)
      }
      for (const a of sample(w.assignments.filter(sameOrg), 5)) {
        const r = await call('GET', `/class-assignments/${a._id}`, { jar })
        const own = w.courseById.get(String(a.courseId))?.program === d
        const ok = own ? r.status === 200 : (r.status === 403 || r.status === 404)
        if (!ok) bad.push(`assignment ${a.title} → ${r.status}`)
      }
      for (const s of sample(w.students.filter(s => sameOrg(s) && s.enrollmentApplication?.passportUrl), 6)) {
        const r = await call('GET', `/documents/${s._id}/passport`, { jar })
        const ok = w.reach(s, d) ? r.status === 200 : r.status === 404
        if (!ok) bad.push(`passport of ${s.name} (${s.enrollmentStatus}) → ${r.status}`)
      }
      for (const s of sample(w.students.filter(sameOrg), 6)) {
        const r = await call('GET', `/admin/enrollment-requests/${s._id}/finance-check`, { jar })
        const ok = w.reach(s, d) ? r.status !== 404 : r.status === 404
        if (!ok) bad.push(`finance-check of ${s.name} (${s.enrollmentStatus}) → ${r.status}`)
      }
      for (const t of sample(w.instructors.filter(sameOrg), 5)) {
        const r = await call('GET', `/admin/mentors/${t._id}/availability`, { jar })
        const ok = w.memberOf(t, d) ? r.status === 200 : r.status === 404
        if (!ok) bad.push(`availability of ${t.name} → ${r.status}`)
      }
      for (const s of sample(w.students.filter(sameOrg), 4)) {
        const r = await call('GET', `/admin/users/${s._id}/enrollments`, { jar })
        const foreign = (r.body?.data ?? []).filter((e: any) => w.courseById.get(idOf(e.courseId))?.program !== d)
        if (r.status === 200 && foreign.length) bad.push(`enrolments of ${s.name} show ${foreign.length} other-department course(s)`)
      }
      const self = await call('GET', `/admin/mentors/${u._id}/meetings`, { jar })
      if (self.status !== 200) bad.push(`own meetings → ${self.status}`)
      check(`details · ${k}: every record opens exactly when it is the department's`, bad.length === 0, bad.slice(0, 4).join('; '))
    }

    /* 4. The same lists, every head at once — nothing memoised crosses requests. */
    {
      const jobs: Array<Promise<{ key: string; ids: string }>> = []
      for (let rep = 0; rep < 2; rep++) {
        for (const L of LISTS) {
          for (const k of Object.keys(w.heads)) {
            jobs.push(walk(jars[k]!, L.path).then(r => ({ key: `${L.key}|${k}`, ids: r.items.map(idOf).sort().join(',') })))
          }
        }
      }
      const results = await Promise.all(jobs)
      const off = results.filter(r => seqResult.has(r.key) && seqResult.get(r.key) !== r.ids).map(r => r.key)
      check(`concurrency: ${results.length} interleaved list reads by ${Object.keys(w.heads).length} heads match their one-at-a-time answers`,
        off.length === 0, off.slice(0, 4).join('; '))
    }

    /* 5. A head's department follows their record on the very next request. */
    if (round === ROUNDS) {
      const k = 'dubai:digital-marketing'; const u = w.heads[k]; const jar = jars[k]!
      const ids = async () => (await walk(jar, '/admin/courses?status=all')).items.map(idOf).sort().join(',')
      const expectFor = (d: Dept) => w.courses.filter(c => String(c.organizationId) === String(u.organizationId) && c.program === d).map(c => String(c._id)).sort().join(',')
      const before = await ids()
      await UserModel.updateOne({ _id: u._id }, { $set: { program: 'ai' } })
      const moved = await ids()
      await UserModel.updateOne({ _id: u._id }, { $unset: { program: 1 } })
      const removed = await call('GET', '/admin/courses?status=all', { jar })
      await UserModel.updateOne({ _id: u._id }, { $set: { program: 'digital_marketing', isActive: false } })
      const inactive = await call('GET', '/admin/courses?status=all', { jar })
      await UserModel.updateOne({ _id: u._id }, { $set: { isActive: true, role: 'admin' } })
      const promoted = await walk(jar, '/admin/courses?status=all')
      await UserModel.updateOne({ _id: u._id }, { $set: { role: 'sub_admin' } })
      const back = await ids()
      const adminAll = (await walk(adminJar[String(u.organizationId)]!, '/admin/courses?status=all')).items.map(idOf).sort().join(',')
      section('Transitions (on the live session, no new login)')
      check('T1 the DM head sees DM courses', before === expectFor('digital-marketing'))
      check('T2 moved to AI → AI courses on the next request', moved === expectFor('ai'), moved)
      check('T3 department removed → 403 NO_DEPARTMENT at once', removed.status === 403 && code(removed) === 'NO_DEPARTMENT', `${removed.status} ${code(removed)}`)
      check('T4 deactivated → refused at once', inactive.status === 401 || inactive.status === 403, `${inactive.status} ${code(inactive)}`)
      check('T5 promoted to admin → every course of the academy', promoted.items.map(idOf).sort().join(',') === adminAll)
      check('T6 back to a DM sub-admin → DM courses again', back === expectFor('digital-marketing'))
    }
  }

  section('Coverage — department rows the property was checked against, summed over heads and rounds')
  for (const L of LISTS) {
    check(`${L.key}: ${coverage[L.key] ?? 0} expected rows`, (coverage[L.key] ?? 0) > 0, 'the generator produced nothing to compare — the property would be vacuous')
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  server.close()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ndepartmentisolation.property.suite — ${pass} passed, ${fail} failed  (SEED=${SEED}${CROSS ? ', CROSS_ORG_CLASSES' : ''})`)
process.exit(fail === 0 ? 0 : 1)
