/* ─────────────────────────────────────────────────────────────
   "View as student", for the commission portal
   (services/portalStudentView.service.ts, routes/portalActivity.routes.ts).

   Pinned here, against a real database and the real app:

     A. a link for an active student: the student app's /imp/enter with a
        one-time code, good for 60 seconds, over a session of
        IMPERSONATION_EXPIRES_IN — the code stored only as its hash;
     B. who looked: the CS's own LMS account when they have one, else the
        shared one — the CS's address on the session either way, so the
        student app's banner and the admin's sessions screen name them; the
        session in the STUDENT's academy; audited as user.impersonate.client;
     C. only an active student: nobody by that address, a member of staff, a
        disabled account, a malformed address — refused, and nothing started;
        with neither account to start it from, a 503 that says so;
     D. over HTTP, only behind the /service secret check; the link redeems
        once, is the student's own LMS, READ-ONLY; the academy's admins see it
        on their Impersonation sessions screen and can end it, and the view
        dies at once.

   Run: bun --no-env-file src/tests/portalstudentview.suite.ts
   (PORTALSTUDENTVIEW_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALSTUDENTVIEW_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalstudentview'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.FINANCE_API_URL = ''
delete process.env.WHATSAPP_API_KEY
delete process.env.WHATSAPP_PHONE_NUMBER_ID
delete process.env.IMPERSONATION_EXPIRES_IN
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalstudentview-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalstudentview-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalstudentview-suite-refresh-secret-0123456789'
const CRM_SECRET = 'portalstudentview-suite-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ''
process.env.PORTAL_SUPPORT_USER_EMAIL = 'desk@lms.test'
process.env.CLIENT_URL = 'https://learn.lms.test/'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const { createHash } = await import('node:crypto')
const mongoose = (await import('mongoose')).default
const { UserModel, OrganizationModel, ImpersonationSessionModel, ImpersonationHandoffModel, AuditLogModel } = await import('@/models/schema.ts')
const { studentViewForPortal } = await import('@/services/portalStudentView.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalstudentview') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const idOf = (v: unknown) => String(v)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const near = (when: number | string | Date | undefined, to: number) => when !== undefined && Math.abs(new Date(when).getTime() - to) < 10_000
const codeOf = (url: string) => new URL(url).searchParams.get('code') ?? ''

/** What a call refused with: its code and status, or 'ok'. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return 'ok' } catch (err) {
    return err instanceof PortalError ? `${err.code} ${err.statusCode}` : `threw ${String(err)}`
  }
}

/* ── Two academies; the shared desk account, a CS with an LMS account of their own, an admin each; students ── */
const PW = 'CorrectHorse1'
const hash = await hashPassword(PW)
const dubai = await OrganizationModel.create({ name: 'Delta Institutions Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const blr = await OrganizationModel.create({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const person = async (email: string, name: string, role: string, org: { _id: unknown }, more: Record<string, unknown> = {}) =>
  (await UserModel.create({ email, name, role, passwordHash: hash, isActive: true, organizationId: org._id, ...more }))._id
const desk = await person('desk@lms.test', 'Delta Support', 'support', dubai)
const ownCs = await person('cara.cs@portal.test', 'Cara Own', 'sub_admin', dubai)
await person('admin.dubai@lms.test', 'Dubai Admin', 'admin', dubai)
await person('admin.blr@lms.test', 'Bangalore Admin', 'admin', blr)
const sam = await person('sam@lms.test', 'Sam Student', 'student', dubai, { enrollmentStatus: 'approved' })
const bea = await person('bea@lms.test', 'Bea Bangalore', 'student', blr, { enrollmentStatus: 'approved' })
await person('dee@lms.test', 'Dee Disabled', 'student', dubai, { enrollmentStatus: 'approved', isActive: false })

step('A. A link for an active student')
const first = await studentViewForPortal({ email: '  Sam@LMS.test ', byName: 'Cara CS', byEmail: 'Cara.CS@portal.test' })
const code = codeOf(first.url)
check("the student app's /imp/enter, with a one-time code — the address as the portal has it",
  first.url.startsWith('https://learn.lms.test/imp/enter?code=') && /^[a-f\d]{64}$/.test(code), first.url)
check('the code good for 60 seconds', first.expiresIn === 60)
const session = await ImpersonationSessionModel.findOne({ targetEmail: 'sam@lms.test' }).lean()
check('over a 30-minute session, IMPERSONATION_EXPIRES_IN not being set',
  near(first.sessionExpiresAt, Date.now() + 30 * 60_000) && session?.expiresAt.toISOString() === first.sessionExpiresAt, first.sessionExpiresAt)
const handoff = await ImpersonationHandoffModel.findOne({ sessionId: session?._id }).lean()
check('the code kept only as its hash, for those 60 seconds, unused',
  handoff?.codeHash === sha(code) && handoff?.codeHash !== code && near(handoff?.expiresAt, Date.now() + 60_000) && !handoff?.usedAt)
process.env.IMPERSONATION_EXPIRES_IN = '10m'
const shorter = await studentViewForPortal({ email: 'sam@lms.test', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' })
delete process.env.IMPERSONATION_EXPIRES_IN
check('IMPERSONATION_EXPIRES_IN, when it is set', near(shorter.sessionExpiresAt, Date.now() + 10 * 60_000), shorter.sessionExpiresAt)
check('every link its own code, and its own session',
  codeOf(shorter.url) !== code && await ImpersonationSessionModel.countDocuments({ targetEmail: 'sam@lms.test' }) === 2)

step('B. Who looked')
check("from the CS's own LMS account, their address on it",
  idOf(session?.actorId) === idOf(ownCs) && session?.actorEmail === 'cara.cs@portal.test' && first.from === 'own', JSON.stringify(session))
check("...on the student, in the student's academy",
  idOf(session?.targetId) === idOf(sam) && session?.targetEmail === 'sam@lms.test' && idOf(session?.organizationId) === idOf(dubai._id))
check('...saying it came from Tetra Commission, and who', session?.userAgent === 'Tetra Commission — Cara CS', session?.userAgent)
const audit = await AuditLogModel.findOne({ 'meta.sessionId': idOf(session?._id) }).lean() as Record<string, any> | null
check("audited as the admin's view is: user.impersonate.client, on the student, in their academy",
  audit?.action === 'user.impersonate.client' && audit?.entity === 'User' && audit?.entityId === idOf(sam)
    && idOf(audit?.actorId) === idOf(ownCs) && audit?.actorEmail === 'cara.cs@portal.test' && audit?.actorRole === 'sub_admin'
    && idOf(audit?.organizationId) === idOf(dubai._id), JSON.stringify(audit))
check('...with who it was in the portal',
  audit?.meta?.via === 'tetra-commission' && audit?.meta?.byName === 'Cara CS' && audit?.meta?.byEmail === 'cara.cs@portal.test' && audit?.meta?.from === 'own',
  JSON.stringify(audit?.meta))

const viaShared = await studentViewForPortal({ email: 'bea@lms.test', byName: 'Nina CS', byEmail: 'nina.cs@portal.test' })
const sharedSession = await ImpersonationSessionModel.findOne({ targetEmail: 'bea@lms.test' }).lean()
check('a CS with no LMS account: from the shared one — their own address still on the session',
  viaShared.from === 'shared' && idOf(sharedSession?.actorId) === idOf(desk) && sharedSession?.actorEmail === 'nina.cs@portal.test'
    && sharedSession?.userAgent === 'Tetra Commission — Nina CS', JSON.stringify(sharedSession))
check("...in that student's academy, the other one", idOf(sharedSession?.organizationId) === idOf(blr._id))
const sharedAudit = await AuditLogModel.findOne({ 'meta.sessionId': idOf(sharedSession?._id) }).lean() as Record<string, any> | null
check('...audited from the shared account, with their name', idOf(sharedAudit?.actorId) === idOf(desk) && sharedAudit?.actorRole === 'support'
  && sharedAudit?.meta?.byName === 'Nina CS' && sharedAudit?.meta?.from === 'shared')
const nameless = await studentViewForPortal({ email: 'bea@lms.test', byName: '', byEmail: '' })
const namelessSession = await ImpersonationSessionModel.findOne({ targetEmail: 'bea@lms.test' }).sort({ createdAt: -1 }).lean()
check("nobody named: the shared account's own address", nameless.from === 'shared' && namelessSession?.actorEmail === 'desk@lms.test', namelessSession?.actorEmail)

step('C. Only an active student')
const started = async () => [
  await ImpersonationSessionModel.countDocuments({}), await ImpersonationHandoffModel.countDocuments({}),
  await AuditLogModel.countDocuments({ action: 'user.impersonate.client' }),
].join('/')
const before = await started()
const by = { byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }
check('nobody by that address: not found', await refusal(() => studentViewForPortal({ email: 'ghost@lms.test', ...by })) === 'NOT_FOUND 404')
check('a member of staff: not found — only a student can be viewed this way',
  await refusal(() => studentViewForPortal({ email: 'admin.dubai@lms.test', ...by })) === 'NOT_FOUND 404')
check('a disabled account: refused, saying so', await refusal(() => studentViewForPortal({ email: 'dee@lms.test', ...by })) === 'ACCOUNT_DISABLED 400')
check('not one address: refused',
  await refusal(() => studentViewForPortal({ email: 'sam@lms.test, bea@lms.test', ...by })) === 'VALIDATION_ERROR 400'
    && await refusal(() => studentViewForPortal({ email: ['sam@lms.test'], ...by })) === 'VALIDATION_ERROR 400'
    && await refusal(() => studentViewForPortal({ email: { $ne: '' }, ...by })) === 'VALIDATION_ERROR 400')
await UserModel.updateOne({ _id: desk }, { $set: { isActive: false } })
check("neither the CS's own account nor the shared one: a 503 that says so",
  await refusal(() => studentViewForPortal({ email: 'sam@lms.test', byName: 'Nina CS', byEmail: 'nina.cs@portal.test' })) === 'NOT_CONFIGURED 503')
await UserModel.updateOne({ _id: desk }, { $set: { isActive: true } })
check('...and none of these started anything', await started() === before, `${before} → ${await started()}`)

step("D. Over HTTP — the link opens the student's own LMS, read-only")
const app = (await import('@/app.ts')).default
const server = await new Promise<import('node:http').Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i <= 0) continue
    const name = pair!.slice(0, i), value = pair!.slice(i + 1)
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name)
    else jar.set(name, value)
  }
}
async function call(method: string, path: string, opts: { jar?: Jar; secret?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  if (opts.secret) headers['x-portal-secret'] = opts.secret
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  if (opts.jar) absorb(opts.jar, res)
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body }
}

