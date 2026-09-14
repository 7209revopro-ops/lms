/* ─────────────────────────────────────────────────────────────
   Instructors created from the admin panel — can they actually sign in?

   Reported symptom: an admin adds an instructor through Instructors →
   "Add Instructor", hands them the password that was typed into that form,
   and the instructor is told "Invalid email or password."

   That message has THREE separate causes inside login(), and they are
   indistinguishable from outside on purpose (so nobody can probe which
   addresses exist):

     - no account matched the address
     - the account matched but isActive is false
     - the password did not verify

   So the symptom alone cannot tell you which one happened. This suite walks
   the real path — sign in as an admin, POST /admin/users exactly as the modal
   does, then sign in as that instructor — and pins down which of the three it
   is, plus the input shapes most likely to produce it in the wild.

   Covers:
     A  the plain case: create, then sign in
     B  the row that was written: hash present, isActive, role, org
     C  address shapes an admin really types — capitals, stray whitespace
     D  the password reaches the hash unmangled (spaces, symbols, length)
     E  which of the three causes fires when it does fail
     F  the instructor portal boundary: they are staff, not students

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_instructorlogin_suite), dropped on exit.

   Run: bun src/tests/instructorlogin.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_instructorlogin_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

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
const { UserModel, OrganizationModel } = await import('@/models/schema.ts')
const { hashPassword, comparePassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_instructorlogin_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

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
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}
const code = (r: { body: any }) => r.body?.error?.code

const ADMIN_PW = 'CorrectHorse1'
let adminJar: Jar

/* Exactly the body AddInstructorModal sends: name, email, password, role,
   headline, bio, category, avatarUrl. Nothing more, nothing renamed. */
async function addInstructorViaPanel(email: string, password: string, extra: Record<string, unknown> = {}) {
  return call('POST', '/admin/users', {
    jar: adminJar,
    body: {
      name:     'Jane Teacher',
      email,
      password,
      role:     'instructor',
      headline: 'Senior Trainer',
      bio:      'Teaches the forex track.',
      category: '4x-trading',
      ...extra,
    },
  })
}

const signIn = async (email: string, password: string) => {
  const jar: Jar = new Map()
  const r = await call('POST', '/admin/auth/login', { jar, body: { email, password } })
  return { status: r.status, code: code(r), role: r.body?.data?.user?.role, jar }
}

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
/* A plain `admin`, not a super_admin, is the creator throughout.

   That is deliberate and it matters: for a super_admin the request's academy
   comes ONLY from the X-Organization-Id header the org switcher sends, and
   their own account's organizationId is ignored on purpose. With the switcher
   on "All Orgs" no header is sent, so POST /admin/users refuses with
   ORGANIZATION_REQUIRED before any account is made. A normal admin has one
   academy and it comes off their own record, which is the path almost every
   real instructor is created through. The super_admin shape is covered in G. */
await UserModel.create({
  name: 'Ops Admin', email: 'ops@t.local', passwordHash: await hashPassword(ADMIN_PW),
  role: 'admin', isActive: true, organizationId: org._id,
})
await UserModel.create({
  name: 'Root Admin', email: 'root@t.local', passwordHash: await hashPassword(ADMIN_PW),
  role: 'super_admin', isActive: true, organizationId: org._id,
})
{
  const a = await signIn('ops@t.local', ADMIN_PW)
  adminJar = a.jar
  check('setup: the admin can sign in', a.status === 200, `status=${a.status} code=${a.code}`)
}

/* ═════════════════ A — the plain case ═════════════════ */
section('A. Create an instructor from the panel, then sign in as them')
{
  const PW = 'Teacher#2026pass'
  const c  = await addInstructorViaPanel('jane.teacher@t.local', PW)
  check('A1 the panel accepts the new instructor', c.status < 300, `status=${c.status} ${JSON.stringify(c.body).slice(0, 200)}`)

  const s = await signIn('jane.teacher@t.local', PW)
  check('A2 the instructor can sign in with that password',
    s.status === 200, `status=${s.status} code=${s.code}`)
  check('A3 and arrives as an instructor', s.role === 'instructor', String(s.role))
}

/* ═════════════════ B — what was actually written ═════════════════ */
section('B. The row the panel wrote')
{
  const row = await UserModel.findOne({ email: 'jane.teacher@t.local' }).select('+passwordHash').lean() as any
  check('B1 the account exists', !!row)
  /* The three things login() checks, in the order it checks them. If the
     symptom ever returns, whichever of these is false IS the bug. */
  check('B2 a password hash was stored', !!row?.passwordHash)
  check('B3 the hash is bcrypt, not the plaintext', /^\$2[aby]\$/.test(String(row?.passwordHash)))
  check('B4 it verifies against the typed password',
    await comparePassword('Teacher#2026pass', String(row?.passwordHash)))
  check('B5 isActive is true — a false here reads as "invalid credentials"',
    row?.isActive === true, String(row?.isActive))
  check('B6 the role is instructor', row?.role === 'instructor', String(row?.role))
  check('B7 the email was stored lowercase and trimmed',
    row?.email === 'jane.teacher@t.local', String(row?.email))
  check('B8 it belongs to an academy', !!row?.organizationId)
  /* Admin-created accounts are stamped isVerified:false. Recorded here
     deliberately: if a verification gate is ever added to login, this suite
     should fail loudly rather than the instructors failing quietly. */
  check('B9 isVerified is false, and login does NOT gate on it',
    row?.isVerified === false, String(row?.isVerified))
}

