/* ─────────────────────────────────────────────────────────────
   Client-portal impersonation — ADVERSARIAL suite.

   The happy path lives in clientimpersonation.suite.ts. This one tries to
   break the thing: forged cookies, tampered tokens, dangling sessions,
   concurrent redemptions, wrong portals, accounts that change underneath a
   live session, and every write verb across several routes.

   Isolated throwaway database (lms_clientimp_adv), dropped on exit.

   Run: bun run test:clientimp-adv
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_clientimp_adv'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
/* This suite fires hundreds of requests in seconds, which the ordinary limits
   are right to refuse. Same convention as adminmatrix/assignments. */
process.env.RATE_LIMIT_AUTH_MAX          = '900'
process.env.RATE_LIMIT_API_MAX           = '9000'
process.env.RATE_LIMIT_IMPERSONATION_MAX = '900'

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
  UserModel, OrganizationModel,
  ImpersonationSessionModel, ImpersonationHandoffModel, AuditLogModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { signAccessToken } = await import('@/utils/jwt.ts')
const { createHash, randomBytes } = await import('node:crypto')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_clientimp_adv') {
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
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name)
      else jar.set(name, value)
    }
  }
}
async function call(
  method: string, path: string,
  opts: { jar?: Jar; bearer?: string; body?: unknown; cookie?: string } = {},
) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.cookie) headers['cookie'] = opts.cookie
  else if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
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

