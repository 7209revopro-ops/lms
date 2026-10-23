/* ─────────────────────────────────────────────────────────────
   Where a student stands in sales, and whether Tetra Commission onboarded
   them (the user, 2026-10-13: "in students request area show … which sales
   crm … if the finance request raised or pending or rejected or approved …
   in the students section the onboarded or not").

   Pinned here, against a real database, a stand-in Root portal and a
   stand-in finance:

     A. Tetra Commission's push and recheck keep onboarded / onboardedAt on
        tetraCs — told, kept when a portal from before says nothing, a change
        of onboarding alone written;
     B. the Students list's ?onboarded=yes|no|none;
     C. POST /admin/enrollment-requests/sales-status — the CRM leads Root finds
        (asked with ROOT_ERP_SECRET, the phone from the application) and the
        enrolments finance has (with FINANCE_S2S_SECRET), each side on its own:
        one down or not set up says so and the other still answers; answers
        kept a minute; only this academy's students; nobody signed in 401;
        bad input refused (422, the validator's answer here);
     D. Enrollment Requests' ?finance=none|pending|returned|approved — cut by
        the newest request, counted, paged; finance down → 503.

   Run: bun --no-env-file src/tests/salesstatus.suite.ts
   (SALESSTATUS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

process.env.DATABASE_URL = process.env.SALESSTATUS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_salesstatus'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.DOTENV_CONFIG_PATH = '/nonexistent/salesstatus-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'salesstatus-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'salesstatus-suite-refresh-secret-0123456789'
const ROOT_SECRET = 'salesstatus-suite-root-secret-0123456789'
const FIN_SECRET  = 'salesstatus-suite-finance-secret-0123456789'
const COM_SECRET  = 'salesstatus-suite-commission-secret-0123456789'
process.env.ROOT_ERP_SECRET = ROOT_SECRET
process.env.FINANCE_S2S_SECRET = FIN_SECRET
process.env.COMMISSION_S2S_SECRET = COM_SECRET

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

/* ── Stand-ins: Root (CRM leads), finance (enrolments), Tetra Commission (recheck) ── */
const leads = new Map<string, unknown[]>()          // by email or last-9 phone digits
const enrolments = new Map<string, unknown[]>()     // by email
const inFinance = new Set<string>()
const seen = { root: [] as any[], finance: [] as any[] }
const down = { root: false, finance: false }
const tetra = new Map<string, Record<string, unknown>>()
function standIn(handle: (req: IncomingMessage, body: any, send: (s: number, b: unknown) => void) => void) {
  const s = createServer((req, res: ServerResponse) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => handle(req, JSON.parse(raw || '{}'), (status, b) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }))
  })
  return new Promise<string>(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as { port: number }).port}`)))
}
const last9 = (v: string) => v.replace(/\D/g, '').slice(-9)
const ROOT_URL = await standIn((req, body, send) => {
  if (req.url !== '/api/v1/service/crm-leads') return send(404, {})
  if (req.headers['x-portal-secret'] !== ROOT_SECRET) return send(401, { success: false })
  if (down.root) return send(500, { success: false })
  seen.root.push(body)
  const results: Record<string, unknown[]> = {}
  for (const p of body.people as { id: string; email?: string; phone?: string }[]) {
    results[p.id] = (p.email && leads.get(p.email)) || (p.phone && leads.get(last9(p.phone))) || []
  }
  send(200, { success: true, data: { results, failures: [] } })
})
const FIN_URL = await standIn((req, body, send) => {
  if (req.url !== '/api/v1/lms/enrolment-status') return send(404, {})
  if (req.headers['x-lms-secret'] !== FIN_SECRET) return send(401, { success: false })
  if (down.finance) return send(500, { success: false })
  seen.finance.push(body)
  const results: Record<string, unknown> = {}
  for (const e of body.emails as string[]) results[e] = { inFinance: inFinance.has(e), requests: enrolments.get(e) ?? [] }
  send(200, { success: true, data: { results } })
})
const TETRA_URL = await standIn((req, body, send) => {
  if (req.url !== '/api/v1/integrations/lms/student-cs') return send(404, {})
  if (req.headers['x-lms-secret'] !== COM_SECRET) return send(401, { success: false })
  const hit = tetra.get(body.lmsUserId) ?? tetra.get(body.email)
  send(200, { success: true, data: hit ? { found: true, ...hit } : { found: false } })
})
process.env.ROOT_ERP_API_URL = ROOT_URL
process.env.FINANCE_API_URL = FIN_URL
process.env.COMMISSION_API_URL = TETRA_URL

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { studentCsFromPortal } = await import('@/services/portalStudentCs.service.ts')
const { forgetSalesStatus } = await import('@/services/salesStatus.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_salesstatus') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const other = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  await M.UserModel.create({ name: 'Admin', email: 'admin@ss.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const student = (name: string, email: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email, passwordHash: hash, role: 'student', isActive: true, organizationId: org._id,
    enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'], ...extra,
  })
  const ana  = await student('Ana', 'ana@ss.local')
  const ben  = await student('Ben', 'ben@ss.local')
  const cara = await student('Cara', 'cara@ss.local')
  const get = async (id: unknown) => (await M.UserModel.findById(id).lean() as any)?.tetraCs

  step('A · Onboarded, from Tetra Commission')
  let told = await studentCsFromPortal({ students: [
    { email: 'ana@ss.local', code: 'STU-1', cs: 'CS 1', team: 'Falcons', open: false, onboarded: true, onboardedAt: '2026-10-12T08:00:00.000Z' },
    { email: 'ben@ss.local', code: 'STU-2', cs: 'CS 1', team: 'Falcons', open: false, onboarded: false, onboardedAt: null },
  ] })
  let a = await get(ana._id), b = await get(ben._id)
  check('the push keeps onboarded and when', told.updated === 2 && a?.onboarded === true && new Date(a.onboardedAt).toISOString() === '2026-10-12T08:00:00.000Z' && a.name === 'CS 1', JSON.stringify(a))
  check('…and not onboarded, with no date', b?.onboarded === false && !b.onboardedAt, JSON.stringify(b))
  told = await studentCsFromPortal({ students: [{ email: 'ana@ss.local', code: 'STU-1', cs: 'CS 1', team: 'Falcons', open: false }] })
  a = await get(ana._id)
  check('a portal from before (no onboarded): what was said stays, nothing written', told.unchanged === 1 && a?.onboarded === true && !!a.onboardedAt, JSON.stringify({ told, a }))
  told = await studentCsFromPortal({ students: [{ email: 'ben@ss.local', code: 'STU-2', cs: 'CS 1', team: 'Falcons', open: false, onboarded: true, onboardedAt: '2026-10-13T09:30:00.000Z' }] })
  b = await get(ben._id)
  check('only onboarding changed: written', told.updated === 1 && b?.onboarded === true && new Date(b.onboardedAt).toISOString() === '2026-10-13T09:30:00.000Z', JSON.stringify({ told, b }))
  told = await studentCsFromPortal({ students: [{ email: 'ben@ss.local', code: 'STU-2', cs: 'CS 1', team: 'Falcons', open: false, onboarded: true, onboardedAt: '2026-10-13T09:30:00.000Z' }] })
  check('told again the same: unchanged', told.unchanged === 1 && told.updated === 0)

  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { email: 'admin@ss.local', password: PW })
  check('(the admin signs in)', login.status === 200, why(login))
  tetra.set(String(cara._id), { cs: 'CS 2', team: 'Hawks', code: 'STU-3', open: false, onboarded: false, onboardedAt: null })
  let r = await call('POST', `/admin/users/${cara._id}/recheck-cs`, jar)
  const c = await get(cara._id)
  check('the recheck keeps onboarded too', r.status === 200 && c?.onboarded === false && c.code === 'STU-3', why(r) + JSON.stringify(c))
  tetra.set(String(cara._id), { cs: 'CS 2', team: 'Hawks', code: 'STU-3', open: false })
  await call('POST', `/admin/users/${cara._id}/recheck-cs`, jar)
  check('…a portal from before answers without it: what was kept stays', (await get(cara._id))?.onboarded === false)

  step('B · The Students list: ?onboarded')
  const dan = await student('Dan', 'dan@ss.local')   // not in Tetra at all
  const names = (x: any) => (x.body?.data ?? []).map((u: any) => u.name).sort().join(',')
  r = await call('GET', '/admin/users?role=student&per_page=50&onboarded=yes', jar)
  check('yes: Ana and Ben', names(r) === 'Ana,Ben', names(r))
  r = await call('GET', '/admin/users?role=student&per_page=50&onboarded=no', jar)
  check('no: in Tetra Commission, not onboarded — Cara', names(r) === 'Cara', names(r))
  r = await call('GET', '/admin/users?role=student&per_page=50&onboarded=none', jar)
  check('none: not in Tetra Commission — Dan', names(r) === 'Dan', names(r))
  check('…the list carries tetraCs.onboarded', (r = await call('GET', '/admin/users?role=student&per_page=50&onboarded=yes', jar)).body?.data?.[0]?.tetraCs?.onboarded === true)
  check('a value it does not know: refused (422, as every validated query here)', (await call('GET', '/admin/users?role=student&onboarded=maybe', jar)).status === 422)

  step('C · Sales status: Root and finance')
  const eva = await student('Eva', 'eva@ss.local', { enrollmentStatus: 'pending', categories: [], enrollmentApplication: { phone: '+971 50 123 4567' } })
  const fay = await student('Fay', 'fay@ss.local', { enrollmentStatus: 'pending', categories: [] })
  const gus = await student('Gus', 'gus@ss.local', { enrollmentStatus: 'pending', categories: [] })
  const far = await M.UserModel.create({ name: 'Far', email: 'far@ss.local', passwordHash: hash, role: 'student', isActive: true, organizationId: other._id, enrollmentStatus: 'pending' })
  const lead = (crm: string, by: 'email' | 'phone') => ({ crm, crmName: crm === 'delta' ? 'Delta' : 'Remote CRM', leadId: 'L1', leadName: 'Lead', status: 'followup', statusLabel: 'Follow-up', assignedTo: 'Ria', matchedBy: by, createdAt: '2026-10-10T08:00:00.000Z' })
  leads.set('eva@ss.local', [lead('delta', 'email')])
  leads.set('501234567', [lead('remote', 'phone')])
  inFinance.add('eva@ss.local')
  enrolments.set('eva@ss.local', [{ invoiceNumber: 'IN-00200', crm: 'delta', closedBy: 'Ria', course: 'DSLP', approval: 'pending', returnedReason: '', at: '2026-10-12T08:00:00.000Z' }])
  enrolments.set('fay@ss.local', [{ invoiceNumber: 'IN-00201', crm: 'remote', closedBy: 'Nusra', course: 'MBT', approval: 'returned', returnedReason: 'Receipt unreadable', at: '2026-10-12T09:00:00.000Z' }])

  r = await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [String(eva._id), String(fay._id), String(gus._id), String(far._id)] })
  const st = r.body?.data ?? {}
  check('answered for this academy\'s students only (not another academy\'s)', r.status === 200 && !!st[String(eva._id)] && !st[String(far._id)], why(r) + Object.keys(st).join(','))
  check('Eva: the Delta lead, by email', st[String(eva._id)]?.crm?.state === 'ok' && st[String(eva._id)].crm.matches[0]?.crmName === 'Delta', JSON.stringify(st[String(eva._id)]?.crm))
  check('…and her enrolment waiting in finance', st[String(eva._id)]?.finance?.state === 'ok' && st[String(eva._id)].finance.inFinance === true
    && st[String(eva._id)].finance.requests[0]?.approval === 'pending' && st[String(eva._id)].finance.requests[0]?.invoiceNumber === 'IN-00200')
  check('Fay: sent back, with the reason; no CRM lead', st[String(fay._id)]?.finance?.requests?.[0]?.approval === 'returned'
    && /unreadable/.test(st[String(fay._id)].finance.requests[0].returnedReason) && st[String(fay._id)].crm.matches.length === 0)
  check('Gus: nothing anywhere', st[String(gus._id)]?.crm?.matches?.length === 0 && st[String(gus._id)].finance.requests.length === 0 && st[String(gus._id)].finance.inFinance === false)
  const asked = seen.root.at(-1)?.people ?? []
  check('Root asked with the application\'s phone, never a URL', asked.some((p: any) => p.id === String(eva._id) && p.phone === '+971 50 123 4567' && p.email === 'eva@ss.local'))
  const rootCalls = seen.root.length, finCalls = seen.finance.length
  await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [String(eva._id), String(fay._id), String(gus._id)] })
  check('asked again within a minute: answered from memory, nobody asked', seen.root.length === rootCalls && seen.finance.length === finCalls, `${seen.root.length}/${seen.finance.length}`)

  forgetSalesStatus()
  down.root = true
  r = await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [String(eva._id)] })
  check('Root down: its side says so, finance still answers', r.status === 200 && r.body?.data?.[String(eva._id)]?.crm?.state === 'unavailable'
    && r.body.data[String(eva._id)].finance.state === 'ok', JSON.stringify(r.body?.data))
  down.root = false
  forgetSalesStatus()
  const keepFin = process.env.FINANCE_API_URL
  process.env.FINANCE_API_URL = ''
  r = await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [String(eva._id)] })
  check('finance not set up: not_configured naming the settings, Root still answers', r.body?.data?.[String(eva._id)]?.finance?.state === 'not_configured'
    && /FINANCE_API_URL/.test(r.body.data[String(eva._id)].finance.message) && r.body.data[String(eva._id)].crm.state === 'ok', JSON.stringify(r.body?.data))
  process.env.FINANCE_API_URL = keepFin
  forgetSalesStatus()
  process.env.ROOT_ERP_API_URL = `${FIN_URL}/nowhere`
  r = await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [String(eva._id)] })
  check('a Root from before (404): says its server needs updating', /previous version/.test(r.body?.data?.[String(eva._id)]?.crm?.message ?? ''), JSON.stringify(r.body?.data))
  process.env.ROOT_ERP_API_URL = ROOT_URL
  check('nobody signed in: 401', (await call('POST', '/admin/enrollment-requests/sales-status', undefined, { ids: [String(eva._id)] })).status === 401)
  check('no ids / more than 100: refused (422)', (await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: [] })).status === 422
    && (await call('POST', '/admin/enrollment-requests/sales-status', jar, { ids: Array.from({ length: 101 }, () => String(eva._id)) })).status === 422)

  step('D · Enrollment Requests: ?finance')
  forgetSalesStatus()
  enrolments.set('gus@ss.local', [
    { invoiceNumber: 'IN-00203', crm: 'delta', closedBy: 'Ria', course: 'MBT', approval: 'approved', returnedReason: '', at: '2026-10-13T08:00:00.000Z' },
    { invoiceNumber: 'IN-00202', crm: 'delta', closedBy: 'Ria', course: 'MBT', approval: 'returned', returnedReason: 'x', at: '2026-10-11T08:00:00.000Z' },
  ])
  const rows = async (f: string) => { const x = await call('GET', `/admin/enrollment-requests?status=pending&finance=${f}`, jar); return { r: x, names: (x.body?.data ?? []).map((u: any) => u.name).join(','), total: x.body?.meta?.total_count } }
  let f = await rows('pending')
  check('pending: Eva', f.r.status === 200 && f.names === 'Eva' && f.total === 1, why(f.r) + f.names)
  f = await rows('returned')
  check('sent back: Fay', f.names === 'Fay' && f.total === 1, f.names)
  f = await rows('approved')
  check('approved: Gus — judged by his newest request, not the older one sent back', f.names === 'Gus', f.names)
  f = await rows('none')
  check('none raised: nobody else pending in this academy', f.names === '' && f.total === 0, f.names)
  const paged = await call('GET', '/admin/enrollment-requests?status=pending&finance=pending&per_page=1&page=2', jar)
  check('paged after the cut: page 2 of one is empty, total still 1', (paged.body?.data ?? []).length === 0 && paged.body?.meta?.total_count === 1, JSON.stringify(paged.body?.meta))
  forgetSalesStatus()
  down.finance = true
  f = await rows('pending')
  check('finance down: 503 saying the filter can\'t be applied', f.r.status === 503 && /Finance could not be asked/.test(f.r.body?.error?.message ?? ''), why(f.r))
  down.finance = false
  check('a value it does not know: refused (422)', (await call('GET', '/admin/enrollment-requests?status=pending&finance=maybe', jar)).status === 422)
  const plain = await call('GET', '/admin/enrollment-requests?status=pending', jar)
  check('no filter: as before, every pending request', (plain.body?.data ?? []).length === 3, String((plain.body?.data ?? []).length))
} finally {
  server.close()
  await mongoose.disconnect()
}
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
