/* ─────────────────────────────────────────────────────────────
   Which academy does an account created from the admin panel belong to?

   It used to be whatever `req.user.organizationId` happened to be. For a
   scoped admin that is their own academy and the answer is right by accident.
   For a SUPER ADMIN it is the org switcher in the topbar — and the switcher's
   default position is "All Orgs", which sends no header at all. Creating a
   student from there returned 201 and produced an account belonging to no
   academy: invisible in every academy's student list, forever, with nothing
   on screen to say so. Passing `organizationId` in the body did not help
   either — it was silently dropped.

   The rule now:

     · a super_admin states the academy; the switcher supplies a default
     · anyone else gets their own, and naming a different one is refused
       rather than ignored — that is a cross-tenant write
     · every role except super_admin must end up with an academy

   Run: bun run test:orgassignment
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_orgassignment'
await import('./financeStandIn.ts')   // approving a student asks finance first; this one knows everybody
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
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, CourseModel, EnrollmentModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_orgassignment') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(
  method: string, path: string,
  opts: { jar?: Jar; body?: unknown; org?: string } = {},
) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.org !== undefined)  headers['x-organization-id'] = opts.org
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
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@oa.local`
const orgOf = async (e: string): Promise<string | null> => {
  const u = await UserModel.findOne({ email: e }).select('organizationId').lean() as any
  return u?.organizationId ? String(u.organizationId) : null
}
const code = (r: { body: any }) => r.body?.error?.code

try {
  const dubai = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const bangalore = await OrganizationModel.create({
    name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer',
  })
  const D = String(dubai._id), B = String(bangalore._id)
  const hash = await hashPassword(PW)

  const mk = (e: string, role: string, org?: string, program?: string) => UserModel.create({
    name: e, email: e, passwordHash: hash, role, isActive: true,
    ...(org ? { organizationId: org } : {}), ...(program ? { program } : {}),
  })

  /* A super admin belonging to no academy — the account this bug is about. */
  await mk('root@oa.local', 'super_admin')
  await mk('dubai.admin@oa.local', 'admin', D)
  await mk('blr.admin@oa.local',   'admin', B)
  await mk('dubai.sub@oa.local',   'sub_admin', D, 'ai')

  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: e, password: PW } })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const rootJar  = await login('root@oa.local')
  const dubaiJar = await login('dubai.admin@oa.local')
  const blrJar   = await login('blr.admin@oa.local')
  const subJar   = await login('dubai.sub@oa.local')

  const student = (e: string, extra: Record<string, unknown> = {}) => ({
    name: 'Student One', email: e, password: PW, role: 'student',
    categories: ['ai'], ...extra,
  })

  /* ═══════════════════════════════════════════════ */
  section('A · the bug: a super admin on "All Orgs" could create a homeless account')
  {
    const e = email('all-orgs')
    const r = await call('POST', '/admin/users', { jar: rootJar, body: student(e) })
    check('creating a student with no academy is now REFUSED', r.status === 400, String(r.status))
    check('and says which field is missing', code(r) === 'ORGANIZATION_REQUIRED', code(r))
    check('no account was created', await UserModel.countDocuments({ email: e }) === 0)
  }

  /* ═══════════════════════════════════════════════ */
  section('B · a super admin states the academy in the request')
  {
    const e = email('explicit')
    const r = await call('POST', '/admin/users', { jar: rootJar, body: student(e, { organizationId: D }) })
    check('the account is created', r.status === 201, `${r.status} ${code(r)}`)
    check('and it belongs to the academy asked for', await orgOf(e) === D, String(await orgOf(e)))

    const e2 = email('explicit-blr')
    await call('POST', '/admin/users', { jar: rootJar, body: student(e2, { organizationId: B }) })
    check('a second one lands in the OTHER academy — the choice is real, not cosmetic',
      await orgOf(e2) === B, String(await orgOf(e2)))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · the topbar switcher still supplies a default')
  {
    const e = email('switcher')
    const r = await call('POST', '/admin/users', { jar: rootJar, body: student(e), org: D })
    check('with the switcher on Dubai and nothing in the body, it still works',
      r.status === 201, `${r.status} ${code(r)}`)
    check('and lands in Dubai', await orgOf(e) === D, String(await orgOf(e)))

    /* An unselected picker sends an empty string. That means "not chosen",
       so the switcher must still apply rather than the request being refused
       for naming nothing. */
    const e3 = email('empty-string')
    const blank = await call('POST', '/admin/users',
      { jar: rootJar, body: student(e3, { organizationId: '' }), org: D })
    check('an empty academy field falls back to the switcher, not a refusal',
      blank.status === 201 && await orgOf(e3) === D, `${blank.status} ${await orgOf(e3)}`)

    const e4 = email('empty-no-switcher')
    const nothing = await call('POST', '/admin/users',
      { jar: rootJar, body: student(e4, { organizationId: '' }) })
    check('but an empty field with no switcher is still refused',
      nothing.status === 400 && code(nothing) === 'ORGANIZATION_REQUIRED',
      `${nothing.status} ${code(nothing)}`)

    /* The body is the more specific statement, so it wins. */
    const e2 = email('body-beats-switcher')
    await call('POST', '/admin/users', { jar: rootJar, body: student(e2, { organizationId: B }), org: D })
    check('an explicit academy in the body beats the switcher',
      await orgOf(e2) === B, String(await orgOf(e2)))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · a scoped admin cannot create into someone else\'s academy')
  {
    const e = email('scoped-own')
    const r = await call('POST', '/admin/users', { jar: dubaiJar, body: student(e) })
    check('a Dubai admin creating a student succeeds', r.status === 201, `${r.status} ${code(r)}`)
    check('and it lands in Dubai without being asked', await orgOf(e) === D, String(await orgOf(e)))

    const e2 = email('scoped-cross')
    const bad = await call('POST', '/admin/users', { jar: dubaiJar, body: student(e2, { organizationId: B }) })
    check('naming Bangalore is REFUSED, not quietly ignored', bad.status === 403, String(bad.status))
    check('with a reason', code(bad) === 'FORBIDDEN', code(bad))
    check('and nothing was created', await UserModel.countDocuments({ email: e2 }) === 0)

    /* Passing their OWN academy is the same as not passing one. */
    const e3 = email('scoped-same')
    const same = await call('POST', '/admin/users', { jar: dubaiJar, body: student(e3, { organizationId: D }) })
    check('naming their own academy is accepted', same.status === 201, String(same.status))
    check('and changes nothing', await orgOf(e3) === D)

    /* Nor can the switcher be used as a back door by a non-super admin. */
    const e4 = email('scoped-header')
    await call('POST', '/admin/users', { jar: dubaiJar, body: student(e4), org: B })
    check('an X-Organization-Id header does not move a scoped admin either',
      await orgOf(e4) === D, String(await orgOf(e4)))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · a sub_admin creating an instructor gets their own academy')
  {
    const e = email('sub-instr')
    const r = await call('POST', '/admin/users', {
      jar: subJar, body: { name: 'Teach One', email: e, password: PW, role: 'instructor', category: 'ai' },
    })
    check('a sub_admin can create an instructor', r.status === 201, `${r.status} ${code(r)}`)
    check('in their own academy', await orgOf(e) === D, String(await orgOf(e)))

    const e2 = email('sub-cross')
    const bad = await call('POST', '/admin/users', {
      jar: subJar, body: { name: 'Teach Two', email: e2, password: PW, role: 'instructor', category: 'ai', organizationId: B },
    })
    check('and cannot place one in another academy', bad.status === 403, String(bad.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · a bad academy id is a clear error, not a 500 or a silent drop')
  {
    const e = email('bad-id')
    const bad = await call('POST', '/admin/users', { jar: rootJar, body: student(e, { organizationId: 'not-an-objectid' }) })
    check('a malformed id is a 400', bad.status === 400, String(bad.status))
    check('with INVALID_ORGANIZATION', code(bad) === 'INVALID_ORGANIZATION', code(bad))

    const e2 = email('missing-org')
    const gone = await call('POST', '/admin/users', {
      jar: rootJar, body: student(e2, { organizationId: '000000000000000000000000' }),
    })
    check('an id that is well-formed but does not exist is a 404', gone.status === 404, String(gone.status))
    check('with ORGANIZATION_NOT_FOUND', code(gone) === 'ORGANIZATION_NOT_FOUND', code(gone))
    check('and neither created an account',
      await UserModel.countDocuments({ email: { $in: [e, e2] } }) === 0)
  }

  /* ═══════════════════════════════════════════════ */
  section('G · super_admin is the one role allowed no academy')
  {
    const e = email('new-root')
    const r = await call('POST', '/admin/users', {
      jar: rootJar, body: { name: 'Root Two', email: e, password: PW, role: 'super_admin' },
    })
    check('a super admin may still be created without one', r.status === 201, `${r.status} ${code(r)}`)
    check('and has none', await orgOf(e) === null, String(await orgOf(e)))

    for (const role of ['student', 'instructor', 'admin', 'sub_admin', 'support']) {
      const em = email(`needs-org-${role}`)
      const rr = await call('POST', '/admin/users', {
        jar: rootJar, body: { name: 'Person One', email: em, password: PW, role, category: 'ai' },
      })
      check(`  but a ${role} may not`, rr.status === 400 && code(rr) === 'ORGANIZATION_REQUIRED',
        `${rr.status} ${code(rr)}`)
    }
  }

  /* ═══════════════════════════════════════════════ */
  section('H · the account is actually visible where it was filed')
  {
    const e = email('visible')
    await call('POST', '/admin/users', { jar: rootJar, body: student(e, { organizationId: D }) })

    const inDubai = await call('GET', '/admin/users?role=student&per_page=100', { jar: rootJar, org: D })
    const inBlr   = await call('GET', '/admin/users?role=student&per_page=100', { jar: rootJar, org: B })
    const seen = (r: any) => (r.body?.data ?? []).some((u: any) => u.email === e)
    check('the Dubai list shows the new student', seen(inDubai))
    check('the Bangalore list does not', !seen(inBlr))

    const asDubaiAdmin = await call('GET', '/admin/users?role=student&per_page=100', { jar: dubaiJar })
    check('and the Dubai admin sees them without any switcher', seen(asDubaiAdmin))
    const asBlrAdmin = await call('GET', '/admin/users?role=student&per_page=100', { jar: blrJar })
    check('while the Bangalore admin does not', !seen(asBlrAdmin))
  }

  /* ═══════════════════════════════════════════════ */
  section('I · course enrolments created alongside get the SAME academy')
  {
    /* The enrolment rows written by the same request used to be stamped with
       the CALLER's org, which for a super admin creating into Dubai from
       "All Orgs" is nothing at all. */
    const teacher = await mk(email('t'), 'instructor', D)
    const course = await CourseModel.create({
      title: 'Dubai Course', slug: `dubai-course-${Date.now()}`, description: 'd',
      instructorId: teacher._id, price: 0, isFree: true, status: 'published',
      language: 'English', organizationId: dubai._id, program: 'ai',
    })

    const e = email('with-course')
    const r = await call('POST', '/admin/users', {
      jar: rootJar,
      body: student(e, { organizationId: D, courses: [{ courseId: String(course._id), blockedLessons: [] }] }),
    })
    check('the student is created with a course', r.status === 201, `${r.status} ${code(r)}`)

    const u = await UserModel.findOne({ email: e }).lean() as any
    const enrol = await EnrollmentModel.findOne({ userId: u._id }).lean() as any
    check('the enrolment exists', !!enrol)
    check('and carries the STUDENT\'s academy, not the caller\'s absent one',
      String(enrol?.organizationId) === D, String(enrol?.organizationId))
    check('and is recorded as an admin enrolment', enrol?.source === 'admin', String(enrol?.source))
  }

  /* ═══════════════════════════════════════════════ */
  section('J · the same request twice — repeated, to be sure it is the rule')
  {
    for (let i = 0; i < 3; i++) {
      const e = email(`repeat-${i}`)
      const r = await call('POST', '/admin/users', { jar: rootJar, body: student(e, { organizationId: i % 2 ? B : D }) })
      const want = i % 2 ? B : D
      check(`  round ${i + 1}: created in the academy asked for`,
        r.status === 201 && await orgOf(e) === want, `${r.status} ${await orgOf(e)}`)
    }
    check('no account in the whole suite ended up without an academy',
      await UserModel.countDocuments({ role: { $ne: 'super_admin' }, organizationId: { $in: [null, undefined] } }) === 0,
      String(await UserModel.countDocuments({ role: { $ne: 'super_admin' }, organizationId: { $in: [null, undefined] } })))
  }

  /* =============================================== */
  section('K · COURSES have the same rule -- checked because users were not the only door')
  {
    const teach = await mk(email('ct'), 'instructor', D)
    const base = (slug: string, extra: Record<string, unknown> = {}) => ({
      title: 'A Course Title', slug, description: 'a description long enough to pass validation',
      price: 0, isFree: true, status: 'draft', language: 'English',
      instructorId: String(teach._id), ...extra,
    })
    const courseOrg = async (slug: string) => {
      const c = await CourseModel.findOne({ slug }).select('organizationId').lean() as any
      return c?.organizationId ? String(c.organizationId) : null
    }

    const s1 = `c-none-${Date.now()}`
    const none = await call('POST', '/admin/courses', { jar: rootJar, body: base(s1) })
    check('a super admin on "All Orgs" can no longer create an academy-less course',
      none.status === 400, String(none.status))
    check('  with ORGANIZATION_REQUIRED', code(none) === 'ORGANIZATION_REQUIRED', code(none))
    check('  and no course was created', await CourseModel.countDocuments({ slug: s1 }) === 0)

    const s2 = `c-explicit-${Date.now()}`
    const ok = await call('POST', '/admin/courses', { jar: rootJar, body: base(s2, { organizationId: B }) })
    check('naming the academy works', ok.status === 201, `${ok.status} ${code(ok)}`)
    check('  and it lands there', await courseOrg(s2) === B, String(await courseOrg(s2)))

    const s3 = `c-switch-${Date.now()}`
    await call('POST', '/admin/courses', { jar: rootJar, body: base(s3), org: D })
    check('the switcher still supplies a default', await courseOrg(s3) === D, String(await courseOrg(s3)))

    const s4 = `c-scoped-${Date.now()}`
    const cross = await call('POST', '/admin/courses', { jar: dubaiJar, body: base(s4, { organizationId: B }) })
    check('a Dubai admin cannot create a course in Bangalore', cross.status === 403, String(cross.status))

    const s5 = `c-own-${Date.now()}`
    const own = await call('POST', '/admin/courses', { jar: dubaiJar, body: base(s5) })
    check('but can in their own', own.status === 201, `${own.status} ${code(own)}`)
    check('  which is Dubai', await courseOrg(s5) === D, String(await courseOrg(s5)))

    const s6 = `c-bad-${Date.now()}`
    const bad = await call('POST', '/admin/courses', { jar: rootJar, body: base(s6, { organizationId: 'nope' }) })
    check('a malformed academy id is a 400', bad.status === 400 && code(bad) === 'INVALID_ORGANIZATION',
      `${bad.status} ${code(bad)}`)

    check('no course anywhere ended up without an academy',
      await CourseModel.countDocuments({ organizationId: { $in: [null, undefined] } }) === 0)
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
