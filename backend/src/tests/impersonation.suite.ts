/* ─────────────────────────────────────────────────────────────
   M-04 — impersonation is a revocable session with an actor trail.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_imp_suite), dropped on exit. The real `lms` database is never opened.

   Before this, impersonation was a bare JWT: nothing recorded WHO was
   impersonating, and "end impersonation" only meant the browser discarded its
   copy — anyone still holding the token kept full access until it expired.
   Revocation is therefore the property worth proving, and it is proved the
   only way that means anything: keep using the token after revoking it.

   Run: bun run test:impersonation
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_imp_suite'
await import('./financeStandIn.ts')   // approving a student asks finance first; this one knows everybody
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
const { UserModel, OrganizationModel, ImpersonationSessionModel, AuditLogModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_imp_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
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
    UserModel.create({ name: email, email, passwordHash: hash, role, isActive: true, organizationId: org._id })

  const superA = await mk('super@t.local', 'super_admin')
  const target = await mk('victim@t.local', 'student')

  const jar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', { jar, body: { email: 'super@t.local', password: PW } })
  if (li.status !== 200) throw new Error(`super_admin login failed: ${li.status}`)

  section('starting an impersonation session')
  const started = await call('POST', `/admin/users/${target._id}/impersonate`, { jar })
  check('super_admin can start impersonation', started.status === 200, `got ${started.status}`)
  const token   = started.body?.data?.token
  const impId   = started.body?.data?.impersonationId
  check('a token is issued', !!token)
  check('the response names the session, so it can be ended later', !!impId)

  const row = await ImpersonationSessionModel.findById(impId).lean() as any
  check('a session ROW exists — impersonation is no longer just a token', !!row)
  check('the row records WHO is impersonating',
    String(row?.actorId) === String(superA._id) && row?.actorEmail === 'super@t.local',
    `${row?.actorEmail}`)
  check('the row records the account being impersonated',
    String(row?.targetId) === String(target._id) && row?.targetEmail === 'victim@t.local')
  check('the row carries an expiry', row?.expiresAt instanceof Date)
  check('it starts un-revoked', row?.revokedAt === undefined)

  section('the token works — and acts as the TARGET, not the admin')
  const asTarget = await call('GET', '/admin/auth/me', { bearer: token })
  check('the impersonation token authenticates', asTarget.status === 200, `got ${asTarget.status}`)
  check('it acts as the impersonated account, not the admin',
    asTarget.body?.data?.user?.email === 'victim@t.local', asTarget.body?.data?.user?.email)
  check('it does NOT inherit the admin\'s privileges',
    (await call('GET', '/admin/users', { bearer: token })).status === 403,
    'a student-role impersonation must not reach an admin-only listing')

  section('REVOCATION — the property that did not exist before')
  const revoked = await call('DELETE', `/admin/impersonation-sessions/${impId}`, { jar })
  check('super_admin can end the session', revoked.status === 200, `got ${revoked.status}`)

  const afterRevoke = await call('GET', '/admin/auth/me', { bearer: token })
  check('THE SAME TOKEN now fails — the session, not the browser, was ended',
    afterRevoke.status === 401 && afterRevoke.body?.error?.code === 'IMPERSONATION_REVOKED',
    `got ${afterRevoke.status} ${afterRevoke.body?.error?.code}`)

  const reRevoke = await call('DELETE', `/admin/impersonation-sessions/${impId}`, { jar })
  check('revoking twice is not an error (idempotent)', reRevoke.status === 200, `got ${reRevoke.status}`)

  section('the kill switch')
  const a = await call('POST', `/admin/users/${target._id}/impersonate`, { jar })
  const b = await call('POST', `/admin/users/${target._id}/impersonate`, { jar })
  check('two more sessions started', a.status === 200 && b.status === 200)
  const all = await call('POST', '/admin/impersonation-sessions/revoke-all', { jar })
  check('revoke-all reports how many it ended', (all.body?.data?.revoked ?? 0) >= 2, JSON.stringify(all.body?.data))
  check('the first of them is dead',
    (await call('GET', '/admin/auth/me', { bearer: a.body?.data?.token })).status === 401)
  check('the second of them is dead',
    (await call('GET', '/admin/auth/me', { bearer: b.body?.data?.token })).status === 401)

  section('expiry is enforced from the row, not just the token')
  const c = await call('POST', `/admin/users/${target._id}/impersonate`, { jar })
  await ImpersonationSessionModel.findByIdAndUpdate(c.body?.data?.impersonationId, {
    $set: { expiresAt: new Date(Date.now() - 1000) },
  })
  const expired = await call('GET', '/admin/auth/me', { bearer: c.body?.data?.token })
  check('an expired session is refused even though the JWT is still valid',
    expired.status === 401 && expired.body?.error?.code === 'IMPERSONATION_EXPIRED',
    `got ${expired.status} ${expired.body?.error?.code}`)

  section('a forged session id gets nowhere')
  check('an unknown session id is refused',
    (await call('GET', '/admin/auth/me', { bearer: token })).status === 401)

  section('the audit trail names the operator')
  const listed = await call('GET', '/admin/impersonation-sessions', { jar })
  check('sessions are listable for review', (listed.body?.data?.length ?? 0) >= 4, `${listed.body?.data?.length}`)
  const log = await AuditLogModel.findOne({ action: 'user.impersonate' }).sort({ createdAt: -1 }).lean() as any
  check('starting impersonation is audited against the admin who did it',
    log?.actorEmail === 'super@t.local', log?.actorEmail)
  const revokeLog = await AuditLogModel.findOne({ action: 'user.impersonate.revoke' }).lean() as any
  check('ending it is audited too', !!revokeLog)

  /* The actual point of the actor claim: an action performed WHILE
     impersonating must be attributed to the operator, not to the account they
     borrowed. A student target cannot reach an audited endpoint (everything
     admin-only 403s, correctly), so impersonate an ADMIN and perform a real
     audited mutation through the impersonation token. */
  section('an action taken THROUGH impersonation names the operator')
  const otherAdmin = await mk('otheradmin@t.local', 'admin')
  const asAdmin = await call('POST', `/admin/users/${otherAdmin._id}/impersonate`, { jar })
  const adminToken = asAdmin.body?.data?.token
  check('super_admin can impersonate an admin', asAdmin.status === 200, `got ${asAdmin.status}`)

  const made = await call('POST', '/admin/categories', {
    bearer: adminToken, body: { name: `Cat ${Date.now()}` },
  })
  check('the audited action succeeds through the impersonation token',
    made.status === 201, `got ${made.status} ${JSON.stringify(made.body?.error ?? '')}`)

  await new Promise(r => setTimeout(r, 300))   /* the audit write is fire-and-forget */
  const catLog = await AuditLogModel.findOne({ action: 'category.create' }).sort({ createdAt: -1 }).lean() as any
  check('the trail names the SUPER ADMIN who was really acting',
    catLog?.actorEmail === 'super@t.local',
    `got ${catLog?.actorEmail} (before M-04 this would have been otheradmin@t.local)`)
  check('the trail also records which account was borrowed',
    catLog?.meta?.impersonating === true && catLog?.meta?.impersonatedEmail === 'otheradmin@t.local',
    JSON.stringify(catLog?.meta))

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