const ask = { email: 'sam@lms.test', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }
check('no secret: refused', (await call('POST', '/service/students/view', { body: ask })).status === 401)
check('the wrong secret: refused', (await call('POST', '/service/students/view', { body: ask, secret: 'not-the-secret' })).status === 401)
const viaHttp = await call('POST', '/service/students/view', { body: ask, secret: CRM_SECRET })
check('the link, by POST', viaHttp.status === 200 && String(viaHttp.body?.data?.url ?? '').startsWith('https://learn.lms.test/imp/enter?code='),
  JSON.stringify(viaHttp.body).slice(0, 200))
const ghost = await call('POST', '/service/students/view', { body: { ...ask, email: 'ghost@lms.test' }, secret: CRM_SECRET })
check('a refusal as its code, not a server fault', ghost.status === 404 && ghost.body?.error?.code === 'NOT_FOUND', JSON.stringify(ghost.body))

const httpCode = codeOf(String(viaHttp.body?.data?.url ?? 'https://x.test/'))
const browser: Jar = new Map()
const redeemed = await call('POST', '/auth/impersonation/redeem', { jar: browser, body: { code: httpCode } })
check('the student app redeems the code, the CS named', redeemed.status === 200 && browser.has('lms_imp_at') && redeemed.body?.data?.actorEmail === 'cara.cs@portal.test',
  `${redeemed.status} ${JSON.stringify(redeemed.body).slice(0, 200)}`)
