/* ─────────────────────────────────────────────────────────────
   ADMIN MATRIX — every section, every staff role, both academies.

   The functional sweep (smoke.suite.ts) answered "does the admin panel work?"
   by driving ONE role through ONE path per section: 19 of 105 admin endpoints,
   and 4 of the 9 roles. This suite answers the harder question — **what can
   each role actually do in each section, and does anything break for anyone?**

   Two roles had never been exercised at all: sub_admin and support (along
   with the three programme-admin roles since folded into sub_admin). Those
   are precisely the roles most
   likely to hit a guard nobody tried, because the codebase treats them
   inconsistently — some route lists name them explicitly, some rely on
   `isFullAdmin`, some forget them entirely (that was P-21).

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_matrix_suite), dropped on exit. The real `lms` database is never opened.

   THREE PROPERTIES ARE ASSERTED, and they are deliberately the ones that do
   not require inventing a permissions policy:

     1. NOTHING returns 5xx, for any role, on any endpoint. A server error is
        a defect regardless of what the policy should be.
     2. A student NEVER gets 2xx from an admin endpoint. That is the boundary
        the whole admin portal rests on.
     3. Every role that CAN sign in to the admin portal can load the sections
        its sidebar offers it — a guard that refuses something it should allow
        breaks the product just as surely as the reverse.

   The full role x endpoint grid is printed either way, because the surprises
   live in the cells nobody predicted.

   Run: bun run test:adminmatrix
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_matrix_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

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
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LessonModel,
  CouponModel, LiveClassModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_matrix_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  /* Store what the server sets, or the jar stays empty and every request after
     login is anonymous — which reads as "every role is denied everything". */
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'

