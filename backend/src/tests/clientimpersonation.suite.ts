/* ─────────────────────────────────────────────────────────────
   Client-portal impersonation — a super admin browses the student
   app as a student, read-only.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_clientimp_suite), dropped on exit. The real `lms` database is
   never opened.

   Four properties are worth proving, because each one is a thing that
   would be silently wrong if it regressed:
     1. audience separation — the admin-side token must NOT work on a
        client route, or the two portals collapse back into one (L-06)
     2. the handoff code is single-use and short-lived
     3. the session is READ-ONLY — writes would be attributed to the student
     4. the admin's own `lms_at` session survives, because the impersonation
        rides a separate cookie

   Run: bun run test:clientimp
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_clientimp_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'

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
const { UserModel, OrganizationModel, ImpersonationHandoffModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_clientimp_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) {
      const name = pair!.slice(0, i), value = pair!.slice(i + 1)
      /* An expiry in the past IS a deletion — modelling it as one is what makes
         the "exit clears the cookie" assertion mean anything. */
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name)
      else jar.set(name, value)
    }
  }
}
async function call(method: string, path: string, opts: { jar?: Jar; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) absorb(opts.jar, res)
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string) =>
    UserModel.create({
      name: email, email, passwordHash: hash, role, isActive: true,
      organizationId: org._id,
      ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
    })

  await mk('super@t.local', 'super_admin')
  await mk('plainadmin@t.local', 'admin')
  const student = await mk('student@t.local', 'student')
  const staff   = await mk('mentor@t.local', 'instructor')

  /* A SECOND academy, and a sub_admin confined to one programme — the two
     boundaries that did not exist while only a cross-org role could reach
     this endpoint. */
  const orgB = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const foreignStudent = await UserModel.create({
    name: 'far', email: 'far@t.local', passwordHash: hash, role: 'student',
    isActive: true, organizationId: orgB._id, enrollmentStatus: 'approved',
  })
  const subAdmin = await UserModel.create({
    name: 'sub', email: 'sub@t.local', passwordHash: hash, role: 'sub_admin',
    isActive: true, organizationId: org._id, program: 'ai',
  })
  const inScope = await UserModel.create({
    name: 'ai student', email: 'ai@t.local', passwordHash: hash, role: 'student',
    isActive: true, organizationId: org._id, enrollmentStatus: 'approved',
    category: 'ai', categories: ['ai'],
  })
  const outOfScope = await UserModel.create({
    name: 'forex student', email: 'fx@t.local', passwordHash: hash, role: 'student',
    isActive: true, organizationId: org._id, enrollmentStatus: 'approved',
    category: '4x-trading', categories: ['4x-trading'],
  })
  await UserModel.create({
    name: 'tutor2', email: 'tutor2@t.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })

  /* The super admin's ADMIN session (lms_admin_at). */
  const adminJar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: 'super@t.local', password: PW } })
  if (li.status !== 200) throw new Error(`super_admin login failed: ${li.status}`)

  section('creating the handoff')
  const created = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  check('super_admin can create a client handoff', created.status === 200, `got ${created.status}`)
  const code = created.body?.data?.code
  check('a one-time code is returned', typeof code === 'string' && code.length === 64, `len ${code?.length}`)
  check('the response carries a client URL to open',
    typeof created.body?.data?.clientUrl === 'string' && created.body.data.clientUrl.includes('/imp/enter?code='),
    created.body?.data?.clientUrl)
  check('no token is handed to the admin app',
    created.body?.data?.token === undefined,
    'a client token in the admin app is exactly what the handoff exists to avoid')

  const stored = await ImpersonationHandoffModel.findOne({}).lean() as any
  check('the raw code is NOT stored — only its hash',
    !!stored && stored.codeHash !== code && stored.codeHash?.length === 64)

  section('who may create one')
  /* This used to read "a plain admin cannot — super_admin only". Viewing a
     student's own app is a support task, so admins and sub_admins have it
     now — but only the READ-ONLY client flow, only on a student, only inside
     their own academy, and a sub_admin only inside its programme. Each line
     below is one of those four. */
  const otherJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: otherJar, body: { email: 'plainadmin@t.local', password: PW } })
  const byAdmin = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: otherJar })
  check('a plain admin CAN view a student of their own academy',
    byAdmin.status === 200, `got ${byAdmin.status} ${JSON.stringify(byAdmin.body?.error ?? '')}`)

  const adminOnStaff = await call('POST', `/admin/users/${staff._id}/impersonate-client`, { jar: otherJar })
  check('…but not a member of staff — that would be escalation, not support',
    adminOnStaff.status === 403 && adminOnStaff.body?.error?.code === 'NOT_A_STUDENT',
    `got ${adminOnStaff.status} ${adminOnStaff.body?.error?.code}`)

  const adminAcross = await call('POST', `/admin/users/${foreignStudent._id}/impersonate-client`, { jar: otherJar })
  check('…and not a student of the other academy, answered 404 not 403',
    adminAcross.status === 404,
    `got ${adminAcross.status} — 403 would confirm the id exists elsewhere`)

  const subJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: subJar, body: { email: 'sub@t.local', password: PW } })
  const subIn = await call('POST', `/admin/users/${inScope._id}/impersonate-client`, { jar: subJar })
  check('a sub_admin CAN view a student inside its programme',
    subIn.status === 200, `got ${subIn.status} ${JSON.stringify(subIn.body?.error ?? '')}`)
  const subOut = await call('POST', `/admin/users/${outOfScope._id}/impersonate-client`, { jar: subJar })
  check('…but not one outside it, and is told 404 rather than "not yours"',
    subOut.status === 404, `got ${subOut.status}`)

  const tutorJar: Jar = new Map()
  const tutorLogin = await call('POST', '/admin/auth/login', { jar: tutorJar, body: { email: 'tutor2@t.local', password: PW } })
  if (tutorLogin.status === 200) {
    const byTutor = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: tutorJar })
    check('an instructor cannot view anyone this way',
      byTutor.status === 403, `got ${byTutor.status}`)
  } else {
    check('an instructor cannot view anyone this way (no admin session at all)',
      true, `admin login refused with ${tutorLogin.status}`)
  }

  /* The other half of the asymmetry: the ADMIN-PANEL flow is not read-only and
     exists to impersonate staff, so it stays super_admin only. If this ever
     starts passing for a plain admin, the widening has leaked into the wrong
     route. */
  const panelByAdmin = await call('POST', `/admin/users/${student._id}/impersonate`, { jar: otherJar })
  check('the admin-panel route is still super_admin only',
    panelByAdmin.status === 403, `got ${panelByAdmin.status}`)

  const onStaff = await call('POST', `/admin/users/${staff._id}/impersonate-client`, { jar: adminJar })
  check('non-students are refused for super_admin too', onStaff.status === 400, `got ${onStaff.status}`)

  section('the two ways a guard can fail OPEN')
  /* Both of these passed the first version of this guard, and both accounts
     are ordinary rather than exotic. */

  /* 1. AN ORG-LESS ADMIN. `bun run seed` creates its admin with no
     organizationId, and the boot backfill skips super_admin, so such an
     account is normal. callerMayAccess returns TRUE for a caller with no
     academy (rule 3b), so delegating the academy wall to it let this account
     reach students of BOTH academies. */
  const orgless = await UserModel.create({
    name: 'orgless', email: 'orgless@t.local', passwordHash: hash,
    role: 'admin', isActive: true, isVerified: true,
  })
  const orglessJar: Jar = new Map()
  const ol = await call('POST', '/admin/auth/login', { jar: orglessJar, body: { email: 'orgless@t.local', password: PW } })
  if (ol.status === 200) {
    const here  = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: orglessJar })
    const there = await call('POST', `/admin/users/${foreignStudent._id}/impersonate-client`, { jar: orglessJar })
    check('an admin with no academy cannot reach this academy’s students',
      here.status === 404, `got ${here.status}`)
    check('…nor the other academy’s — the wall needs BOTH sides named',
      there.status === 404, `got ${there.status}`)

    /* The SAME hole on the reading side. GET /impersonation-sessions scopes
       by the caller's organizationId, and an admin who has none simply had no
       filter applied — so the one account that must not be trusted with the
       trail was handed all of it: actor and target emails, ip, user agent,
       across both academies. Scoping now falls back to "your own rows". */
    const seen = await call('GET', '/admin/impersonation-sessions', { jar: orglessJar })
    const rows = (seen.body?.data ?? []) as any[]
    check('…and reads no impersonation trail it is not the actor of',
      seen.status === 200 && rows.every(r => String(r.actorId ?? '') === String(orgless._id)),
      `got ${seen.status} with ${rows.length} rows, actors ${[...new Set(rows.map(r => r.actorEmail))].join(',')}`)
  } else {
    check('an admin with no academy cannot sign in to the admin portal at all',
      true, `login refused with ${ol.status}`)
  }

  /* The other side of that clause: an admin WITH an academy still supervises
     it. Narrowing everyone to their own rows would have been the easy fix and
     the wrong one — the trail exists to be read by whoever answers for the
     academy. */
  const adminSees = await call('GET', '/admin/impersonation-sessions', { jar: otherJar })
  const adminRows = (adminSees.body?.data ?? []) as any[]
  check('an admin WITH an academy still sees sessions other people started there',
    adminSees.status === 200 && adminRows.some(r => r.actorEmail && r.actorEmail !== 'plainadmin@t.local'),
    `got ${adminSees.status} with ${adminRows.length} rows`)

  /* 2. A SUB-ADMIN WITH NO PROGRAMME — an ordinary account, not a contrived
     one: userUpdateSchema did not name `program` and validate() strips what a
     schema does not name, so promoting somebody through Edit User dropped the
     programme the modal had insisted on. The guard then skipped its whole
     scope test when scope was unset and handed that account the academy. The
     schema is fixed below; this stays because the two failures are separate —
     a programme can go missing for reasons the schema cannot prevent, and the
     guard must still refuse rather than assume. */
  const noScope = await UserModel.create({
    name: 'no programme', email: 'noscope@t.local', passwordHash: hash,
    role: 'sub_admin', isActive: true, isVerified: true, organizationId: org._id,
  })
  void noScope
  const noScopeJar: Jar = new Map()
  const ns = await call('POST', '/admin/auth/login', { jar: noScopeJar, body: { email: 'noscope@t.local', password: PW } })
  if (ns.status === 200) {
    const tryIt = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: noScopeJar })
    check('a sub_admin with no programme gets nothing, not everything',
      tryIt.status === 404, `got ${tryIt.status} — failing open here handed it the whole academy`)
  } else {
    check('a sub_admin with no programme cannot sign in', true, `login refused with ${ns.status}`)
  }

  section('Edit User must be able to GIVE a sub_admin its programme')
  /* The half that made the account above ordinary. The modal refuses to save a
     sub_admin without a programme and sends `program`; the update schema did
     not list it, so it was stripped in the middleware and never reached the
     service — which has always known how to write it. The account came back
     scoped to nothing. */
  const patched = await call('PATCH', `/admin/users/${noScope._id}`, {
    jar: adminJar, body: { role: 'sub_admin', program: 'ai' },
  })
  check('PATCH /admin/users/:id accepts a programme', patched.status === 200, `got ${patched.status}`)
  const reread = await UserModel.findById(noScope._id).select('program').lean() as any
  check('…and it is actually stored, not stripped on the way in',
    reread?.program === 'ai', `stored ${reread?.program ?? 'nothing'}`)
  const nowScopedJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: nowScopedJar, body: { email: 'noscope@t.local', password: PW } })
  const nowWorks = await call('POST', `/admin/users/${inScope._id}/impersonate-client`, { jar: nowScopedJar })
  check('…so the sub_admin can now open a student of that programme',
    nowWorks.status === 200, `got ${nowWorks.status} ${JSON.stringify(nowWorks.body?.error ?? '')}`)
  const stillNot = await call('POST', `/admin/users/${outOfScope._id}/impersonate-client`, { jar: nowScopedJar })
  check('…and still not one outside it', stillNot.status === 404, `got ${stillNot.status}`)

  section('who may END a session')
  /* Revoking used to be super_admin only, which was fine while only a
     super_admin could start one. Now that an admin or sub_admin can, a power
     you may begin and not end is the wrong shape — revoking is the only thing
     that cuts off every holder of the token at once, so it has to follow the
     same reach as starting and reading. Each line below is one edge of that. */
  const startedBySub = await call('POST', `/admin/users/${inScope._id}/impersonate-client`, { jar: subJar })
  const startedByAdmin = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: otherJar })
  check('baseline — both a sub_admin and an admin can open a session',
    startedBySub.status === 200 && startedByAdmin.status === 200,
    `${startedBySub.status}/${startedByAdmin.status}`)

  const subEndsOthers = await call('DELETE', `/admin/impersonation-sessions/${startedByAdmin.body?.data?.impersonationId}`, { jar: subJar })
  check('a sub_admin cannot end a session it did not start, and is told 404',
    subEndsOthers.status === 404, `got ${subEndsOthers.status}`)

  const subEndsOwn = await call('DELETE', `/admin/impersonation-sessions/${startedBySub.body?.data?.impersonationId}`, { jar: subJar })
  check('…but can end its own', subEndsOwn.status === 200, `got ${subEndsOwn.status}`)

  /* A second academy's row, started by that academy's own admin. */
  const adminB = await UserModel.create({
    name: 'admin b', email: 'adminb@t.local', passwordHash: hash,
    role: 'admin', isActive: true, isVerified: true, organizationId: orgB._id,
  })
  void adminB
  const jarB: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: jarB, body: { email: 'adminb@t.local', password: PW } })
  const startedInB = await call('POST', `/admin/users/${foreignStudent._id}/impersonate-client`, { jar: jarB })
  check('the other academy’s admin can open a session on its own student',
    startedInB.status === 200, `got ${startedInB.status} ${JSON.stringify(startedInB.body?.error ?? '')}`)

  const crossEnd = await call('DELETE', `/admin/impersonation-sessions/${startedInB.body?.data?.impersonationId}`, { jar: otherJar })
  check('an admin cannot end the OTHER academy’s session',
    crossEnd.status === 404, `got ${crossEnd.status}`)

  const adminEndsSubs = await call('DELETE', `/admin/impersonation-sessions/${startedByAdmin.body?.data?.impersonationId}`, { jar: otherJar })
  check('an academy admin CAN end a session in its own academy',
    adminEndsSubs.status === 200, `got ${adminEndsSubs.status}`)

  const superEndsB = await call('DELETE', `/admin/impersonation-sessions/${startedInB.body?.data?.impersonationId}`, { jar: adminJar })
  check('super_admin can still end anything, in either academy',
    superEndsB.status === 200, `got ${superEndsB.status}`)

  /* The kill switch stays super_admin only: it ends every live session in
     EVERY academy, so a Dubai admin pressing it would cut Bangalore off too. */
  const killByAdmin = await call('POST', '/admin/impersonation-sessions/revoke-all', { jar: otherJar })
  check('the revoke-all kill switch is still super_admin only — it crosses academies',
    killByAdmin.status === 403, `got ${killByAdmin.status}`)

  section('a sub_admin reaches a student through the COURSE, not just the category')
  /* Nothing about enrolling on a course writes `categories`, so the admin's
     own student list counts a third way: enrolled on a course belonging to
     the programme. A guard that compared only category/categories would 404
     the button on rows the table had just drawn. */
  const { CourseModel, EnrollmentModel } = await import('@/models/schema.ts')
  const aiCourse = await CourseModel.create({
    title: 'AI course', slug: `ai-course-${Date.now()}`, description: 'x',
    instructorId: staff._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: org._id, program: 'ai',
  })
  const byCourse = await UserModel.create({
    name: 'dm student on an ai course', email: 'bycourse@t.local', passwordHash: hash,
    role: 'student', isActive: true, organizationId: org._id,
    enrollmentStatus: 'approved', category: 'digital-marketing', categories: ['digital-marketing'],
  })
  await EnrollmentModel.create({ userId: byCourse._id, courseId: aiCourse._id, status: 'active' })
  const viaCourse = await call('POST', `/admin/users/${byCourse._id}/impersonate-client`, { jar: subJar })
  check('a sub_admin CAN view a student reached through its programme’s course',
    viaCourse.status === 200, `got ${viaCourse.status} ${JSON.stringify(viaCourse.body?.error ?? '')}`)

  section('impersonation cannot be chained')
  /* The session row records actorId: req.user.id, which during an
     impersonation is the BORROWED account — so a chain would write the wrong
     person into the one record that says who did this. */
  const chainJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: chainJar, body: { email: 'super@t.local', password: PW } })
  /* Borrow an ADMIN, not an instructor. An instructor identity is already
     stopped by the role gate on the route, so it proves nothing about this
     rule; an admin identity passes every gate and reaches the handler, which
     is exactly the case where the actor trail would be laundered. */
  const adminTarget = await UserModel.findOne({ email: 'plainadmin@t.local' }).lean() as any
  const first = await call('POST', `/admin/users/${adminTarget._id}/impersonate`, { jar: chainJar })
  check('super_admin can impersonate an admin in the admin panel (baseline)',
    first.status === 200, `got ${first.status}`)
  const chained = await call('POST', `/admin/users/${student._id}/impersonate-client`, {
    jar: chainJar, bearer: first.body?.data?.token,
  })
  check('…but cannot start another impersonation from inside that one',
    chained.status === 409, `got ${chained.status} — a chain would launder the actor trail`)

  section('redeeming on the client origin')
  const bad = await call('POST', '/auth/impersonation/redeem', { body: { code: 'tooshort' } })
  check('a malformed code is refused', bad.status === 400, `got ${bad.status}`)

  /* A pre-existing CLIENT session for the same browser — the thing that must
     survive redemption. Logging in as the student is the simplest way to get a
     real lms_at into the jar. */
  const browser: Jar = new Map()
  const studentLogin = await call('POST', '/auth/login', { jar: browser, body: { email: 'student@t.local', password: PW } })
  check('a real client session exists first (lms_at present)',
    studentLogin.status === 200 && browser.has('lms_at'), `got ${studentLogin.status}`)
  const originalAt = browser.get('lms_at')

  const redeemed = await call('POST', '/auth/impersonation/redeem', { jar: browser, body: { code } })
  check('the code redeems', redeemed.status === 200, `got ${redeemed.status} ${JSON.stringify(redeemed.body?.error ?? '')}`)
  check('an lms_imp_at cookie is set', browser.has('lms_imp_at'))
  check('a readable lms_imp flag rides alongside it',
    browser.get('lms_imp') === '1',
    'the banner needs this to avoid probing /auth/me on public pages')
  check('the pre-existing lms_at is UNTOUCHED — the admin keeps their own session',
    browser.get('lms_at') === originalAt)

  section('single use')
  const again = await call('POST', '/auth/impersonation/redeem', { body: { code } })
  check('the same code cannot be redeemed twice', again.status === 410, `got ${again.status}`)

  section('the session acts as the STUDENT on client routes')
  const me = await call('GET', '/auth/me', { jar: browser })
  check('a client route authenticates', me.status === 200, `got ${me.status}`)
  check('it acts as the impersonated student',
    me.body?.data?.email === 'student@t.local' || me.body?.data?.user?.email === 'student@t.local',
    JSON.stringify(me.body?.data?.email ?? me.body?.data?.user?.email))

  check('/auth/me reports the impersonation, so the banner can exist',
    me.body?.data?.impersonation?.readOnly === true
    && me.body?.data?.impersonation?.actorEmail === 'super@t.local',
    JSON.stringify(me.body?.data?.impersonation))

  section('READ-ONLY')
  const write = await call('PATCH', '/auth/me', { jar: browser, body: { name: 'Renamed By Admin' } })
  check('a write is refused',
    write.status === 403 && write.body?.error?.code === 'IMPERSONATION_READ_ONLY',
    `got ${write.status} ${write.body?.error?.code}`)
  const fresh = await UserModel.findById(student._id).select('name').lean() as any
  check('the student record really was not modified', fresh?.name === 'student@t.local', fresh?.name)

  section('audience separation (L-06)')
  const adminSide = await call('POST', `/admin/users/${student._id}/impersonate`, { jar: adminJar })
  const adminToken = adminSide.body?.data?.token
  check('the admin-side flow still issues a token', !!adminToken)
  const crossed = await call('GET', '/auth/me', { bearer: adminToken })
  check('an admin-audience token is REJECTED on a client route',
    crossed.status === 401, `got ${crossed.status} — the portals must not share tokens`)

  section('revocation reaches the client session')
  const impId = created.body?.data?.impersonationId
  const rev = await call('DELETE', `/admin/impersonation-sessions/${impId}`, { jar: adminJar })
  check('the session can be ended from the admin panel', rev.status === 200, `got ${rev.status}`)
  const afterRevoke = await call('GET', '/auth/me', { jar: browser })
  check('the client session dies immediately',
    afterRevoke.status === 401 && afterRevoke.body?.error?.code === 'IMPERSONATION_REVOKED',
    `got ${afterRevoke.status} ${afterRevoke.body?.error?.code}`)

  section('exit')
  const exited = await call('POST', '/auth/impersonation/exit', { jar: browser })
  check('exit responds', exited.status === 200, `got ${exited.status}`)
  check('the impersonation cookie is gone', !browser.has('lms_imp_at'))
  check('and so is the flag, so the banner stops rendering', !browser.has('lms_imp'))
  const backToSelf = await call('GET', '/auth/me', { jar: browser })
  check('the ORIGINAL session is live again — nothing was destroyed',
    backToSelf.status === 200, `got ${backToSelf.status}`)
  check('and it reports NO impersonation, so the banner disappears',
    backToSelf.body?.data?.impersonation === undefined,
    JSON.stringify(backToSelf.body?.data?.impersonation))
  const writeAsSelf = await call('PATCH', '/auth/me', { jar: browser, body: { name: 'Student Renamed Themselves' } })
  check('writes work again once impersonation is over',
    writeAsSelf.status === 200, `got ${writeAsSelf.status}`)

  section('expiry')
  const c2 = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  /* Expire THIS code, by its own hash. The filter used to be "any unused
     handoff", which worked only while this suite created exactly one — the
     new who-may-create section leaves several unused, so it began expiring
     somebody else's row and this check passed a live code and read 200. A
     test that depends on being the only writer is a test that will break the
     next time the file grows. */
  const { createHash } = await import('node:crypto')
  await ImpersonationHandoffModel.updateOne(
    { codeHash: createHash('sha256').update(String(c2.body?.data?.code ?? '')).digest('hex') },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  )
  const expired = await call('POST', '/auth/impersonation/redeem', { body: { code: c2.body?.data?.code } })
  check('an expired code is refused', expired.status === 410, `got ${expired.status}`)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