check('...once', (await call('POST', '/auth/impersonation/redeem', { body: { code: httpCode } })).status === 410)
const me = await call('GET', '/auth/me', { jar: browser })
check("it is the student's own LMS", me.status === 200 && (me.body?.data?.email ?? me.body?.data?.user?.email) === 'sam@lms.test', `${me.status}`)
check('...read-only, with the CS on the banner',
  me.body?.data?.impersonation?.readOnly === true && me.body?.data?.impersonation?.actorEmail === 'cara.cs@portal.test', JSON.stringify(me.body?.data?.impersonation))
const write = await call('PATCH', '/auth/me', { jar: browser, body: { name: 'Renamed From The Portal' } })
check('a change is refused', write.status === 403 && write.body?.error?.code === 'IMPERSONATION_READ_ONLY', `${write.status} ${write.body?.error?.code}`)
const fresh = await UserModel.findById(sam).select('name').lean() as { name?: string } | null
check('...and nothing changed', fresh?.name === 'Sam Student', fresh?.name)

const sessionId = idOf((await ImpersonationHandoffModel.findOne({ codeHash: sha(httpCode) }).lean())?.sessionId)
const admin = async (email: string) => {
  const jar: Jar = new Map()
  const signedIn = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
  if (signedIn.status !== 200) throw new Error(`${email} could not sign in: ${signedIn.status}`)
  return jar
}
const dubaiAdmin = await admin('admin.dubai@lms.test')
const blrAdmin = await admin('admin.blr@lms.test')
const listed = (r: { body?: any }) => (Array.isArray(r.body?.data) ? r.body.data : []).map((s: any) => String(s.id ?? s._id))
const dubaiList = await call('GET', '/admin/impersonation-sessions?active=true', { jar: dubaiAdmin })
check("the student's academy's admins see it on their Impersonation sessions screen, the CS named",
  dubaiList.status === 200 && listed(dubaiList).includes(sessionId)
    && dubaiList.body.data.find((s: any) => String(s.id ?? s._id) === sessionId)?.actorEmail === 'cara.cs@portal.test', `${dubaiList.status}`)