/* Every staff role the admin router admits, plus student as the negative. */
const ROLES = [
  'super_admin', 'admin', 'sub_admin', 'support', 'instructor', 'student',
] as const
type Role = typeof ROLES[number]

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const users: Record<Role, any> = {} as any
  for (const role of ROLES) {
    users[role] = await UserModel.create({
      name: role, email: `${role}@t.local`, passwordHash: hash, role,
      isActive: true, organizationId: dubai._id,
      ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
      ...(role === 'sub_admin' ? { program: 'ai' } : {}),
    })
  }
  /* A second academy, for the cross-tenant probes. */
  const blrAdmin  = await UserModel.create({ name: 'blr admin', email: 'blr.admin@t.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: blr._id })
  const blrTeacher = await UserModel.create({ name: 'blr teacher', email: 'blr.teacher@t.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: blr._id })

  /* Fixtures in BOTH academies so cross-tenant reads have something to miss. */
  const mkCourse = async (org: unknown, teacher: unknown, title: string) => {
    const c = await CourseModel.create({
      title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
      description: 'A seeded course used by the admin matrix suite.',
      price: 100, isFree: false, status: 'published', language: 'English',
      instructorId: teacher, organizationId: org,
    })
    const s = await SectionModel.create({ courseId: c._id, title: 'Module 1', order: 1 })
    const l = await LessonModel.create({ courseId: c._id, sectionId: s._id, title: 'Lesson 1', type: 'article', order: 1 })
    return { c, s, l }
  }
  const dxb = await mkCourse(dubai._id, users['instructor']._id, 'Dubai Course')
  const bng = await mkCourse(blr._id, blrTeacher._id, 'Bangalore Course')

  await CouponModel.create({ code: 'MATRIX10', discountType: 'percent', discountValue: 10, organizationId: dubai._id, currency: 'AED' })
  await LiveClassModel.create({
    courseId: dxb.c._id, title: 'Matrix Live', scheduledStart: new Date(Date.now() + 86_400_000),
    durationMins: 60, type: 'external', instructorId: users['instructor']._id,
    organizationId: dubai._id, language: 'English', status: 'scheduled',
  })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    return { jar, status: r.status, code: r.body?.error?.code }
  }

  /* ── Every section the sidebar offers, as a readable probe ───────────── */
  const READS: [string, string][] = [
    ['dashboard',       '/admin/stats'],
    ['analytics',       '/admin/analytics/enrollments'],
    ['users',           '/admin/users?page=1&per_page=5'],
    ['requests',        '/admin/enrollment-requests'],
    ['express members', '/admin/express-members'],
    ['courses',         '/admin/courses?page=1&per_page=5'],
    ['course detail',   `/admin/courses/${dxb.c._id}`],
    ['outline',         `/admin/courses/${dxb.c._id}/outline`],
    ['sections',        `/admin/courses/${dxb.c._id}/sections`],
    ['categories',      '/admin/categories'],
    ['learning paths',  '/learning-paths/admin/list'],
    ['live classes',    '/admin/live-classes'],
    ['bookings',        '/admin/bookings'],
    ['students',        '/admin/users?role=student&page=1&per_page=5'],
    ['instructors',     '/admin/users?role=instructor&page=1&per_page=5'],
    ['reviews',         '/admin/reviews'],
    ['orders',          '/admin/orders'],
    ['coupons',         '/admin/coupons'],
    ['announcements',   '/admin/announcements'],
    ['reports',         '/admin/reports/attendance'],
    ['support',         '/support/admin'],
    ['audit logs',      '/audit-logs'],
    ['impersonations',  '/admin/impersonation-sessions'],
  ]

  /* ── Writes, one per section, against disposable fixtures ────────────── */
  const WRITES = (tag: string, disposableId: string): [string, string, string, unknown][] => ([
    ['create category', 'POST',   '/admin/categories',                    { name: `Cat ${tag}` }],
    ['create coupon',   'POST',   '/admin/coupons',                       { code: `C${tag}`.slice(0, 18), discountType: 'percent', discountValue: 5 }],
    ['create course',   'POST',   '/admin/courses',                       { title: `Course ${tag}`, slug: `course-${tag}`.toLowerCase(), description: 'Seeded by the admin matrix suite for write probes.', price: 10, isFree: false, status: 'draft', language: 'English' }],
    ['edit course',     'PATCH',  `/admin/courses/${dxb.c._id}`,          { title: `Edited by ${tag}` }],
    ['add section',     'POST',   `/admin/courses/${dxb.c._id}/sections`, { title: `Sec ${tag}` }],
    ['edit lesson',     'PATCH',  `/admin/lessons/${dxb.l._id}`,          { title: `Lesson ${tag}` }],
    ['create user',     'POST',   '/admin/users',                         { name: `New ${tag}`, email: `new-${tag}@t.local`.toLowerCase(), password: 'CorrectHorse1', role: 'instructor' }],
    ['delete course',   'DELETE', `/admin/courses/${disposableId}`,       undefined],
  ])

  /* One disposable course per role. The delete probe used to target the
     Bangalore fixture, so whichever role succeeded removed it — and the
     cross-academy section that ran later failed on a 404 of its own making. */
  const disposable: Record<string, any> = {}
  for (const role of ROLES) {
    disposable[role] = (await mkCourse(dubai._id, users['instructor']._id, `Disposable ${role}`)).c
  }

  const grid: Record<string, Record<string, number | string>> = {}

  section('SIGN-IN — which roles may reach the admin portal at all')
  const jars: Partial<Record<Role, Jar>> = {}
  for (const role of ROLES) {
    const { jar, status, code } = await login(`${role}@t.local`)
    if (role === 'student') {
      check('a student is refused the admin portal', status !== 200, `got ${status} ${code ?? ''}`)
    } else {
      check(`${role} can sign in to the admin portal`, status === 200, `got ${status} ${code ?? ''}`)
      if (status === 200) jars[role] = jar
    }
  }

  section('READ MATRIX — every section, every role that got in')
  for (const role of ROLES) {
    const jar = jars[role]
    grid[role] = {}
    for (const [name, url] of READS) {
      if (!jar) { grid[role]![name] = 'no-session'; continue }
      const r = await call('GET', url, { jar })
      grid[role]![name] = r.status
      check(`${role} · ${name} does not 5xx`, r.status < 500, `${r.status} ${r.body?.error?.code ?? ''}`)
    }
  }

  section('READ MATRIX — the roles the product is built around can load their sections')
  for (const role of ['super_admin', 'admin'] as const) {
    for (const [name] of READS) {
      const got = grid[role]![name]
      check(`${role} can load ${name}`, got === 200, String(got))
    }
  }

  section('WRITE MATRIX — one write per section, per role')
  for (const role of ROLES) {
    const jar = jars[role]
    if (!jar) continue
    for (const [name, method, url, body] of WRITES(role.replace(/_/g, ''), String(disposable[role]._id))) {
      const r = await call(method, url, { jar, ...(body !== undefined ? { body } : {}) })
      grid[role]![`W:${name}`] = r.status
      check(`${role} · ${name} does not 5xx`, r.status < 500, `${r.status} ${r.body?.error?.code ?? ''}`)
    }
  }

  section('ESCALATION — no lesser role may mint an account above itself')
  {
    /* The grid shows every staff role below admin can POST /admin/users and
       get a 201. That is only safe if the TARGET role is constrained, so probe
       the constraint directly rather than trusting the reading of it. */
    const ladder: [Role, string[], string[]][] = [
      /* role, must be REFUSED these targets, may CREATE these */
      ['support',                 ['super_admin', 'admin', 'sub_admin'], ['student', 'instructor']],
      ['sub_admin',               ['super_admin', 'admin'],              ['instructor']],
      ['admin',                   ['super_admin'],                       ['instructor', 'admin']],
      ['instructor',              ['super_admin', 'admin', 'instructor'], []],
    ]
    let n = 0
    for (const [role, refused, allowed] of ladder) {
      const jar = jars[role]
      if (!jar) continue
      for (const target of refused) {
        const r = await call('POST', '/admin/users', { jar, body: {
          name: `esc ${n}`, email: `esc-${role}-${target}-${n++}@t.local`, password: PW, role: target,
        } })
        check(`${role} cannot create a ${target}`, r.status === 403, `got ${r.status} ${r.body?.error?.code ?? ''}`)
        if (r.status < 300) {
          const made = await UserModel.findOne({ email: `esc-${role}-${target}-${n - 1}@t.local` }).lean()
          check(`...and no ${target} account exists as a result`, !made, 'ACCOUNT WAS CREATED')
        }
      }
      for (const target of allowed) {
        const r = await call('POST', '/admin/users', { jar, body: {
          name: `ok ${n}`, email: `ok-${role}-${target}-${n++}@t.local`, password: PW, role: target,
        } })
        check(`${role} may still create a ${target}`, r.status < 300, `got ${r.status} ${r.body?.error?.code ?? ''}`)
      }
    }
  }

  section('CATALOGUE INTEGRITY — who can publish a course to the public site')
  {
    /* POST /admin/courses carries no role gate; the grid shows support and the
       programme admins all get 201. The question that matters is not whether
       they can create a row, but whether it reaches the PUBLIC catalogue. */
    /* Roles that must NOT be able to author a course, because they cannot
       manage one afterwards (assertCourseEditable refuses them).

       sub_admin is on this list, and after the legacy programme-admin roles
       were folded into it that list is now EVERY non-super staff role below
       `admin`. If sub_admin is ever granted programme-scoped course editing,
       it must move out of here and into requireCourseAuthor at the same time —
       the two must never disagree, which is what the block below checks. */
    const mayNotAuthor = ['support', 'sub_admin'] as const
    for (const role of mayNotAuthor) {
      const jar = jars[role]
      if (!jar) continue
      /* Underscores are illegal in a slug, and every one of these role names
         has one. The first version of this probe pasted the role straight in,
         so each of these roles answered 422 for a malformed slug and the
         probe recorded "refused" — it never reached the guard it was written
         to test. */
      const slug = `pub-${role.replace(/_/g, '-')}-${Date.now()}`.toLowerCase()
      const r = await call('POST', '/admin/courses', { jar, body: {
        title: `Published by ${role}`, slug,
        description: 'Created by a lesser role to see whether it reaches the public catalogue.',
        price: 0, isFree: true, status: 'published', language: 'English',
      } })
      check(`${role} is refused course creation`, r.status === 403,
        `got ${r.status} ${r.body?.error?.code ?? ''}`)
      if (r.status !== 201) continue

      /* It was created despite the guard. Now the question that decides the
         severity: can an anonymous visitor see it?

         The first version of this probe asked with `?search=…` and concluded
         "not visible" — a false negative, because the search simply did not
         match. It reported clean while a support account genuinely had a
         published course on the public site. So: no search filter, a large
         page, AND a direct slug fetch, which is how anyone with the link
         would reach it. */
      const publicList = await call('GET', '/courses?per_page=100')
      const inCatalogue = JSON.stringify(publicList.body?.data ?? '').includes(slug)
      const direct = await call('GET', `/courses/${slug}`)
      check(`${role}'s published course is NOT on the public catalogue`, !inCatalogue,
        inCatalogue ? 'VISIBLE to anonymous visitors' : 'absent')
      check(`${role}'s published course is NOT fetchable by slug`, direct.status !== 200,
        `got ${direct.status}`)
    }

    /* The other half of the rule: whoever CAN manage a course must still be
       able to create one. A guard that over-refuses breaks the product.

       Below super_admin that is now `admin` alone — the two programme-admin
       roles that used to appear here were folded into sub_admin, which has
       never been able to edit a course. */
    {
      const jar = jars['admin']
      if (jar) {
        const slug = `ok-admin-${Date.now()}`.toLowerCase()
        const r = await call('POST', '/admin/courses', { jar, body: {
          title: 'Authored by admin', slug,
          description: 'An academy admin authoring a course, which it may also edit.',
          price: 0, isFree: true, status: 'draft', language: 'English',
        } })
        check('admin may still author a course', r.status !== 403,
          `got ${r.status} ${r.body?.error?.code ?? ''}`)
      }
    }
  }

  section('BOUNDARY — a student gets nothing from the admin API')
  {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email: 'student@t.local', password: PW } })
    check('the student can sign in to the CLIENT portal', r.status === 200, String(r.status))
    for (const [name, url] of READS) {
      const rr = await call('GET', url, { jar })
      check(`student is refused ${name}`, rr.status !== 200, `got ${rr.status}`)
    }
  }

  section('CROSS-ACADEMY — a Dubai admin must not reach Bangalore, and vice versa')
  {
    const { jar: blrJar, status } = await login('blr.admin@t.local')
    check('the Bangalore admin can sign in', status === 200, String(status))
    if (status === 200) {
      const foreignCourse = await call('GET', `/admin/courses/${dxb.c._id}`, { jar: blrJar })
      check('Bangalore admin cannot read a Dubai course', foreignCourse.status >= 400, `got ${foreignCourse.status}`)
      const foreignEdit = await call('PATCH', `/admin/courses/${dxb.c._id}`, { jar: blrJar, body: { title: 'hijacked' } })
      check('Bangalore admin cannot edit a Dubai course', foreignEdit.status >= 400, `got ${foreignEdit.status}`)
      const foreignUser = await call('PATCH', `/admin/users/${users['instructor']._id}`, { jar: blrJar, body: { name: 'hijacked' } })
      check('Bangalore admin cannot edit a Dubai user', foreignUser.status >= 400, `got ${foreignUser.status}`)
      const own = await call('GET', `/admin/courses/${bng.c._id}`, { jar: blrJar })
      check('...but CAN read its own academy\'s course', own.status === 200, `got ${own.status}`)
    }
  }

  section('DIFFERENT WAYS — pagination, filters, search and odd input')
  {
    const jar = jars['admin']!
    const variants: [string, string][] = [
      ['page 2',              '/admin/users?page=2&per_page=3'],
      ['huge per_page',       '/admin/users?page=1&per_page=100000'],
      ['zero page',           '/admin/users?page=0&per_page=5'],
      ['negative page',       '/admin/users?page=-3&per_page=5'],
      ['non-numeric page',    '/admin/users?page=abc&per_page=xyz'],
      ['search term',         '/admin/users?search=admin'],
      ['regex-ish search',    '/admin/users?search=.*'],
      ['long search',         `/admin/users?search=${'a'.repeat(500)}`],
      ['course status filter','/admin/courses?status=draft'],
      ['bogus status filter', '/admin/courses?status=not-a-status'],
      ['course sort',         '/admin/courses?sort=price_hi'],
      ['bogus sort',          '/admin/courses?sort=;drop'],
      ['orders filter',       '/admin/orders?status=all&page=1&per_page=10'],
      ['bookings range',      '/admin/bookings?dateFrom=2026-01-01&dateTo=2026-12-31'],
      ['bad date range',      '/admin/bookings?dateFrom=notadate&dateTo=alsonot'],
    ]
    for (const [name, url] of variants) {
      const r = await call('GET', url, { jar })
      check(`admin · ${name} does not 5xx`, r.status < 500, `${r.status} ${r.body?.error?.code ?? ''}`)
    }
  }

  /* ── The grid itself, printed for inspection ─────────────────────────── */
  const cols = [...READS.map(([n]) => n), ...WRITES('x', 'x').map(([n]) => `W:${n}`)]
  lines.push('\n──── ROLE × SECTION GRID (HTTP status; 200 = allowed) ────')
  for (const role of ROLES) {
    const row = cols.map(c => `${c}=${grid[role]?.[c] ?? '-'}`).join('  ')
    lines.push(`\n  ${role}\n    ${row}`)
  }

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\n──── EVERY FAILURE ────')
  failures.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`))
}
process.exit(failures.length === 0 ? 0 : 1)
