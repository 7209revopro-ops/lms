/* ─────────────────────────────────────────────────────────────
   Nobody is let in by hand unless finance knows them
   (services/financeCustomerCheck.service.ts, the approve controller, the
   create-user route and GET /admin/enrollment-requests/:id/finance-check).

   Over HTTP, against a real database and the real admin routes, with a
   stand-in finance this suite controls:
     0. the check is off by default: approving, adding a programme and
        creating a student never ask finance, and the preview says so;
     S. the switch: any admin reads it, only a super admin flips it, and the
        flip is audited. A–F run with it on:
     A. approving a student finance knows: approved, and finance was asked
        about exactly their email, with the shared secret;
     B. one finance does not know: refused, saying so, and left as they were;
     C. finance failing, unreachable, turning the secret down, or not set up
        on this server: refused every time — never approved by default;
     D. adding a programme to an approved student is the same decision;
     E. a student created already approved under Users: the same rule — and
        an instructor is not asked about;
     F. the Approve dialog's preview: what finance said, a 503 when it could
        not be asked, and nothing at all without an admin session;
     G. turned off again: the student finance turned down is approved, and
        finance is not asked.
   Run: bun --no-env-file src/tests/financecheck.suite.ts
   (FINANCECHECK_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
import nodePathBoot from 'node:path'
import nodeOsBoot from 'node:os'

process.env.DATABASE_URL = process.env.FINANCECHECK_DATABASE_URL ?? 'mongodb://localhost:27017/lms_financecheck_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.EMAIL_LOG_DIR = nodePathBoot.join(nodeOsBoot.tmpdir(), `lms-financecheck-mail-${process.pid}`)
process.env.R2_ACCOUNT_ID    = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_BUCKET_NAME   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/financecheck-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'financecheck-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'financecheck-suite-refresh-secret-0123456789'

const SECRET = 'financecheck-suite-finance-secret-0123456789'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

/* ── A stand-in finance ─────────────────────────────────────── */
const { createServer } = await import('node:http')
const knows: Record<string, string[]> = { 'known@t.local': ['Delta HQ'], 'approved.known@t.local': ['Delta HQ'], 'made.known@t.local': ['Delta Bangalore', 'Delta HQ'] }
let mode: 'ok' | 'error' | 'garbage' = 'ok'
const asked: { email: string; secret: string }[] = []
const finance = createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const secret = String(req.headers['x-lms-secret'] ?? '')
    const email = String((JSON.parse(raw || '{}') as { email?: string }).email ?? '')
    asked.push({ email, secret })
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'POST' || req.url !== '/api/v1/lms/customer-check') { res.statusCode = 404; res.end('{}'); return }
    if (secret !== SECRET) { res.statusCode = 401; res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } })); return }
    if (mode === 'error') { res.statusCode = 500; res.end(JSON.stringify({ error: { code: 'INTERNAL' } })); return }
    if (mode === 'garbage') { res.statusCode = 200; res.end(JSON.stringify({ data: { exists: 'yes' } })); return }
    res.end(JSON.stringify({ data: { exists: email in knows, organizations: knows[email] ?? [] } }))
  })
})
await new Promise<void>(r => finance.listen(0, '127.0.0.1', () => r()))
const FINANCE_URL = `http://127.0.0.1:${(finance.address() as { port: number }).port}/api/v1`
const financeIs = (url: string | undefined, secret: string | undefined = SECRET) => {
  if (url === undefined) delete process.env['FINANCE_API_URL']; else process.env['FINANCE_API_URL'] = url
  if (secret === undefined) delete process.env['FINANCE_S2S_SECRET']; else process.env['FINANCE_S2S_SECRET'] = secret
}
financeIs(FINANCE_URL)

