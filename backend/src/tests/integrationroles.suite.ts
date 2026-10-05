/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — the ROLE MATRIX.

   Every role the schema allows, against both endpoints, checked three ways:

     1. what the endpoint answers          (HTTP status + code)
     2. what the resulting ticket CLAIMS   (role + grants, verified by signature)
     3. that the two agree                 — a 200 that hands out the wrong
                                             grants is worse than a 403

   The matrix is the point. Any role added to the schema without a decision
   here shows up as an unexpected outcome rather than a silent default.

   Run: bun run test:integrationroles
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_integrationroles'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

import { generateKeyPairSync } from 'node:crypto'
const { privateKey } = generateKeyPairSync('ed25519')
process.env.INTEGRATION_JWT_PRIVATE_KEY =
  Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64')
process.env.INTEGRATION_JWT_KID = 'roles-key'

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
const { createServer } = await import('node:http')

const fakeClt = createServer((req, res) => {
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ courseId: 11, roomName: JSON.parse(b || '{}').roomName, courseCode: 'R1' }))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
process.env.CLT_BASE_URL   = `http://127.0.0.1:${(fakeClt.address() as { port: number }).port}`
process.env.CLT_S2S_SECRET = 'roles-secret'

const app = (await import('@/app.ts')).default
const {
  LiveClassModel, OrganizationModel, CourseModel, UserModel,
  ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { jwtVerify, importJWK } = await import('jose')
const keys = await import('@/utils/integrationKeys.ts')
const { ADMIN_OBSERVER_ROLES } = await import('@/services/liveClassJoin.service.ts')

/* Who signs in at the ADMIN portal — mirrors requireAnyAdmin. */
const ADMIN_PORTAL_ROLES = new Set(['super_admin', 'admin', 'sub_admin', 'support'])

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_integrationroles') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; bearer?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  /* Sent ALONGSIDE the cookie on purpose — that combination is what a browser
     produces during admin-portal impersonation, and what section E5 tests. */
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`
  const res = await fetch(`${BASE}${path}`, {
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

async function claimsOf(ticket: string) {
  const { keys: published } = await keys.publicJwks()
  const key = await importJWK(published[0] as never, 'EdDSA')
  const { payload } = await jwtVerify(ticket, key, {
    issuer: 'lms.deltainstitutions', audience: 'clt-connect', algorithms: ['EdDSA'],
  })
  return payload as Record<string, any>
}

const PW = 'CorrectHorse1'

/* Every role the schema permits. Adding one to the schema without adding it
   here makes this suite fail rather than silently defaulting. */
const ALL_ROLES = [
  'super_admin', 'admin', 'sub_admin', 'support',
  'instructor', 'student',
] as const

try {
  const org = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)

  const users: Record<string, any> = {}
  for (const role of ALL_ROLES) {
    users[role] = await UserModel.create({
      name: role, email: `${role}@roles.local`, passwordHash: hash, role, isActive: true,
      organizationId: org._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
      /* A sub_admin is a department head: one with no department is refused
         outright (plan.md §10, R2), so the generic one heads Forex — the
         generic course's department. */
      ...(role === 'sub_admin' ? { program: 'forex' } : {}),
    })
  }
  /* A second instructor: the one the class is actually assigned to. */
  const owner = await UserModel.create({
    name: 'owner', email: 'owner@roles.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })

  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: owner._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
    program: '4x-trading',
  })
  /* Started 5 minutes ago — "live now", the case the product cares about. */
  const live = await LiveClassModel.create({
    courseId: course._id, instructorId: owner._id, title: 'Live now',
    scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
    type: 'internal', provider: 'livekit', status: 'live',
    sessionCapacity: 30, organizationId: org._id,
  })

  const jars: Record<string, Jar> = {}
  for (const role of [...ALL_ROLES, 'owner']) {
    const email = role === 'owner' ? 'owner@roles.local' : `${role}@roles.local`
    const jar: Jar = new Map()
    /* Admin-panel roles sign in at the admin portal, everyone else at the client
       portal — the two issue different cookies (L-06).

       Deliberately NOT ADMIN_OBSERVER_ROLES: that set is about who may enter a
       classroom, and `support` is admin-panel staff who may not. Reusing it
       here would sign support in at the CLIENT portal and every later
       assertion about support would fail with a misleading 401, proving
       nothing about the rule under test. */
    const adminPortal = ADMIN_PORTAL_ROLES.has(role)
    const r = await call('POST', adminPortal ? '/admin/auth/login' : '/auth/login',
      { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`${role} login failed: ${r.status} ${JSON.stringify(r.body?.error)}`)
    jars[role] = jar
  }

  /* ═══════════════════════════════════════════════════ */
  section('A · HOST-TICKET — who may enter, and as what')

  const expected: Record<string, { status: number; ticketRole?: string; publish?: boolean; admin?: boolean }> = {
    owner:                    { status: 200, ticketRole: 'instructor', publish: true,  admin: true  },
    super_admin:              { status: 200, ticketRole: 'admin',      publish: false, admin: false },
    admin:                    { status: 200, ticketRole: 'admin',      publish: false, admin: false },
    sub_admin:                { status: 200, ticketRole: 'admin',      publish: false, admin: false },
    /* Admin-panel staff, but not classroom staff: support may READ a class and
       may not walk into it. */
    support:                  { status: 403 },
    /* These three carry a programme scope from their ROLE alone, and this
       class hangs off a course with no programme — so they are out of scope
       for it. Not a special case for live classes: it is the same verdict the
       admin API already returns when they merely try to READ this class, and
       section A2 asserts the two agree rather than trusting that sentence. */
    instructor:               { status: 403 },   // a peer, not oversight
    student:                  { status: 403 },
  }

  for (const [role, exp] of Object.entries(expected)) {
    const r = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars[role] })
    check(`host-ticket · ${role.padEnd(23)} → ${exp.status}`,
      r.status === exp.status, `got ${r.status} ${r.body?.error?.code ?? ''}`)

    if (exp.status === 200 && r.status === 200) {
      const c = await claimsOf(r.body.data.ticket)
      check(`   ${role.padEnd(23)} ticket role = ${exp.ticketRole}`,
        c.role === exp.ticketRole, c.role)
      check(`   ${role.padEnd(23)} canPublish = ${exp.publish}`,
        c.grants.canPublish === exp.publish, String(c.grants.canPublish))
      check(`   ${role.padEnd(23)} roomAdmin = ${exp.admin}`,
        c.grants.roomAdmin === exp.admin, String(c.grants.roomAdmin))
      check(`   ${role.padEnd(23)} sub is their own id`,
        c.sub === String(role === 'owner' ? owner._id : users[role]._id))
    }
  }

  section('A2 · JOIN is never looser than VIEW')
  /* Entering a live classroom hands over media; opening the class record hands
     over JSON. So the join gate must never admit someone the view gate would
     turn away — that direction is the hole.
     
     The reverse is allowed, and is used: `support` may read a class record and
     may NOT walk into the room, because entering a classroom full of students
     is not part of handling a support ticket. An earlier version of this
     asserted the two gates matched exactly, which would have made that
     deliberate rule look like a bug. */
  for (const role of ['super_admin', 'admin', 'sub_admin', 'support']) {
    const view = await call('GET',  `/admin/live-classes/${live._id}`,       { jar: jars[role] })
    const join = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars[role] })
    const viewOk = view.status === 200
    const joinOk = join.status === 200
    check(`${role.padEnd(12)} view ${view.status} / join ${join.status} — join not looser than view`,
      !(joinOk && !viewOk),
      'this role can ENTER a class it cannot even read')
  }
  /* And the one asymmetry we rely on, stated outright rather than implied. */
  {
    const view = await call('GET',  `/admin/live-classes/${live._id}`,       { jar: jars['support'] })
    const join = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['support'] })
    check('support may READ a class but not ENTER it',
      view.status === 200 && join.status === 403,
      `view ${view.status} join ${join.status}`)
  }

  section('B · only the ASSIGNED instructor gets room control')
  const ownerT = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['owner'] })
  const superT = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['super_admin'] })
  const oc = await claimsOf(ownerT.body.data.ticket)
  const sc = await claimsOf(superT.body.data.ticket)
  check('the assigned instructor may publish and moderate', oc.grants.canPublish && oc.grants.roomAdmin)
  check('a super admin may do NEITHER — observing is not participating',
    sc.grants.canPublish === false && sc.grants.roomAdmin === false,
    JSON.stringify(sc.grants))
  check('both are pointed at the same room', oc.roomName === sc.roomName)

  section('C · JOIN-TICKET — the student path')
  const studentJoinNoBooking = await call('POST', `/live-classes/${live._id}/join-ticket`, { jar: jars['student'] })
  check('a student with no booking → 403 NOT_BOOKED',
    studentJoinNoBooking.status === 403 && studentJoinNoBooking.body?.error?.code === 'NOT_BOOKED',
    `${studentJoinNoBooking.status} ${studentJoinNoBooking.body?.error?.code}`)

  await EnrollmentModel.create({ userId: users['student']._id, courseId: course._id })
  await ClassBookingModel.create({ userId: users['student']._id, liveClassId: live._id, status: 'booked' })
  const booked = await call('POST', `/live-classes/${live._id}/join-ticket`, { jar: jars['student'] })
  check('a BOOKED student joins a live-now class', booked.status === 200, String(booked.status))
  const bc = await claimsOf(booked.body.data.ticket)
  check('   as role=student', bc.role === 'student', bc.role)
  check('   may speak', bc.grants.canPublish === true)
  check('   never moderates', bc.grants.roomAdmin === false)
  check('   and enters directly, no lobby, because the class is live now',
    bc.grants.bypassLobby === true)

  section('D · join-ticket is the STUDENT door — staff do not fit through it')
  /* Refused either way, and the two refusals are both correct:
       401 — admin-panel staff hold `lms_admin_at`, not the client cookie the
             student door reads, so there is no client session at all
       403 — someone WITH a client session but no booking
     What matters is that no member of staff obtains a student ticket, which
     would carry canPublish and enter the room as a participant. */
  for (const role of ['super_admin', 'admin', 'sub_admin', 'support', 'instructor']) {
    const r = await call('POST', `/live-classes/${live._id}/join-ticket`, { jar: jars[role] })
    check(`join-ticket · ${role.padEnd(12)} refused (${r.status})`,
      r.status === 401 || r.status === 403, `got ${r.status} ${r.body?.error?.code ?? ''}`)
    check(`join-ticket · ${role.padEnd(12)} issued NO ticket`,
      r.body?.data?.ticket === undefined, 'a staff account must never hold a student ticket')
  }

  section('E · admin staff can drop into ANY class, not just one they own')
  const otherOwner = await UserModel.create({
    name: 'other', email: 'other@roles.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const foreign = await LiveClassModel.create({
    courseId: course._id, instructorId: otherOwner._id, title: 'Someone else’s class',
    scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
    type: 'internal', provider: 'livekit', status: 'live',
    sessionCapacity: 30, organizationId: org._id,
  })
  for (const role of ['super_admin', 'admin', 'sub_admin']) {
    const r = await call('POST', `/live-classes/${foreign._id}/host-ticket`, { jar: jars[role] })
    check(`${role.padEnd(12)} may observe another instructor’s class`, r.status === 200, String(r.status))
  }
  const sup = await call('POST', `/live-classes/${foreign._id}/host-ticket`, { jar: jars['support'] })
  check('but SUPPORT may not — reading a class is not entering it',
    sup.status === 403, `${sup.status} ${sup.body?.error?.code ?? ''}`)
  const peer = await call('POST', `/live-classes/${foreign._id}/host-ticket`, { jar: jars['owner'] })
  check('but an unassigned INSTRUCTOR still may not', peer.status === 403, String(peer.status))

  section('E2 · an admin may join HIDDEN (default) or VISIBLE (opt-in)')
  {
    /* Hidden is the default and must stay that way: an administrator dropping
       into a class must never end up on camera because a flag was forgotten. */
    const dflt = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['super_admin'] })
    const dc = await claimsOf(dflt.body.data.ticket)
    check('with no flag, an admin is hidden', dc.grants.hidden === true, String(dc.grants.hidden))
    check('and cannot publish', dc.grants.canPublish === false)
    check('the response says so, so the UI can label it',
      dflt.body.data.hidden === true, String(dflt.body.data.hidden))

    const off = await call('POST', `/live-classes/${live._id}/host-ticket`,
      { jar: jars['super_admin'], body: { visible: false } })
    const oc = await claimsOf(off.body.data.ticket)
    check('visible:false is hidden too', oc.grants.hidden === true && oc.grants.canPublish === false)

    const on = await call('POST', `/live-classes/${live._id}/host-ticket`,
      { jar: jars['super_admin'], body: { visible: true } })
    const vc = await claimsOf(on.body.data.ticket)
    check('visible:true UNHIDES them', vc.grants.hidden === false, String(vc.grants.hidden))
    check('and lets them speak', vc.grants.canPublish === true)
    /* Room control is a SEPARATE question from visibility, and E6 owns it.
       This block uses super_admin, the one role that does moderate when
       visible, so asserting "no room control" here would now contradict the
       rule rather than protect it. The org-admin case — visible, speaking,
       still not moderating — is checked in E6 against the roles it applies
       to. */
    check('and a visible SUPER admin moderates, which E6 pins per role',
      vc.grants.roomAdmin === true, String(vc.grants.roomAdmin))
    check('the response reports unhidden', on.body.data.hidden === false)

    /* The instructor is never hidden, and the flag must not change that. */
    const insVisible = await call('POST', `/live-classes/${live._id}/host-ticket`,
      { jar: jars['owner'], body: { visible: false } })
    const ic = await claimsOf(insVisible.body.data.ticket)
    check('an instructor is never hidden, even asking for visible:false',
      ic.grants.hidden === false && ic.grants.canPublish === true,
      JSON.stringify(ic.grants))
  }

  /* ═══════════════════════════════════════════════════ */
  section('E3 · observation is bounded by ACADEMY and by PROGRAMME')
  /* Being admin staff says you may watch classes. It does not say which. Both
     walls below are already enforced when the same account merely READS the
     class through the admin API, so the live room must not be the softer
     door. */
  {
    /* ── academy ── */
    const other = await OrganizationModel.create({
      name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer',
    })
    const foreignAdmin = await UserModel.create({
      name: 'bng admin', email: 'bng-admin@roles.local', passwordHash: hash,
      role: 'admin', isActive: true, organizationId: other._id,
    })
    const foreignJar: Jar = new Map()
    const fLogin = await call('POST', '/admin/auth/login',
      { jar: foreignJar, body: { email: 'bng-admin@roles.local', password: PW } })
    check('an admin of another academy can sign in', fLogin.status === 200, String(fLogin.status))

    const crossOrg = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: foreignJar })
    check('an ADMIN of another academy is refused',
      crossOrg.status === 403 && crossOrg.body?.error?.code === 'WRONG_ACADEMY',
      `${crossOrg.status} ${crossOrg.body?.error?.code}`)

    const superCross = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['super_admin'] })
    check('a SUPER admin crosses academies deliberately', superCross.status === 200, String(superCross.status))

    const sameOrg = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar: jars['admin'] })
    check('an admin of the SAME academy is unaffected', sameOrg.status === 200, String(sameOrg.status))

    /* ── programme ── */
    const dmCourse = await CourseModel.create({
      title: 'DM', slug: 'dm-' + Date.now(), description: 'd', instructorId: owner._id,
      price: 0, isFree: true, status: 'published', language: 'English',
      organizationId: org._id, program: 'digital-marketing',
    })
    const dmClass = await LiveClassModel.create({
      courseId: dmCourse._id, instructorId: owner._id, title: 'DM live',
      scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
      type: 'internal', provider: 'livekit', status: 'live',
      sessionCapacity: 30, organizationId: org._id,
    })
    const fxCourse = await CourseModel.create({
      title: 'FX', slug: 'fx-' + Date.now(), description: 'd', instructorId: owner._id,
      price: 0, isFree: true, status: 'published', language: 'English',
      organizationId: org._id, program: '4x-trading',
    })
    const fxClass = await LiveClassModel.create({
      courseId: fxCourse._id, instructorId: owner._id, title: 'FX live',
      scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
      type: 'internal', provider: 'livekit', status: 'live',
      sessionCapacity: 30, organizationId: org._id,
    })

    /* `program` on the user is the underscored spelling; injectCategoryScope
       normalises it to the hyphenated categoryScope the courses store. A test
       that hard-codes one form on both sides would pass through a broken
       mapping, so the two deliberately differ here. */
    await UserModel.create({
      name: 'dm sub', email: 'dm-sub@roles.local', passwordHash: hash,
      role: 'sub_admin', isActive: true, organizationId: org._id, program: 'digital_marketing',
    })
    const dmJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: dmJar, body: { email: 'dm-sub@roles.local', password: PW } })

    const inScope = await call('POST', `/live-classes/${dmClass._id}/host-ticket`, { jar: dmJar })
    check('a scoped sub_admin may observe a class in their OWN programme',
      inScope.status === 200, `${inScope.status} ${inScope.body?.error?.code ?? ''}`)
    if (inScope.status === 200) {
      const c = await claimsOf(inScope.body.data.ticket)
      check('  and still enters as a hidden observer, not a host',
        c.role === 'admin' && c.grants.hidden === true && c.grants.roomAdmin === false,
        JSON.stringify(c.grants))
    }

    const outScope = await call('POST', `/live-classes/${fxClass._id}/host-ticket`, { jar: dmJar })
    check('but is refused a class in ANOTHER programme',
      outScope.status === 403 && outScope.body?.error?.code === 'OUT_OF_SCOPE',
      `${outScope.status} ${outScope.body?.error?.code}`)

    const bareCourse = await CourseModel.create({
      title: 'Bare', slug: 'bare-' + Date.now(), description: 'd', instructorId: owner._id,
      price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
    })
    const bareClass = await LiveClassModel.create({
      courseId: bareCourse._id, instructorId: owner._id, title: 'No programme live',
      scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
      type: 'internal', provider: 'livekit', status: 'live',
      sessionCapacity: 30, organizationId: org._id,
    })
    const noProgramme = await call('POST', `/live-classes/${bareClass._id}/host-ticket`, { jar: dmJar })
    check('and a class with no programme at all — same rule as the admin API',
      noProgramme.status === 403 && noProgramme.body?.error?.code === 'OUT_OF_SCOPE',
      `${noProgramme.status} ${noProgramme.body?.error?.code}`)

    /* REVERSED on purpose (plan.md §10, R2): a sub_admin with no department
       used to be unscoped — every department. Now it reaches nothing. */
    await UserModel.create({
      name: 'no dept sub', email: 'no-dept-sub@roles.local', passwordHash: hash,
      role: 'sub_admin', isActive: true, organizationId: org._id,
    })
    const noDeptJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: noDeptJar, body: { email: 'no-dept-sub@roles.local', password: PW } })
    const unscoped = await call('POST', `/live-classes/${fxClass._id}/host-ticket`, { jar: noDeptJar })
    check('a sub_admin with NO department is refused — fail closed, never every department',
      unscoped.status === 403 && unscoped.body?.error?.code === 'NO_DEPARTMENT', `${unscoped.status} ${unscoped.body?.error?.code}`)

    const superScope = await call('POST', `/live-classes/${fxClass._id}/host-ticket`, { jar: jars['super_admin'] })
    check('and a super admin ignores programme too', superScope.status === 200, String(superScope.status))

    /* The gate must not touch the person actually teaching. */
    const ownerOwn = await call('POST', `/live-classes/${fxClass._id}/host-ticket`, { jar: jars['owner'] })
    check('the ASSIGNED instructor is never scope-checked out of their own class',
      ownerOwn.status === 200, `${ownerOwn.status} ${ownerOwn.body?.error?.code ?? ''}`)
  }

  /* ═══════════════════════════════════════════════════ */
  section('E4 · an instructor is never scoped out of a class they TEACH')
  /* An instructor's own `category` becomes a categoryScope, but it need not
     match the programme of every course they are booked to teach — a
     JURA-tagged instructor taking a 4x-trading session is ordinary staffing.
     Enforcing scope against them locked them out of their own class: the list
     showed it and host-ticket granted them a room, while the detail endpoint
     the studio page depends on answered 403, so the page read "Live class not
     found" and the class could never be started. */
  {
    const jura = await UserModel.create({
      name: 'jura teacher', email: 'jura-teacher@roles.local', passwordHash: hash,
      role: 'instructor', isActive: true, organizationId: org._id, category: 'jura',
    })
    /* Deliberately a course in a DIFFERENT programme from the instructor. */
    const fx = await CourseModel.create({
      title: 'FX2', slug: 'fx2-' + Date.now(), description: 'd', instructorId: owner._id,
      price: 0, isFree: true, status: 'published', language: 'English',
      organizationId: org._id, program: '4x-trading',
    })
    const mine = await LiveClassModel.create({
      courseId: fx._id, instructorId: jura._id, title: 'cross-programme session',
      scheduledStart: new Date(Date.now() - 5 * 60_000), durationMins: 60,
      type: 'internal', provider: 'livekit', status: 'live',
      sessionCapacity: 30, organizationId: org._id,
    })

    const jJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: jJar, body: { email: 'jura-teacher@roles.local', password: PW } })

    const list = await call('GET', '/admin/live-classes?status=all&limit=1000', { jar: jJar })
    const listed = Array.isArray(list.body?.data)
      && list.body.data.some((r: { id: string }) => r.id === String(mine._id))
    check('their class appears in their own list', listed, String(list.status))

    const detail = await call('GET', `/admin/live-classes/${mine._id}`, { jar: jJar })
    check('and the class DETAIL opens — the studio page depends on it',
      detail.status === 200, `${detail.status} ${detail.body?.error?.code ?? ''}`)

    const host = await call('POST', `/live-classes/${mine._id}/host-ticket`, { jar: jJar })
    check('and they can take a host ticket for it',
      host.status === 200, `${host.status} ${host.body?.error?.code ?? ''}`)

    check('list, detail and host-ticket all AGREE — no gate is the odd one out',
      listed && detail.status === 200 && host.status === 200,
      `list=${listed} detail=${detail.status} host=${host.status}`)

    /* The exemption is ownership, not the instructor role. Sign the other
       instructor in at the ADMIN portal for this one: jars['owner'] holds a
       client cookie, which /admin routes reject with 401 before any
       authorisation rule is reached — a green 401 here would have proved
       nothing about scope. */
    const otherJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: otherJar, body: { email: 'owner@roles.local', password: PW } })
    const stranger = await call('GET', `/admin/live-classes/${mine._id}`, { jar: otherJar })
    check('another instructor still cannot open it', stranger.status === 403,
      `${stranger.status} ${stranger.body?.error?.code ?? ''}`)

    /* A scoped admin is now always a sub_admin carrying a `program`; the
       role-name-encoded variants are gone. Sign one in here rather than
       reaching for a role that no longer exists. */
    await UserModel.create({
      name: 'ai sub', email: 'ai-sub@roles.local', passwordHash: hash,
      role: 'sub_admin', isActive: true, organizationId: org._id, program: 'ai',
    })
    const aiJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: aiJar, body: { email: 'ai-sub@roles.local', password: PW } })
    const scopedAdmin = await call('GET', `/admin/live-classes/${mine._id}`, { jar: aiJar })
    check('and a scoped ADMIN is still held to their programme',
      scopedAdmin.status === 403, String(scopedAdmin.status))
  }

  /* ═══════════════════════════════════════════════════ */
  section('E5 · impersonation must reach the routes that mint tickets')
  /* Admin-portal impersonation travels as a Bearer while the impersonator's
     own admin cookie is still on the request. authenticateAny used to read the
     cookie first, so the Bearer never won and the request was served as the
     IMPERSONATOR — silently, on every route mounted there.
     
     The visible damage: an impersonated instructor was not "the assigned
     instructor" of their own class, so the LMS issued an admin observer ticket
     and CLT answered "this class has not started yet" — a host who could not
     start their own room. */
  {
    const impJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: impJar, body: { email: 'super_admin@roles.local', password: PW } })

    const started = await call('POST', `/admin/users/${owner._id}/impersonate`, { jar: impJar })
    check('a super admin may impersonate the instructor', started.status === 200,
      `${started.status} ${started.body?.error?.code ?? ''}`)

    const bearer = started.body?.data?.token as string | undefined
    check('and receives an impersonation token', !!bearer)

    if (bearer) {
      /* Cookie AND bearer together — exactly what the browser sends. */
      const r = await call('POST', `/live-classes/${live._id}/host-ticket`,
        { jar: impJar, bearer, body: {} })
      check('host-ticket succeeds while impersonating', r.status === 200,
        `${r.status} ${r.body?.error?.code ?? ''}`)

      if (r.status === 200) {
        const c = await claimsOf(r.body.data.ticket)
        check('the ticket names the IMPERSONATED instructor, not the impersonator',
          c.sub === String(owner._id), `${c.sub} (impersonator is ${users['super_admin']._id})`)
        check('and carries the INSTRUCTOR role, so CLT will start the room',
          c.role === 'instructor', c.role)
        check('with publish and room control',
          c.grants.canPublish === true && c.grants.roomAdmin === true,
          JSON.stringify(c.grants))
      }
    }
  }

  /* ═══════════════════════════════════════════════════ */
  section('E6 · ROOM CONTROL — who may moderate, and who merely attends')
  /* The stated rule, one assertion per line of it:
       super admin  join as HOST or hidden, any class
       org admin    their academy only, join or hidden — guest, not host
       sub admin    their academy AND programme, join or hidden — guest
       instructor   host of their OWN class
       student      booked classes only                                */
  {
    const hostOf = async (jar: Jar | undefined, visible: boolean) => {
      const r = await call('POST', `/live-classes/${live._id}/host-ticket`, { jar, body: { visible } })
      if (r.status !== 200) return { status: r.status, grants: null as any }
      return { status: 200, grants: (await claimsOf(r.body.data.ticket)).grants }
    }

    const superVisible = await hostOf(jars['super_admin'], true)
    check('a VISIBLE super admin moderates — the platform owner is host',
      superVisible.grants?.roomAdmin === true && superVisible.grants?.canPublish === true,
      JSON.stringify(superVisible.grants))

    const superHidden = await hostOf(jars['super_admin'], false)
    check('a HIDDEN super admin does NOT — no moderating from behind an invisible identity',
      superHidden.grants?.roomAdmin === false && superHidden.grants?.hidden === true,
      JSON.stringify(superHidden.grants))

    for (const role of ['admin', 'sub_admin']) {
      const vis = await hostOf(jars[role], true)
      check(`a visible ${role.padEnd(10)} may speak but NOT moderate — a guest, not a second host`,
        vis.grants?.canPublish === true && vis.grants?.roomAdmin === false,
        JSON.stringify(vis.grants))
    }

    const ownerT = await hostOf(jars['owner'], false)
    check('the assigned instructor hosts their own class regardless of any flag',
      ownerT.grants?.roomAdmin === true && ownerT.grants?.hidden === false,
      JSON.stringify(ownerT.grants))

    check('ROOM_CONTROL is exactly one role wide',
      superVisible.grants?.roomAdmin === true
      && (await hostOf(jars['admin'], true)).grants?.roomAdmin === false
      && (await hostOf(jars['sub_admin'], true)).grants?.roomAdmin === false)
  }

  section('F · the matrix covers every role the schema allows')
  const schemaRoles: string[] = (UserModel.schema.path('role') as any).options.enum
  const covered = new Set(Object.keys(expected))
  const missing = schemaRoles.filter(r => !covered.has(r))
  check('no schema role is untested', missing.length === 0,
    `untested: ${missing.join(', ')} — add a decision for it`)
  /* Observers are admin-panel staff MINUS support, and the gap is the point:
     support may open a class record and may not enter the room. Asserted as an
     explicit subset so that a role added to the admin portal does not become a
     classroom observer by accident. */
  check('ADMIN_OBSERVER_ROLES is exactly the admin-panel set minus support',
    [...ADMIN_OBSERVER_ROLES].sort().join(',') === ['admin','sub_admin','super_admin'].join(','),
    [...ADMIN_OBSERVER_ROLES].join(','))
  check('every observer is admin-panel staff — no one observes who cannot sign in',
    [...ADMIN_OBSERVER_ROLES].every(r => ADMIN_PORTAL_ROLES.has(r)))
  check('support is admin-panel staff but NOT an observer',
    ADMIN_PORTAL_ROLES.has('support') && !ADMIN_OBSERVER_ROLES.has('support'))

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
  fakeClt.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