/* ═════════════════ C — addresses an admin really types ═════════════════ */
section('C. Address shapes: capitals and stray whitespace')
{
  const PW = 'Another#2026pw'
  /* Admins type into a plain text field. A capitalised address, or one
     pasted with a trailing space, must still end up as the same identity
     the login lookup (which lowercases and trims) will search for. */
  const c = await addInstructorViaPanel('  Mixed.Case@T.Local  ', PW)
  check('C1 the panel accepts a capitalised, padded address',
    c.status < 300, `status=${c.status} ${JSON.stringify(c.body).slice(0, 160)}`)

  const row = await UserModel.findOne({ email: 'mixed.case@t.local' }).lean() as any
  check('C2 it is stored normalised', !!row, 'no row at the lowercased address')

  check('C3 they can sign in typing it lowercase',
    (await signIn('mixed.case@t.local', PW)).status === 200)
  check('C4 ...and typing it exactly as the admin did',
    (await signIn('Mixed.Case@T.Local', PW)).status === 200)
}

/* ═════════════════ D — the password reaches the hash intact ═════════════════ */
section('D. Passwords survive the trip unmangled')
{
  /* The modal only enforces a length of 8. Whatever an admin types — symbols,
     spaces, a long passphrase — has to hash and verify byte-for-byte. A
     silent trim anywhere in the chain shows up here and nowhere else. */
  const cases: [string, string][] = [
    ['symbols@t.local',   'p@$$w0rd!#%&*()'],
    ['spaces@t.local',    'two words inside'],
    ['trailspace@t.local','trailing space '],
    ['unicode@t.local',   'pässwörd–2026'],
    ['long@t.local',      'a-very-long-passphrase-an-admin-might-paste-2026'],
  ]
  for (const [email, pw] of cases) {
    const c = await addInstructorViaPanel(email, pw)
    const label = email.split('@')[0]
    if (c.status >= 300) { check(`D:${label} created`, false, `status=${c.status}`); continue }
    const s = await signIn(email, pw)
    check(`D:${label} signs in with the exact password given`,
      s.status === 200, `status=${s.status} code=${s.code}`)
  }
}

/* ═════════════════ E — which cause fires on a real failure ═════════════════ */
section('E. When it DOES say invalid credentials, which of the three is it?')
{
  const PW = 'Blocked#2026pw'
  await addInstructorViaPanel('blocked@t.local', PW)

  /* Cause 2: the account is there and the password is right, but isActive is
     false. This is the one that looks like a mystery to an admin, because
     nothing about the message hints that the account was disabled. */
  await UserModel.updateOne({ email: 'blocked@t.local' }, { $set: { isActive: false } })
  const blocked = await signIn('blocked@t.local', PW)
  check('E1 a deactivated instructor is told "invalid credentials"',
    blocked.status === 401 && blocked.code === 'INVALID_CREDENTIALS',
    `status=${blocked.status} code=${blocked.code}`)

  await UserModel.updateOne({ email: 'blocked@t.local' }, { $set: { isActive: true } })
  check('E2 reactivating lets the same password straight back in',
    (await signIn('blocked@t.local', PW)).status === 200)

  /* Cause 1: no such address. */
  const ghost = await signIn('never.created@t.local', PW)
  check('E3 an address that was never created says the same thing',
    ghost.status === 401 && ghost.code === 'INVALID_CREDENTIALS',
    `status=${ghost.status} code=${ghost.code}`)

  /* Cause 3: wrong password. Kept to ONE attempt — five trips the lockout. */
  const wrong = await signIn('jane.teacher@t.local', 'NotThePassword9')
  check('E4 a wrong password says the same thing again',
    wrong.status === 401 && wrong.code === 'INVALID_CREDENTIALS',
    `status=${wrong.status} code=${wrong.code}`)

  /* And the lockout, which an admin retrying "the password that should work"
     will hit on the sixth try — after which even the RIGHT password fails,
     with a different message that names the wait. */
  const trail: string[] = []
  for (let i = 0; i < 5; i++) {
    const a = await signIn('blocked@t.local', 'WrongOne9x')
    trail.push(`${i + 1}:${a.status}/${a.code}`)
  }
  const row = await UserModel.findOne({ email: 'blocked@t.local' }).lean() as any
  const locked = await signIn('blocked@t.local', PW)
  check('E5 repeated retries lock the account and SAY so (not "invalid")',
    locked.status === 423 && locked.code === 'ACCOUNT_LOCKED',
    `final=${locked.status}/${locked.code} attempts=[${trail.join(' ')}] ` +
    `counter=${row?.failedLoginAttempts} lockedUntil=${row?.lockedUntil}`)
}