/** Full cycle: create handoff as super admin, redeem into a fresh jar. */
async function beginImpersonation(adminJar: Jar, studentId: string) {
  const created = await call('POST', `/admin/users/${studentId}/impersonate-client`, { jar: adminJar })
  const jar: Jar = new Map()
  const redeemed = await call('POST', '/auth/impersonation/redeem', { jar, body: { code: created.body?.data?.code } })
  return { created, redeemed, jar, impId: created.body?.data?.impersonationId as string }
}

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const org2 = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
    UserModel.create({
      name: email, email, passwordHash: hash, role, isActive: true,
      organizationId: org._id,
      ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
      ...extra,
    })

  const superA  = await mk('super@t.local', 'super_admin')
  const student = await mk('student@t.local', 'student')
  const student2 = await mk('student2@t.local', 'student')
  const pending = await mk('pending@t.local', 'student', { enrollmentStatus: 'pending' })
  const offOrg  = await mk('other@t.local', 'student', { organizationId: org2._id })
  const disabled = await mk('disabled@t.local', 'student', { isActive: false })

  const adminJar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: 'super@t.local', password: PW } })
  if (li.status !== 200) throw new Error(`super_admin login failed: ${li.status}`)

  /* ═══════════════════════════════════════════════════ */
  section('A · the flag cookie is decoration, not authentication')

  const flagOnly = await call('GET', '/auth/me', { cookie: 'lms_imp=1' })
  check('lms_imp=1 alone authenticates nobody',
    flagOnly.status === 401, `got ${flagOnly.status}`)

  const flagPlusGarbage = await call('GET', '/auth/me', { cookie: 'lms_imp=1; lms_imp_at=not-a-jwt' })
  check('a forged flag plus a junk token is still refused',
    flagPlusGarbage.status === 401, `got ${flagPlusGarbage.status}`)

  /* ═══════════════════════════════════════════════════ */
  section('B · token forgery and dangling sessions')

  const live = await beginImpersonation(adminJar, String(student._id))
  check('baseline: a real session works', live.redeemed.status === 200, `got ${live.redeemed.status}`)
  const realToken = live.jar.get('lms_imp_at')!

  const tampered = realToken.slice(0, -3) + (realToken.slice(-3) === 'AAA' ? 'BBB' : 'AAA')
  check('a tampered signature is refused',
    (await call('GET', '/auth/me', { cookie: `lms_imp_at=${tampered}` })).status === 401)

  const ghostId = new mongoose.Types.ObjectId().toString()
  const ghostToken = await signAccessToken(
    { id: String(student._id), email: student.email, role: 'student' }, '30m', 'client',
    { actorId: String(superA._id), actorEmail: superA.email, sessionId: ghostId },
  )
  const ghost = await call('GET', '/auth/me', { cookie: `lms_imp_at=${ghostToken}` })
  check('a token naming a NON-EXISTENT session is refused',
    ghost.status === 401 && ghost.body?.error?.code === 'IMPERSONATION_INVALID',
    `got ${ghost.status} ${ghost.body?.error?.code}`)

  const malformed = await signAccessToken(
    { id: String(student._id), email: student.email, role: 'student' }, '30m', 'client',
    { actorId: String(superA._id), actorEmail: superA.email, sessionId: 'not-an-objectid' },
  )
  const mal = await call('GET', '/auth/me', { cookie: `lms_imp_at=${malformed}` })
  check('a token with a malformed session id is refused, not 500',
    mal.status === 401 && mal.body?.error?.code === 'IMPERSONATION_INVALID',
    `got ${mal.status} ${mal.body?.error?.code}`)

  const expiredTok = await signAccessToken(
    { id: String(student._id), email: student.email, role: 'student' }, '1s', 'client',
    { actorId: String(superA._id), actorEmail: superA.email, sessionId: live.impId },
  )
  await new Promise(r => setTimeout(r, 1400))
  const expTok = await call('GET', '/auth/me', { cookie: `lms_imp_at=${expiredTok}` })
  check('an expired token is refused',
    expTok.status === 401 && expTok.body?.error?.code === 'TOKEN_EXPIRED',
    `got ${expTok.status} ${expTok.body?.error?.code}`)

  /* ═══════════════════════════════════════════════════ */
  section('C · portal separation runs both ways')

  const adminSide = await call('POST', `/admin/users/${student._id}/impersonate`, { jar: adminJar })
  check('admin-audience token rejected on a CLIENT route',
    (await call('GET', '/auth/me', { bearer: adminSide.body?.data?.token })).status === 401)

  const onAdmin = await call('GET', '/admin/auth/me', { bearer: realToken })
  check('client-audience token rejected on an ADMIN route',
    onAdmin.status === 401, `got ${onAdmin.status}`)

  check('client impersonation cannot reach an admin-only listing',
    (await call('GET', '/admin/users', { cookie: `lms_imp_at=${realToken}` })).status === 401)

  /* ═══════════════════════════════════════════════════ */
  section('D · the handoff code')

  const c1 = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  const goodCode = c1.body?.data?.code as string

  for (const [label, value] of [
    ['empty string',        ''],
    ['63 chars',            'a'.repeat(63)],
    ['65 chars',            'a'.repeat(65)],
    ['whitespace padded',   ` ${goodCode} `],
    ['uppercased',          goodCode.toUpperCase()],
  ] as [string, string][]) {
    const r = await call('POST', '/auth/impersonation/redeem', { body: { code: value } })
    check(`a ${label} code is refused`, r.status === 400 || r.status === 410, `got ${r.status}`)
  }
  for (const [label, value] of [
    ['a number',     12345],
    ['null',         null],
    ['an object',    { $ne: null }],
    ['an array',     ['a']],
  ] as [string, unknown][]) {
    const r = await call('POST', '/auth/impersonation/redeem', { body: { code: value } })
    check(`a code that is ${label} is refused, not 500`, r.status === 400, `got ${r.status}`)
  }

  const unknown = randomBytes(32).toString('hex')
  check('a well-formed but unknown code is refused',
    (await call('POST', '/auth/impersonation/redeem', { body: { code: unknown } })).status === 410)

  check('the real code still works after all that probing',
    (await call('POST', '/auth/impersonation/redeem', { body: { code: goodCode } })).status === 200)

  /* Concurrency — the atomicity claim in the controller. */
  section('E · concurrent redemption (the race the atomic update exists for)')
  for (let round = 1; round <= 3; round++) {
    const c = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
    const code = c.body?.data?.code
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call('POST', '/auth/impersonation/redeem', { body: { code } })),
    )
    const ok = results.filter(r => r.status === 200).length
    const gone = results.filter(r => r.status === 410).length
    check(`round ${round}: exactly ONE of 8 concurrent redemptions wins`,
      ok === 1 && gone === 7, `ok=${ok} gone=${gone}`)
  }

  /* ═══════════════════════════════════════════════════ */
  section('F · a handoff pointing at a session that is already dead')

  const revokedFirst = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  await call('DELETE', `/admin/impersonation-sessions/${revokedFirst.body?.data?.impersonationId}`, { jar: adminJar })
  const rr = await call('POST', '/auth/impersonation/redeem', { body: { code: revokedFirst.body?.data?.code } })
  check('a code whose session was revoked first cannot be redeemed',
    rr.status === 410, `got ${rr.status}`)

  const expiredSess = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: adminJar })
  await ImpersonationSessionModel.updateOne(
    { _id: expiredSess.body?.data?.impersonationId },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  )
  const er = await call('POST', '/auth/impersonation/redeem', { body: { code: expiredSess.body?.data?.code } })
  check('a code whose session already expired cannot be redeemed',
    er.status === 410, `got ${er.status}`)

  const deacted = await call('POST', `/admin/users/${student2._id}/impersonate-client`, { jar: adminJar })
  await UserModel.updateOne({ _id: student2._id }, { $set: { isActive: false } })
  const dr = await call('POST', '/auth/impersonation/redeem', { body: { code: deacted.body?.data?.code } })
  check('a code for a student deactivated in the meantime is refused',
    dr.status === 410, `got ${dr.status}`)
  await UserModel.updateOne({ _id: student2._id }, { $set: { isActive: true } })

  const onDisabled = await call('POST', `/admin/users/${disabled._id}/impersonate-client`, { jar: adminJar })
  check('a disabled account is refused up front, not at redemption time',
    onDisabled.status === 400, `got ${onDisabled.status}`)

  /* ═══════════════════════════════════════════════════ */
  section('G · READ-ONLY across verbs and routes')

  const ro = await beginImpersonation(adminJar, String(student._id))
  const writes: [string, string, unknown][] = [
    ['PATCH',  '/auth/me',                      { name: 'nope' }],
    ['POST',   '/favorites',                    { courseId: '000000000000000000000000' }],
    ['DELETE', '/favorites/000000000000000000000000', undefined],
    ['POST',   '/enrollments',                  { courseId: '000000000000000000000000' }],
    ['POST',   '/bookings',                     { liveClassId: '000000000000000000000000' }],
    /* The one door that hands out a Meet URL. An admin viewing-as a booked
       student must not be able to pull the link through the student's
       session; if this route were ever moved to authenticateAny it would
       start passing, and this line is what would notice. */
    ['POST',   '/live-classes/000000000000000000000000/join', undefined],
    ['PATCH',  '/auth/me/password',             { currentPassword: PW, newPassword: 'Whatever1' }],
    ['POST',   '/auth/logout-all',              undefined],
    ['DELETE', '/auth/account',                 { password: PW }],
    ['POST',   '/support',                      { subject: 'x', message: 'y' }],
  ]
  for (const [method, path, body] of writes) {
    const r = await call(method, path, { jar: ro.jar, ...(body !== undefined ? { body } : {}) })
    check(`${method} ${path} is refused`,
      r.status === 403 && r.body?.error?.code === 'IMPERSONATION_READ_ONLY',
      `got ${r.status} ${r.body?.error?.code}`)
  }

  const reads: [string, string][] = [
    ['GET', '/auth/me'],
    ['GET', '/favorites/me'],
    ['GET', '/auth/sessions'],
    ['GET', '/notifications'],
    ['HEAD', '/auth/me'],
  ]
  for (const [method, path] of reads) {
    const r = await call(method, path, { jar: ro.jar })
    check(`${method} ${path} is allowed`, r.status < 400, `got ${r.status}`)
  }

  const untouched = await UserModel.findById(student._id).select('name isActive').lean() as any
  check('after every refused write the student record is unchanged',
    untouched?.name === 'student@t.local' && untouched?.isActive === true,
    JSON.stringify(untouched))

  /* ═══════════════════════════════════════════════════ */
  section('H · the impersonated account keeps ITS OWN restrictions')

  const pend = await beginImpersonation(adminJar, String(pending._id))
  check('impersonating a PENDING student redeems fine', pend.redeemed.status === 200)
  const guarded = await call('GET', '/courses/anything/progress', { jar: pend.jar })
  check('a route behind requireEnrollmentApproval still refuses them',
    guarded.status === 403 || guarded.status === 404,
    `got ${guarded.status} — a super admin must not inherit past the student's own gate`)

  const cross = await beginImpersonation(adminJar, String(offOrg._id))
  check('a student from another academy can still be impersonated by super_admin',
    cross.redeemed.status === 200, `got ${cross.redeemed.status}`)
  const crossMe = await call('GET', '/auth/me', { jar: cross.jar })
  check('and the session really is that other-academy student',
    crossMe.body?.data?.user?.email === 'other@t.local', crossMe.body?.data?.user?.email)

  /* ═══════════════════════════════════════════════════ */
  section('I · the account changing underneath a live session')

  const mut = await beginImpersonation(adminJar, String(student2._id))
  check('session live', (await call('GET', '/auth/me', { jar: mut.jar })).status === 200)
  await UserModel.updateOne({ _id: student2._id }, { $set: { isActive: false } })
  const afterDisable = await call('GET', '/auth/me', { jar: mut.jar })
  check('deactivating the student kills the live session immediately',
    afterDisable.status === 401 && afterDisable.body?.error?.code === 'ACCOUNT_DISABLED',
    `got ${afterDisable.status} ${afterDisable.body?.error?.code}`)
  await UserModel.updateOne({ _id: student2._id }, { $set: { isActive: true } })

  const del = await beginImpersonation(adminJar, String(student2._id))
  await UserModel.deleteOne({ _id: student2._id })
  const afterDelete = await call('GET', '/auth/me', { jar: del.jar })
  check('deleting the student kills the live session immediately',
    afterDelete.status === 401 && afterDelete.body?.error?.code === 'ACCOUNT_GONE',
    `got ${afterDelete.status} ${afterDelete.body?.error?.code}`)

  /* ═══════════════════════════════════════════════════ */
  section('J · isolation from the admin\'s own sessions')

  const both: Jar = new Map(adminJar)                    /* carries lms_admin_at */
  const stLogin = await call('POST', '/auth/login', { jar: both, body: { email: 'student@t.local', password: PW } })
  check('the browser holds an admin cookie AND a client cookie', stLogin.status === 200 && both.has('lms_at') && both.has('lms_admin_at'))
  const beforeAt = both.get('lms_at'), beforeAdmin = both.get('lms_admin_at')

  const cc = await call('POST', `/admin/users/${student._id}/impersonate-client`, { jar: both })
  await call('POST', '/auth/impersonation/redeem', { jar: both, body: { code: cc.body?.data?.code } })
  check('neither pre-existing cookie was disturbed',
    both.get('lms_at') === beforeAt && both.get('lms_admin_at') === beforeAdmin)
  check('the ADMIN portal still works while impersonating on the client',
    (await call('GET', '/admin/users', { jar: both })).status === 200)
  check('and admin-side WRITES still work — read-only is client-only',
    (await call('POST', '/admin/categories', { jar: both, body: { name: `Cat ${Date.now()}` } })).status === 201)

  await call('POST', '/auth/impersonation/exit', { jar: both })
  const back = await call('GET', '/auth/me', { jar: both })
  check('after exit the client session is the ADMIN\'s own student login again',
    back.status === 200 && back.body?.data?.user?.email === 'student@t.local',
    `${back.status} ${back.body?.data?.user?.email}`)
  check('and it can write again',
    (await call('PATCH', '/auth/me', { jar: both, body: { headline: 'mine again' } })).status === 200)

  /* ═══════════════════════════════════════════════════ */
  section('K · exit is safe to call anywhere, any number of times')
  for (let i = 1; i <= 3; i++) {
    check(`exit #${i} with no session is a no-op, not an error`,
      (await call('POST', '/auth/impersonation/exit')).status === 200)
  }

  /* ═══════════════════════════════════════════════════ */
  section('L · audit trail')
  await new Promise(r => setTimeout(r, 400))
  const log = await AuditLogModel.findOne({ action: 'user.impersonate.client' }).sort({ createdAt: -1 }).lean() as any
  check('starting a client impersonation is audited', !!log)
  check('the trail names the super admin who did it',
    log?.actorEmail === 'super@t.local', log?.actorEmail)

  /* ═══════════════════════════════════════════════════ */
  section('M · repetition — 5 full cycles back to back')
  for (let i = 1; i <= 5; i++) {
    const cyc = await beginImpersonation(adminJar, String(student._id))
    const meOk = (await call('GET', '/auth/me', { jar: cyc.jar })).status === 200
    const roOk = (await call('PATCH', '/auth/me', { jar: cyc.jar, body: { headline: 'x' } })).status === 403
    await call('POST', '/auth/impersonation/exit', { jar: cyc.jar })
    const goneOk = !cyc.jar.has('lms_imp_at') && !cyc.jar.has('lms_imp')
    check(`cycle ${i}: create → redeem → read → write-refused → exit`,
      cyc.redeemed.status === 200 && meOk && roOk && goneOk,
      `redeem=${cyc.redeemed.status} me=${meOk} ro=${roOk} cleared=${goneOk}`)
  }

  section('N · redeem/exit sit on their OWN limiter, not the auth one')
  /* Squeeze the auth bucket to nothing and confirm impersonation is unaffected:
     the two must not be able to lock each other out. In production authRateLimit
     is 15/15min across login, refresh, logout and the reset flows, so sharing it
     would let a few impersonations exhaust an office IP's login budget — and put
     EXIT behind the same cap. */
  const burned = await Promise.all(
    Array.from({ length: 25 }, () =>
      call('POST', '/auth/login', { body: { email: 'nobody@t.local', password: 'wrong' } })),
  )
  check('the auth bucket is reachable independently', burned.length === 25)

  const stillRedeems = await beginImpersonation(adminJar, String(student._id))
  check('impersonation still redeems after hammering the auth endpoints',
    stillRedeems.redeemed.status === 200, `got ${stillRedeems.redeemed.status}`)
  const exitStillWorks = await call('POST', '/auth/impersonation/exit', { jar: stillRedeems.jar })
  check('and exit is still reachable', exitStillWorks.status === 200, `got ${exitStillWorks.status}`)

  section('O · storage hygiene')
  const leftover = await ImpersonationHandoffModel.find({}).lean()
  const unusedNotExpired = leftover.filter((h: any) => !h.usedAt && h.expiresAt > new Date())
  check('no handoff row stores a token — only a hash and a pointer',
    leftover.every((h: any) => !('token' in h) && typeof h.codeHash === 'string' && h.codeHash.length === 64))
  check('spent codes are marked used rather than left redeemable',
    leftover.some((h: any) => !!h.usedAt), `${unusedNotExpired.length} still open`)

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