const blrList = await call('GET', '/admin/impersonation-sessions?active=true', { jar: blrAdmin })
check("...the other academy's do not", blrList.status === 200 && !listed(blrList).includes(sessionId) && listed(blrList).includes(idOf(sharedSession?._id)))
const ended = await call('DELETE', `/admin/impersonation-sessions/${sessionId}`, { jar: dubaiAdmin })
check('they can end it', ended.status === 200, `${ended.status}`)
const after = await call('GET', '/auth/me', { jar: browser })
check('...and the view dies at once', after.status === 401 && after.body?.error?.code === 'IMPERSONATION_REVOKED', `${after.status} ${after.body?.error?.code}`)
server.close()

const express = (await import('express')).default
const portalActivityRoutes = (await import('@/routes/portalActivity.routes.ts')).default
const { errorMiddleware } = await import('@/middleware/error.middleware.ts')
const bare = express()
bare.use(express.json())
bare.use('/service', portalActivityRoutes)
bare.use(errorMiddleware)
const unguarded = await new Promise<import('node:http').Server>(resolve => { const s = bare.listen(0, '127.0.0.1', () => resolve(s)) })
const sneaked = await fetch(`http://127.0.0.1:${(unguarded.address() as { port: number }).port}/service/students/view`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-portal-secret': CRM_SECRET }, body: JSON.stringify(ask),
})
check('mounted where the secret check has not run: refused even with the right secret', sneaked.status === 401)
unguarded.close()

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