/* ── The LMS ────────────────────────────────────────────────── */
const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, AuditLogModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
const dbName = mongoose.connection.db!.databaseName
if (!/financecheck/.test(dbName)) { console.error(`REFUSING TO RUN — ${dbName} is not the throwaway database`); process.exit(1) }
await mongoose.connection.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 90)}`

const PW = 'CorrectHorse1'
const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const hash = await hashPassword(PW)
const mk = (email: string, role: string, extra: object = {}) =>
  UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, organizationId: dubai._id, ...extra })
await mk('boss@t.local', 'super_admin')
const known     = await mk('known@t.local',     'student', { enrollmentStatus: 'pending', signupType: 'full' })
const unknown   = await mk('unknown@t.local',   'student', { enrollmentStatus: 'pending', signupType: 'full' })
const approved  = await mk('approved.known@t.local', 'student', { enrollmentStatus: 'approved', categories: ['4x-trading'], category: '4x-trading' })
const legacy    = await mk('legacy@t.local',    'student', { enrollmentStatus: 'approved', categories: ['4x-trading'], category: '4x-trading' })
const offUnknown = await mk('off.unknown@t.local', 'student', { enrollmentStatus: 'pending', signupType: 'full' })
const offLegacy  = await mk('off.legacy@t.local',  'student', { enrollmentStatus: 'approved', categories: ['4x-trading'], category: '4x-trading' })
await mk('academy.admin@t.local', 'admin')

const boss: Jar = new Map()
const login = await call('POST', '/admin/auth/login', { jar: boss, body: { email: 'boss@t.local', password: PW } })
if (login.status !== 200) { console.error(`The admin could not sign in: ${why(login)}`); process.exit(1) }
const academyAdmin: Jar = new Map()
const login2 = await call('POST', '/admin/auth/login', { jar: academyAdmin, body: { email: 'academy.admin@t.local', password: PW } })
if (login2.status !== 200) { console.error(`The academy admin could not sign in: ${why(login2)}`); process.exit(1) }
const flipSwitch = (enabled: unknown, jar: Jar = boss) => call('PATCH', '/admin/settings/finance-check', { jar, body: { enabled } })

const approve = (id: unknown, categories: string[]) =>
  call('PATCH', `/admin/enrollment-requests/${String(id)}/approve`, { jar: boss, body: { categories } })
const stateOf = async (id: unknown) => {
  const u = await UserModel.findById(id).select('enrollmentStatus categories').lean() as { enrollmentStatus?: string; categories?: string[] } | null
  return `${u?.enrollmentStatus}:${(u?.categories ?? []).join(',')}`
}

try {
  step('0. Off — the default: approving does not ask finance')
  {
    const s = await call('GET', '/admin/settings/finance-check', { jar: boss })
    check('the switch reads off, changed by nobody', s.status === 200 && s.body?.data?.enabled === false && s.body?.data?.updatedByName === null, why(s) + JSON.stringify(s.body?.data))
    financeIs(undefined)   // not even set up on this server
    asked.length = 0
    const r = await approve(offUnknown._id, ['4x-trading'])
    check('a student finance does not know: approved', r.status === 200 && (await stateOf(offUnknown._id)) === 'approved:4x-trading', `${why(r)} ${await stateOf(offUnknown._id)}`)
    const p = await approve(offLegacy._id, ['ai'])
    check('a programme added to one finance does not know: added', p.status === 200 && (await stateOf(offLegacy._id)) === 'approved:4x-trading,ai', `${why(p)} ${await stateOf(offLegacy._id)}`)
    const made = await call('POST', '/admin/users', { jar: boss, body: { name: 'off made', email: 'off.made@t.local', password: PW, role: 'student', organizationId: String(dubai._id) } })
    check('a student created under Users: created', made.status === 201, why(made))
    const preview = await call('GET', `/admin/enrollment-requests/${String(unknown._id)}/finance-check`, { jar: boss })
    check('the Approve dialog\'s preview: not enforced, and no answer', preview.status === 200 && preview.body?.data?.enforced === false && preview.body?.data?.exists === null, why(preview) + JSON.stringify(preview.body?.data))
    check('...and finance was never asked', asked.length === 0, `asked=${asked.length}`)
    financeIs(FINANCE_URL)
  }

  step('S. The switch')
  {
    const read = await call('GET', '/admin/settings/finance-check', { jar: academyAdmin })
    check('an academy admin can read it', read.status === 200 && read.body?.data?.enabled === false, why(read))
    const denied = await flipSwitch(true, academyAdmin)
    check('...but not flip it', denied.status === 403, why(denied))
    const anon = await call('PATCH', '/admin/settings/finance-check', { body: { enabled: true } })
    check('no admin session: nothing', anon.status === 401, why(anon))
    const bad = await flipSwitch('yes')
    check('not a yes or a no: refused', bad.status === 422 && bad.body?.error?.code === 'VALIDATION_ERROR', why(bad))
    const still = await call('GET', '/admin/settings/finance-check', { jar: boss })
    check('...all of which left it off', still.body?.data?.enabled === false, JSON.stringify(still.body?.data))
    const on = await flipSwitch(true)
    check('a super admin turns it on, and is named as who did', on.status === 200 && on.body?.data?.enabled === true && on.body?.data?.updatedByName === 'boss', why(on) + JSON.stringify(on.body?.data))
    await new Promise(r => setTimeout(r, 400))
    const rows = await AuditLogModel.find({ action: 'settings.finance-check' }).lean() as { meta?: { enabled?: unknown } }[]
    check('...in the audit log', rows.length === 1 && rows[0]!.meta?.enabled === true, JSON.stringify(rows.map(r => r.meta)))
  }

  step('A. A student finance knows')
  {
    asked.length = 0
    const r = await approve(known._id, ['4x-trading'])
    check('approved', r.status === 200 && r.body?.data?.enrollmentStatus === 'approved', why(r))
    check('...and stored so', (await stateOf(known._id)) === 'approved:4x-trading', await stateOf(known._id))
    check('finance was asked about exactly their email, with the shared secret',
      asked.length === 1 && asked[0]!.email === 'known@t.local' && asked[0]!.secret === SECRET, JSON.stringify(asked))
  }

  step('B. A student finance does not know')
  {
    const r = await approve(unknown._id, ['4x-trading'])
    check('refused: not in finance', r.status === 422 && r.body?.error?.code === 'NOT_IN_FINANCE', why(r))
    check('...saying which email, and what to do', /unknown@t\.local/.test(r.body?.error?.message ?? '') && /finance/i.test(r.body?.error?.message ?? ''), r.body?.error?.message)
    check('...and left as they were', (await stateOf(unknown._id)) === 'pending:', await stateOf(unknown._id))
  }

  step('C. When finance cannot say: never approved by default')
  {
    const cases: [string, () => void, RegExp][] = [
      ['finance failing',          () => { mode = 'error' }, /could not be reached/],
      ['an answer that is not one', () => { mode = 'garbage' }, /could not be reached/],
      ['finance unreachable',       () => { mode = 'ok'; financeIs('http://127.0.0.1:9/api/v1') }, /could not be reached/],
      ['the secret turned down',    () => { financeIs(FINANCE_URL, 'the-wrong-secret') }, /could not be reached/],
      ['not set up on this server', () => { financeIs(undefined) }, /not set/],
    ]
    for (const [label, arrange, message] of cases) {
      arrange()
      const r = await approve(unknown._id, ['4x-trading'])
      check(`${label}: refused (503), saying why`, r.status === 503 && r.body?.error?.code === 'FINANCE_CHECK_FAILED' && message.test(r.body?.error?.message ?? ''), why(r))
    }
    // Even a student finance does know is not approved while it cannot be asked.
    const r = await approve(approved._id, ['digital-marketing'])
    check('...whoever the student is', r.status === 503, why(r))
    check('...and nobody changed', (await stateOf(unknown._id)) === 'pending:' && (await stateOf(approved._id)) === 'approved:4x-trading',
      `${await stateOf(unknown._id)} ${await stateOf(approved._id)}`)
    mode = 'ok'; financeIs(FINANCE_URL)
  }

  step('D. Adding a programme to an approved student')
  {
    const r = await approve(approved._id, ['digital-marketing'])
    check('finance knows them: added', r.status === 200 && (await stateOf(approved._id)) === 'approved:4x-trading,digital-marketing', `${why(r)} ${await stateOf(approved._id)}`)
    const l = await approve(legacy._id, ['ai'])
    check('approved before this rule, unknown to finance: refused', l.status === 422 && l.body?.error?.code === 'NOT_IN_FINANCE', why(l))
    check('...keeping what they had', (await stateOf(legacy._id)) === 'approved:4x-trading', await stateOf(legacy._id))
  }

  step('E. Creating a student, already approved, under Users')
  {
    const make = (email: string, role: string) =>
      call('POST', '/admin/users', { jar: boss, body: { name: email.split('@')[0], email, password: PW, role, organizationId: String(dubai._id) } })
    const ok = await make('made.known@t.local', 'student')
    const made = await UserModel.findOne({ email: 'made.known@t.local' }).select('enrollmentStatus').lean() as { enrollmentStatus?: string } | null
    check('finance knows them: created, approved', ok.status === 201 && made?.enrollmentStatus === 'approved', `${why(ok)} ${made?.enrollmentStatus}`)
    const no = await make('made.unknown@t.local', 'student')
    check('finance does not: refused, and no account made', no.status === 422 && no.body?.error?.code === 'NOT_IN_FINANCE' && !(await UserModel.exists({ email: 'made.unknown@t.local' })), why(no))
    asked.length = 0
    const teacher = await make('new.teacher@t.local', 'instructor')
    check('an instructor: made, and finance not asked', teacher.status === 201 && asked.length === 0, `${why(teacher)} asked=${asked.length}`)
  }

  step('F. The Approve dialog\'s preview')
  {
    const yes = await call('GET', `/admin/enrollment-requests/${String(known._id)}/finance-check`, { jar: boss })
    check('in finance, and where', yes.status === 200 && yes.body?.data?.enforced === true && yes.body?.data?.exists === true && JSON.stringify(yes.body?.data?.organizations) === JSON.stringify(['Delta HQ']), why(yes) + JSON.stringify(yes.body?.data))
    const no = await call('GET', `/admin/enrollment-requests/${String(unknown._id)}/finance-check`, { jar: boss })
    check('not in finance', no.status === 200 && no.body?.data?.exists === false, why(no))
    financeIs(FINANCE_URL, 'the-wrong-secret')
    const down = await call('GET', `/admin/enrollment-requests/${String(known._id)}/finance-check`, { jar: boss })
    check('finance could not be asked: a 503, not a guess', down.status === 503 && down.body?.error?.code === 'FINANCE_CHECK_FAILED', why(down))
    financeIs(FINANCE_URL)
    const anon = await call('GET', `/admin/enrollment-requests/${String(known._id)}/finance-check`)
    check('no admin session: nothing', anon.status === 401, why(anon))
    const nobody = await call('GET', `/admin/enrollment-requests/${String(new mongoose.Types.ObjectId())}/finance-check`, { jar: boss })
    check('nobody with that id: 404', nobody.status === 404, why(nobody))
  }

  step('G. Turned off again')
  {
    const off = await flipSwitch(false)
    check('a super admin turns it off', off.status === 200 && off.body?.data?.enabled === false, why(off))
    asked.length = 0
    const r = await approve(unknown._id, ['4x-trading'])
    check('the student finance turned down in B: approved now', r.status === 200 && (await stateOf(unknown._id)) === 'approved:4x-trading', `${why(r)} ${await stateOf(unknown._id)}`)
    check('...without asking finance', asked.length === 0, `asked=${asked.length}`)
  }
} finally {
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  server.close()
  finance.close()
  ;(await import('node:fs')).rmSync(process.env.EMAIL_LOG_DIR!, { recursive: true, force: true })
}

console.log('')
if (fail) { console.log(`\x1b[31m${fail} of ${pass + fail} checks failed\x1b[0m`); process.exit(1) }
console.log(`\x1b[32m${pass}/${pass} checks passed\x1b[0m`)
process.exit(0)