/* ═════════════════ F — the portal boundary ═════════════════ */
section('F. Instructors belong to the admin portal')
{
  const PW = 'Portal#2026pw'
  const made = await addInstructorViaPanel('portal@t.local', PW)
  check('F0 the account was actually created',
    made.status < 300, `status=${made.status} ${JSON.stringify(made.body).slice(0, 200)}`)

  const admin = await signIn('portal@t.local', PW)
  check('F1 the admin portal admits them', admin.status === 200, `status=${admin.status} code=${admin.code}`)

  /* The student portal is a different session entirely. An instructor who
     tries the client login should not silently get a student session. */
  const jar: Jar = new Map()
  const client = await call('POST', '/auth/login', { jar, body: { email: 'portal@t.local', password: PW } })
  check('F2 the client login does not hand an instructor a student session',
    client.status !== 200 || client.body?.data?.user?.role === 'instructor',
    `status=${client.status} role=${client.body?.data?.user?.role}`)
}

/* ═════════════════ G — the super_admin shape ═════════════════ */
section('G. A super_admin must name the academy, and is told so plainly')
{
  const sup: Jar = new Map()
  const l = await call('POST', '/admin/auth/login', { jar: sup, body: { email: 'root@t.local', password: ADMIN_PW } })
  check('G1 the super admin signs in', l.status === 200, `status=${l.status}`)

  /* No X-Organization-Id header == the switcher on "All Orgs". */
  const noOrg = await call('POST', '/admin/users', {
    jar: sup,
    body: { name: 'No Org', email: 'noorg@t.local', password: 'Whatever#2026', role: 'instructor' },
  })
  check('G2 without an academy it is refused, and named',
    noOrg.status === 400 && code(noOrg) === 'ORGANIZATION_REQUIRED',
    `status=${noOrg.status} code=${code(noOrg)}`)
  /* The important half: refused OUTRIGHT. An account created with no academy
     would be invisible to every scoped list — a far worse outcome than a 400. */
  check('G3 and no half-made account was left behind',
    !(await UserModel.exists({ email: 'noorg@t.local' })))

  const withOrg = await call('POST', '/admin/users', {
    jar: sup,
    body: { name: 'With Org', email: 'withorg@t.local', password: 'Whatever#2026',
            role: 'instructor', organizationId: String(org._id) },
  })
  check('G4 naming the academy in the body works', withOrg.status < 300,
    `status=${withOrg.status} ${JSON.stringify(withOrg.body).slice(0, 200)} sentOrg=${String(org._id)}`)
  check('G5 and that instructor can sign in',
    (await signIn('withorg@t.local', 'Whatever#2026')).status === 200)
}

/* ═════════════════ H — the response body ═════════════════ */
section('H. What the create endpoint hands back')
{
  const made = await addInstructorViaPanel('leak.check@t.local', 'LeakCheck#2026')
  check('H1 the instructor was created', made.status < 300, `status=${made.status}`)

  /* passwordHash is `select: false`, which hides it from QUERIES -- but a
     document that was just created still carries the hash that was written to
     it. Returning the raw document therefore put the new account's bcrypt hash
     in the API response, where the admin panel, the browser's network tab and
     any logging proxy could all see it. */
  const raw = JSON.stringify(made.body)
  check('H2 the response contains NO passwordHash', !raw.includes('passwordHash'),
    raw.slice(0, 200))
  check('H3 and no bcrypt hash under any other key', !/\$2[aby]\$/.test(raw),
    raw.slice(0, 200))
  /* It still has to be a useful response. */
  check('H4 but it does return the account', /leak\.check@t\.local/.test(raw), raw.slice(0, 160))
}

/* ═════════════════ I — a padded address at LOGIN ═════════════════ */
section('I. Signing in with an address pasted with whitespace')
{
  const PW = 'Pasted#2026pw'
  const made = await addInstructorViaPanel('pasted@t.local', PW)
  check('I1 the instructor was created', made.status < 300, `status=${made.status}`)

  /* The half that matters most, and the half the create-side fix did NOT
     cover: people paste their address into the LOGIN box out of the mail that
     gave it to them, and it arrives with a space attached. Refusing that as
     "Invalid email" reads to them as "my account does not work". */
  const padded = await signIn('  Pasted@T.Local  ', PW)
  check('I2 a padded, capitalised address signs in',
    padded.status === 200, `status=${padded.status} code=${padded.code}`)

  /* And the same courtesy on the routes a stuck person actually reaches for. */
  const forgot = await call('POST', '/auth/forgot-password', { body: { email: '  Pasted@T.Local  ' } })
  check('I3 forgot-password accepts it too', forgot.status === 200, `status=${forgot.status}`)
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
console.log(`\ninstructorlogin.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
