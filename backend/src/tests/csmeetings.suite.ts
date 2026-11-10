/* ─────────────────────────────────────────────────────────────
   Meeting requests and Meetings done in the LMS admin (2026-11-10,
   services/csPortalMeetings.service.ts, admin.routes.ts /cs-meetings/:action):
     A  an instructor's call goes to the CS Portal as them — their own address,
        never one the page sends — with this server's secret; admins refused
     B  what the CS Portal says comes back: its data, its refusals with their
        message; not linked, an old CS Portal, a bad secret, unreachable — said so
     C  the Mentor Calendar: a Senior / Junior / Sub-junior Mentor can't book a
        student meeting (they ask), nor turn one into it by an edit; a Chief,
        an admin, a staff meeting book as before; the CS Portal down → booking
        goes on; its answer kept five minutes
   The CS Portal is a stand-in; the app, HTTP and database are real.
   Usage (from backend/): CSMEETINGS_DB_URL=mongodb://127.0.0.1:<port>/lms_csmeetings bun --no-env-file src/tests/csmeetings.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.CSMEETINGS_DB_URL || 'mongodb://localhost:27017/lms_csmeetings'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.JWT_ACCESS_SECRET  = 'csmeetings-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'csmeetings-refresh-secret-0123456789abcdef'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '90000'
process.env.ENABLE_CRON = 'false'; process.env.CLIENT_URL = 'https://lms.test'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const section = (n: string) => console.log(`\n${n}`)
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)

/* ── the stand-in CS Portal ── */
const http = await import('node:http')
const SECRET = 'csmeetings-s2s-secret'
let mode: 'ok' | 'old' | 'down' = 'ok'
const asked: { secret: string; email: string; action: string; body: any }[] = []
const ROLES: Record<string, string> = { 'senior@cm.local': 'senior_mentor', 'chief@cm.local': 'chief_mentor' }
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const send = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
    if (mode === 'down') { res.destroy(); return }
    if (mode === 'old' || req.url !== '/api/v1/integrations/lms/mentor-meetings') return send(404, { error: 'Not found' })
    if (req.headers['x-lms-secret'] !== SECRET) return send(401, { success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
    const b = JSON.parse(raw || '{}')
    asked.push({ secret: String(req.headers['x-lms-secret']), email: b.email, action: b.action, body: b.body })
    const role = ROLES[b.email]
    if (b.action === 'me') return send(200, { success: true, data: role ? { mentor: true, role, asks: role !== 'chief_mentor' } : { mentor: false, message: 'No CS Portal account has your email' } })
    if (b.action === 'createMeetingRequest' && b.body?.studentId === 'dup') return send(409, { success: false, error: { code: 'REFUSED', message: 'You already have a request waiting for this student' } })
    if (b.action === 'getMeetingRequestReview') return send(404, { success: false, error: { code: 'REFUSED', message: 'No such request' } })
    return send(200, { success: true, data: { action: b.action, echo: b.body } })
  })
})
await new Promise<void>(ok => fake.listen(0, '127.0.0.1', () => ok()))
const FAKE_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}/api/v1`
process.env.COMMISSION_API_URL = FAKE_URL
process.env.COMMISSION_S2S_SECRET = SECRET

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { forgetAsks } = await import('@/services/csPortalMeetings.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_csmeetings') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, path: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}

try {
  const PW = 'CorrectHorse1', hash = await hashPassword(PW)
  const dubai = await M.OrganizationModel.create({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' } as any)
  const mkUser = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, isVerified: true, organizationId: dubai._id, ...o } as any)
  await mkUser({ name: 'Senior', email: 'senior@cm.local', role: 'instructor' })
  await mkUser({ name: 'Chief', email: 'chief@cm.local', role: 'instructor' })
  await mkUser({ name: 'Admin', email: 'admin@cm.local', role: 'admin' })
  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map(); const r = await call('POST', '/admin/auth/login', jar, { email: e, password: PW })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const senior = await login('senior@cm.local'), chief = await login('chief@cm.local'), admin = await login('admin@cm.local')
  const last = () => asked[asked.length - 1]

  section('A  as the instructor signed in')
  let r = await call('POST', '/admin/cs-meetings/me', senior, {})
  check('an instructor: the CS Portal answers for them', r.status === 200 && r.body?.data?.mentor === true && r.body.data.role === 'senior_mentor', j(r.body))
  check('…asked with their address and this server\'s secret', last()?.email === 'senior@cm.local' && last()?.secret === SECRET && last()?.action === 'me', j(last()))
  r = await call('POST', '/admin/cs-meetings/listMeetingRequests', senior, { email: 'chief@cm.local', box: 'to_decide' })
  check("an address the page sends is never who it's asked as", last()?.email === 'senior@cm.local' && last()?.action === 'listMeetingRequests' && last()?.body?.box === 'to_decide', j(last()))
  check('…its data back', r.status === 200 && r.body?.data?.action === 'listMeetingRequests', j(r.body))
  r = await call('POST', '/admin/cs-meetings/me', admin, {})
  check('an admin: refused (they use the CS Portal)', r.status === 403 && r.body?.error?.code === 'FOR_MENTORS', j(r.body))
  r = await call('POST', '/admin/cs-meetings/me', undefined, {})
  check('signed out: refused', r.status === 401, j(r.body))
  const before = asked.length
  r = await call('POST', '/admin/cs-meetings/decideMeetingRequest', senior, { id: 'x', action: 'approve' })
  check('deciding (any action not listed): refused here, the CS Portal not asked', r.status === 400 && asked.length === before, j(r.body))

  section('B  what comes back')
  r = await call('POST', '/admin/cs-meetings/createMeetingRequest', senior, { studentId: 'dup' })
  check("the CS Portal's refusal, with its message", r.status === 409 && /already have a request waiting/.test(r.body?.error?.message), j(r.body))
  r = await call('POST', '/admin/cs-meetings/getMeetingRequestReview', senior, { id: 'nope' })
  check('its own "not found" stays one (not "needs the update")', r.status === 404 && /No such request/.test(r.body?.error?.message), j(r.body))
  mode = 'old'
  r = await call('POST', '/admin/cs-meetings/me', senior, {})
  check('a CS Portal without this route: "needs the CS Portal update"', r.status === 503 && /CS Portal update/.test(r.body?.error?.message), j(r.body))
  mode = 'down'
  r = await call('POST', '/admin/cs-meetings/me', senior, {})
  check('unreachable: 502, said so', r.status === 502 && /could not be reached/.test(r.body?.error?.message), j(r.body))
  mode = 'ok'
  process.env.COMMISSION_S2S_SECRET = 'wrong'
  r = await call('POST', '/admin/cs-meetings/me', senior, {})
  check("a secret it doesn't take: this server's problem (502)", r.status === 502 && /COMMISSION_S2S_SECRET/.test(r.body?.error?.message), j(r.body))
  process.env.COMMISSION_S2S_SECRET = ''
  r = await call('POST', '/admin/cs-meetings/me', senior, {})
  check('not linked: 503, said so', r.status === 503 && /not linked/.test(r.body?.error?.message), j(r.body))
  process.env.COMMISSION_S2S_SECRET = SECRET

  section('C  the Mentor Calendar')
  forgetAsks()
  const at = new Date(Date.now() + 3 * 864e5); at.setUTCHours(6, 0, 0, 0)
  const meeting = (who: string, kind: string, plus = 0) => ({ mentorEmail: who, title: `A ${kind} meeting`, kind, scheduledStart: new Date(at.getTime() + plus * 3600e3).toISOString(), durationMins: 30, inPerson: true, location: 'Dubai office', attendees: [{ name: 'Someone', email: 'someone@cm.local' }] })
  const meCalls = () => asked.filter(a => a.action === 'me').length
  let n0 = meCalls()
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting('senior@cm.local', 'student'))
  check('a Senior books a student meeting: refused — ask for it', r.status === 403 && r.body?.error?.code === 'ASK_FOR_STUDENT_MEETINGS', j(r.body))
  check('…nothing booked', (await M.MentorMeetingModel.countDocuments({})) === 0)
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting('senior@cm.local', 'student', 1))
  check('…the CS Portal asked once in five minutes', r.status === 403 && meCalls() === n0 + 1, `${meCalls() - n0} calls`)
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting('senior@cm.local', 'staff', 2))
  const staffId = r.body?.data?.meeting?.id
  check('a Senior books a staff meeting: as before', r.status === 200 && !!staffId, j(r.body))
  r = await call('PATCH', `/admin/mentor-calendar/meetings/${staffId}`, senior, { kind: 'student' })
  check('…and can\'t turn it into a student meeting', r.status === 403 && r.body?.error?.code === 'ASK_FOR_STUDENT_MEETINGS'
    && (await M.MentorMeetingModel.findById(staffId).lean() as any)?.kind === 'staff', j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting('chief@cm.local', 'student', 3))
  check('a Chief books a student meeting: as before', r.status === 200, j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', admin, meeting('senior@cm.local', 'student', 4))
  check("an admin books one with a Senior: as before", r.status === 200, j(r.body))
  forgetAsks(); mode = 'down'
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting('senior@cm.local', 'student', 5))
  check('the CS Portal down: booking goes on', r.status === 200, j(r.body))
  mode = 'ok'; forgetAsks()
  process.env.COMMISSION_API_URL = ''
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting('senior@cm.local', 'student', 6))
  check('not linked: booking goes on', r.status === 200, j(r.body))
  process.env.COMMISSION_API_URL = FAKE_URL
} catch (err) {
  fail++
  console.log('  FAIL  suite threw', err)
} finally {
  server.close(); fake.close()
  await mongoose.connection.db!.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
