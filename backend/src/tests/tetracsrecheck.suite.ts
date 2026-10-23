/* ─────────────────────────────────────────────────────────────
   Recheck the commission portal, and the Students table's phone (the user,
   2026-10-10: "add option here to recheck the commission portal … show the
   phone number … filter non phone numbers").

   Pinned here, against a real database and a stand-in Tetra Commission:

     A. POST /admin/users/:id/recheck-cs asks Tetra Commission now, with this
        LMS's secret, and keeps what it says as tetraCs — found, the open pool,
        not there (left as it was), Tetra Commission down or refusing, not set
        up, not a student, nobody signed in;
     B. a student edited or created here is asked about by itself, after the
        save has answered;
     C. the Students list carries the phone, and ?no_phone=true gives only
        those with none — on the account or the application, blank counted as
        none — with the programme chip and the search still applied.

   Run: bun --no-env-file src/tests/tetracsrecheck.suite.ts
   (TETRACSRECHECK_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
import { createServer } from 'node:http'

process.env.DATABASE_URL = process.env.TETRACSRECHECK_DATABASE_URL ?? 'mongodb://localhost:27017/lms_tetracsrecheck'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.DOTENV_CONFIG_PATH = '/nonexistent/tetracsrecheck-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'tetracsrecheck-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'tetracsrecheck-suite-refresh-secret-0123456789'
const SECRET = 'tetracsrecheck-suite-commission-secret-0123456789'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ── A stand-in Tetra Commission: who looks after whom, by LMS id or email ── */
type Cs = { cs: string; team: string; code: string; open: boolean }
const tetra = new Map<string, Cs>()
const asked: { lmsUserId?: string; email?: string }[] = []
let tetraDown = false
const stand = createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.url !== '/api/v1/integrations/lms/student-cs') return send(404, {})
    if (req.headers['x-lms-secret'] !== SECRET) return send(401, { success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
    if (tetraDown) return send(500, { success: false, error: { code: 'DOWN', message: 'Tetra Commission is down' } })
    const body = JSON.parse(raw || '{}') as { lmsUserId?: string; email?: string }
    asked.push(body)
    const hit = (body.lmsUserId && tetra.get(body.lmsUserId)) || (body.email && tetra.get(body.email))
    return send(200, { success: true, data: hit ? { found: true, ...hit } : { found: false } })
  })
})
await new Promise<void>(r => stand.listen(0, '127.0.0.1', () => r()))
const TETRA_URL = `http://127.0.0.1:${(stand.address() as { port: number }).port}`
process.env.COMMISSION_API_URL = TETRA_URL
process.env.COMMISSION_S2S_SECRET = SECRET

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_tetracsrecheck') {
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
const until = async (fn: () => Promise<boolean>, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50) } return false }

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  await M.UserModel.create({ name: 'Admin', email: 'admin@rc.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: org._id })
  const staff = await M.UserModel.create({ name: 'Sam Staff', email: 'staff@rc.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const student = (name: string, email: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email, passwordHash: hash, role: 'student', isActive: true, organizationId: org._id,
    enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'], ...extra,
  })
  const shanu = await student('Shanu', 'shanu@rc.local', { phone: '+971500000001' })
  const omar  = await student('Omar', 'omar@rc.local', { enrollmentApplication: { phone: '+971500000002' } })
  const nadia = await student('Nadia', 'nadia@rc.local', { tetraCs: { name: 'CS 1- OLD', team: 'Old Team', code: 'STU-1', open: false, at: new Date() } })
  const blank = await student('Blank Phone', 'blank@rc.local', { phone: '   ', enrollmentApplication: { phone: '' } })
  const dm    = await student('Dina DM', 'dina@rc.local', { category: 'digital-marketing', categories: ['digital-marketing'] })
  const get = async (id: unknown) => (await M.UserModel.findById(id).lean() as any)?.tetraCs

  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { email: 'admin@rc.local', password: PW })
  check('(the admin signs in)', login.status === 200, why(login))

  step('A · Recheck the commission portal')
  tetra.set(String(shanu._id), { cs: 'CS 2- AB', team: 'Gladiators', code: 'STU-2876', open: false })
  let r = await call('POST', `/admin/users/${shanu._id}/recheck-cs`, jar)
  check('found: CS, team and student code answered', r.status === 200 && r.body?.data?.found === true && r.body.data.cs === 'CS 2- AB'
    && r.body.data.team === 'Gladiators' && r.body.data.code === 'STU-2876', why(r) + JSON.stringify(r.body?.data))
  const s1 = await get(shanu._id)
  check('…and kept on the student as tetraCs', s1?.name === 'CS 2- AB' && s1?.team === 'Gladiators' && s1?.code === 'STU-2876' && !!s1?.at, JSON.stringify(s1))
  check('asked by LMS id and email, with this LMS\'s secret', asked.at(-1)?.lmsUserId === String(shanu._id) && asked.at(-1)?.email === 'shanu@rc.local')
  tetra.set('omar@rc.local', { cs: '', team: 'Delta Open Students', code: 'STU-3000', open: true })
  r = await call('POST', `/admin/users/${omar._id}/recheck-cs`, jar)
  const o1 = await get(omar._id)
  check('found by email, waiting in the open pool: no CS, its team', r.body?.data?.open === true && o1?.name === '' && o1?.team === 'Delta Open Students' && o1?.open === true, JSON.stringify(o1))
  r = await call('POST', `/admin/users/${nadia._id}/recheck-cs`, jar)
  check('not in Tetra Commission: found false, and what was there stays', r.status === 200 && r.body?.data?.found === false && (await get(nadia._id))?.team === 'Old Team', why(r))
  tetraDown = true
  r = await call('POST', `/admin/users/${shanu._id}/recheck-cs`, jar)
  check('Tetra Commission down: 503 saying why, nothing changed', r.status === 503 && /down/i.test(r.body?.error?.message ?? '') && (await get(shanu._id))?.team === 'Gladiators', why(r))
  tetraDown = false
  process.env.COMMISSION_S2S_SECRET = 'wrong-secret'
  r = await call('POST', `/admin/users/${shanu._id}/recheck-cs`, jar)
  check('a secret Tetra Commission refuses: 503 with its answer', r.status === 503 && /Bad secret/.test(r.body?.error?.message ?? ''), why(r))
  process.env.COMMISSION_S2S_SECRET = ''
  r = await call('POST', `/admin/users/${shanu._id}/recheck-cs`, jar)
  check('not set up: 503 naming the settings', r.status === 503 && /COMMISSION_API_URL/.test(r.body?.error?.message ?? ''), why(r))
  process.env.COMMISSION_S2S_SECRET = SECRET
  r = await call('POST', `/admin/users/${staff._id}/recheck-cs`, jar)
  check('not a student: 400', r.status === 400, why(r))
  r = await call('POST', `/admin/users/${shanu._id}/recheck-cs`)
  check('nobody signed in: 401', r.status === 401, why(r))

  step('B · edited or created here — asked about by itself')
  tetra.set(String(nadia._id), { cs: 'CS 7- NEW', team: 'New Team', code: 'STU-7', open: false })
  r = await call('PATCH', `/admin/users/${nadia._id}`, jar, { name: 'Nadia K' })
  check('an edit saves', r.status === 200, why(r))
  check('…then the commission portal is asked, and its answer kept', await until(async () => (await get(nadia._id))?.team === 'New Team'), JSON.stringify(await get(nadia._id)))
  const before = asked.length
  r = await call('POST', '/admin/users', jar, { name: 'New Student', email: 'new@rc.local', password: 'CorrectHorse1!x', role: 'student', category: '4x-trading' })
  const newId = r.body?.data?._id ?? r.body?.data?.id
  check('a student created here', (r.status === 201 || r.status === 200) && !!newId, why(r) + JSON.stringify(r.body?.data ?? {}).slice(0, 200))
  check('…is asked about too, by their new id', await until(async () => asked.slice(before).some(a => a.lmsUserId === String(newId))), JSON.stringify(asked.slice(before)))

  step('C · the phone, and the No phone filter')
  let list = await call('GET', '/admin/users?role=student&per_page=50', jar)
  const row = (email: string) => list.body?.data?.find((x: any) => x.email === email)
  check('the list carries the phone — on the account or the application', row('shanu@rc.local')?.phone === '+971500000001'
    && row('omar@rc.local')?.enrollmentApplication?.phone === '+971500000002', why(list))
  list = await call('GET', '/admin/users?role=student&per_page=50&no_phone=true', jar)
  const emails = (list.body?.data ?? []).map((x: any) => x.email).sort().join(',')
  check('No phone: only those with none, a blank one counted as none', emails === 'blank@rc.local,dina@rc.local,nadia@rc.local,new@rc.local'
    && list.body?.meta?.total_count === 4, `${emails} ${JSON.stringify(list.body?.meta)}`)
  list = await call('GET', '/admin/users?role=student&per_page=50&no_phone=true&category=4x-trading', jar)
  check('…with the FOREX chip: still only FOREX', !(list.body?.data ?? []).some((x: any) => x.email === 'dina@rc.local') && (list.body?.data ?? []).some((x: any) => x.email === 'nadia@rc.local'),
    (list.body?.data ?? []).map((x: any) => x.email).join(','))
  list = await call('GET', '/admin/users?role=student&per_page=50&no_phone=true&search=dina', jar)
  check('…and the search', (list.body?.data ?? []).map((x: any) => x.email).join(',') === 'dina@rc.local', why(list))
  list = await call('GET', '/admin/users?role=student&per_page=50&no_phone=false', jar)
  check('no_phone=false: everyone', (list.body?.meta?.total_count ?? 0) >= 6, JSON.stringify(list.body?.meta))
  list = await call('GET', '/admin/users?role=student&no_phone=maybe', jar)
  check('no_phone that is not true or false: refused', list.status === 400 || list.status === 422, why(list))
  void blank; void dm
} catch (err) {
  fail++; console.log(`  \x1b[31m✗ suite threw — ${(err as Error).message}\n${(err as Error).stack}\x1b[0m`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close(); stand.close()
}
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
