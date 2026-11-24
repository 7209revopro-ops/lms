/* ─────────────────────────────────────────────────────────────
   A staff meeting from the LMS admin's Mentor Calendar (the user, 2026-11-14: "in the LMS also a separate button"),
   admin.routes.ts /mentor-calendar/staff-meeting and /mentor-calendar/meetings:
     A  who books one: an admin with anyone; an instructor the CS Portal calls a Chief Mentor with their own team;
        nobody else — and said why (not a Chief, the CS Portal down or not updated)
     B  booked: their team's mentors in it; somebody outside the team refused by name; never on a student meeting
     C  changed: nobody added from outside the team; everybody taken off, as anybody may
     D  an admin books one with anyone; a busy mentor is refused in the LMS's words
     E  any other booking as before — a plain staff meeting by a mentor who isn't a Chief
     F  every mentor of both academies (the user, 2026-11-24: "show every mentor including Bangalore and Dubai"): the
        CS Portal now says a Chief may book with anyone (team null); the calendar gives both academies' mentors to
        whoever may book one (?allAcademies=1), this academy's to anybody else; booked across teams and academies;
        at most 60 besides its own
   The CS Portal is a stand-in; the app, HTTP and database are real.
   Usage (from backend/): STAFFADMIN_DB_URL=mongodb://127.0.0.1:<port>/lms_staffmeetingsadmin bun --no-env-file src/tests/staffmeetingsadmin.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.STAFFADMIN_DB_URL || 'mongodb://localhost:27017/lms_staffmeetingsadmin'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.JWT_ACCESS_SECRET  = 'staffadmin-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'staffadmin-refresh-secret-0123456789abcdef'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '90000'
process.env.ENABLE_CRON = 'false'; process.env.CLIENT_URL = 'https://lms.test'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const section = (n: string) => console.log(`\n${n}`)
const j = (v: unknown) => JSON.stringify(v).slice(0, 400)

/* ── the stand-in CS Portal: who is a Chief, and their team ── */
const http = await import('node:http')
const SECRET = 'staffadmin-s2s-secret'
let mode: 'ok' | 'old' | 'down' = 'ok'
const asked: string[] = []
const TEAM = ['chief@sa.local', 'ana@sa.local', 'bo@sa.local']
let chiefTeam: string[] | null = TEAM   // F: null — anyone, as the CS Portal says since 2026-11-24
const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const send = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
    if (mode === 'down') { res.destroy(); return }
    if (req.url !== '/api/v1/integrations/lms/mentor-meetings') return send(404, { error: 'Not found' })
    if (req.headers['x-lms-secret'] !== SECRET) return send(401, { success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
    const b = JSON.parse(raw || '{}')
    asked.push(`${b.email}:${b.action}`)
    if (b.action !== 'me') return send(200, { success: true, data: {} })
    const chief = b.email === 'chief@sa.local', senior = b.email === 'senior@sa.local'
    if (!chief && !senior) return send(200, { success: true, data: { mentor: false } })
    const me: Record<string, unknown> = { mentor: true, role: chief ? 'chief_mentor' : 'senior_mentor', asks: !chief }
    // A CS Portal from before staff meetings says nothing of them.
    if (mode !== 'old') me['staff_meeting'] = chief ? { may: true, team: chiefTeam } : { may: false, team: [] }
    return send(200, { success: true, data: me })
  })
})
await new Promise<void>(ok => fake.listen(0, '127.0.0.1', () => ok()))
process.env.COMMISSION_API_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}/api/v1`
process.env.COMMISSION_S2S_SECRET = SECRET

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { forgetAsks } = await import('@/services/csPortalMeetings.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_staffmeetingsadmin') { console.error('REFUSING TO RUN'); process.exit(1) }
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
const msg = (r: { body: any }) => String(r.body?.error?.message ?? r.body?.message ?? '')

try {
  const PW = 'CorrectHorse1', hash = await hashPassword(PW)
  const dubai = await M.OrganizationModel.create({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' } as any)
  const mkUser = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, isVerified: true, organizationId: dubai._id, ...o } as any)
  await mkUser({ name: 'Chief', email: 'chief@sa.local', role: 'instructor' })
  const ana = await mkUser({ name: 'Ana', email: 'ana@sa.local', role: 'instructor' })
  await mkUser({ name: 'Bo', email: 'bo@sa.local', role: 'instructor' })
  await mkUser({ name: 'Senior', email: 'senior@sa.local', role: 'instructor' })
  await mkUser({ name: 'Zed', email: 'zed@sa.local', role: 'instructor' })
  await mkUser({ name: 'Admin', email: 'admin@sa.local', role: 'admin' })
  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map(); const r = await call('POST', '/admin/auth/login', jar, { email: e, password: PW })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const chief = await login('chief@sa.local'), senior = await login('senior@sa.local'), admin = await login('admin@sa.local')
  const day = new Date(Date.now() + 2 * 864e5); day.setUTCHours(6, 0, 0, 0)
  const iso = (mins: number) => new Date(day.getTime() + mins * 60_000).toISOString()
  const meeting = (o: Record<string, unknown> = {}) => ({ mentorEmail: 'chief@sa.local', title: 'Team meeting', kind: 'staff', scheduledStart: iso(0), durationMins: 30, attendees: [], inPerson: false, ...o })

  section('A. Who books one')
  let r = await call('GET', '/admin/mentor-calendar/staff-meeting', admin)
  check('A. an admin: with anyone, without asking the CS Portal', r.status === 200 && r.body.data.may === true && r.body.data.team === null && asked.length === 0, j(r.body))
  r = await call('GET', '/admin/mentor-calendar/staff-meeting', chief)
  check('A. a Chief (the CS Portal says): with their team', r.body.data.may === true && j(r.body.data.team) === j(TEAM), j(r.body))
  r = await call('GET', '/admin/mentor-calendar/staff-meeting', senior)
  check('A. a Senior: no, and why', r.body.data.may === false && /Only a Chief/.test(r.body.data.reason ?? ''), j(r.body))
  const before = asked.length
  await call('GET', '/admin/mentor-calendar/staff-meeting', chief)
  check('A. the answer kept: the CS Portal not asked again', asked.length === before)
  forgetAsks(); mode = 'old'
  r = await call('GET', '/admin/mentor-calendar/staff-meeting', chief)
  check('A. a CS Portal from before staff meetings: no, it needs updating', r.body.data.may === false && /CS Portal update/.test(r.body.data.reason ?? ''), j(r.body))
  forgetAsks(); mode = 'down'
  r = await call('GET', '/admin/mentor-calendar/staff-meeting', chief)
  check('A. the CS Portal down: no, said so', r.body.data.may === false && /could not be reached/.test(r.body.data.reason ?? ''), j(r.body))
  forgetAsks(); mode = 'ok'

  section('B. A Chief books one')
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ staffEmails: ['ana@sa.local', 'zed@sa.local'] }))
  check('B. with somebody outside the team: refused, naming them', r.status === 403 && /Not in your team: zed@sa\.local/.test(msg(r)) && !/ana@/.test(msg(r)), j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ kind: 'student', staffEmails: ['ana@sa.local'] }))
  check('B. mentors on a student meeting: refused', r.status === 400 && /meeting with staff/.test(msg(r)), j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ mentorEmail: 'zed@sa.local', staffEmails: ['ana@sa.local'] }))
  check('B. in the name of somebody outside the team: refused', r.status === 403 && /zed@sa\.local/.test(msg(r)), j(r.body))
  check('B. …none of it booked', (await M.MentorMeetingModel.countDocuments({})) === 0)
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ staffEmails: ['ANA@sa.local', 'bo@sa.local'] }))
  const id = String(r.body?.data?.meeting?.id ?? '')
  const row = id ? await M.MentorMeetingModel.findById(id).lean() : null
  check('B. with Ana and Bo: booked, both in it and invited, booked from the LMS', r.status === 200 && (row?.staffIds ?? []).length === 2 && (row?.attendees ?? []).length === 2 && row?.bookedVia === 'lms' && row?.bookedByEmail === 'chief@sa.local', j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting({ mentorEmail: 'senior@sa.local', staffEmails: ['ana@sa.local'] }))
  check('B. a Senior naming staff: refused', r.status === 403 && /Only a Chief/.test(msg(r)), j(r.body))

  section('C. Changed')
  r = await call('PATCH', `/admin/mentor-calendar/meetings/${id}`, chief, { staffEmails: ['ana@sa.local', 'zed@sa.local'] })
  check('C. adding somebody outside the team: refused', r.status === 403 && /zed@sa\.local/.test(msg(r)), j(r.body))
  r = await call('PATCH', `/admin/mentor-calendar/meetings/${id}`, chief, { staffEmails: ['ana@sa.local'] })
  check('C. Bo taken off: done', r.status === 200 && (await M.MentorMeetingModel.findById(id).lean())?.staffIds?.length === 1, j(r.body))
  r = await call('PATCH', `/admin/mentor-calendar/meetings/${id}`, chief, { staffEmails: [], attendees: [{ name: 'Somebody' }] })
  check('C. everybody taken off: done, a plain meeting again', r.status === 200 && (await M.MentorMeetingModel.findById(id).lean())?.staffIds?.length === 0, j(r.body))

  section('D. An admin')
  await M.LiveClassModel.collection.insertOne({ title: 'Forex A', instructorId: ana._id, organizationId: dubai._id, scheduledStart: new Date(iso(120)), durationMins: 60, status: 'scheduled', bookedCount: 0, sessionCapacity: 30 } as any)
  r = await call('POST', '/admin/mentor-calendar/meetings', admin, meeting({ title: 'Across teams', scheduledStart: iso(150), mentorEmail: 'zed@sa.local', staffEmails: ['ana@sa.local', 'senior@sa.local'] }))
  check('D. with anyone, over Ana\'s class: refused in the LMS\'s words, naming her', r.status === 409 && /Busy then: Ana \(class: Forex A\)/.test(msg(r)), j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', admin, meeting({ title: 'Across teams', scheduledStart: iso(300), mentorEmail: 'zed@sa.local', staffEmails: ['ana@sa.local', 'senior@sa.local'] }))
  check('D. at a free time: booked with them', r.status === 200 && (r.body.data.meeting.staff ?? []).length === 2, j(r.body))

  section('E. Everything else as before')
  r = await call('POST', '/admin/mentor-calendar/meetings', senior, meeting({ mentorEmail: 'zed@sa.local', title: 'A plain staff chat', scheduledStart: iso(600), attendees: [{ name: 'Somebody' }] }))
  check('E. a Senior books a plain staff meeting with anyone', r.status === 200 && (r.body.data.meeting.staff ?? []).length === 0, j(r.body))

  section('F. Every mentor of both academies')
  const blr = await M.OrganizationModel.create({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' } as any)
  await mkUser({ name: 'Ravi', email: 'ravi@sa.local', role: 'instructor', organizationId: blr._id })
  chiefTeam = null; forgetAsks()
  const week = `from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 7 * 864e5).toISOString())}`
  const names = (r: { body: any }) => (r.body?.data?.mentors ?? []).map((m: any) => m.name)
  r = await call('GET', `/admin/mentor-calendar?${week}`, admin)
  check('F. the calendar as before: this academy\'s mentors only', r.status === 200 && names(r).includes('Ana') && !names(r).includes('Ravi'), j(names(r)))
  r = await call('GET', `/admin/mentor-calendar?${week}&allAcademies=1`, admin)
  const ravi = (r.body?.data?.mentors ?? []).find((m: any) => m.name === 'Ravi')
  check('F. both academies, for an admin: Bangalore\'s mentor too, said to be Bangalore\'s', r.status === 200 && names(r).includes('Ana') && ravi?.academy?.name === 'Delta Bangalore', j(names(r)))
  r = await call('GET', `/admin/mentor-calendar?${week}&allAcademies=1`, senior)
  check('F. …not for a Senior (no staff meetings): this academy\'s only', r.status === 200 && names(r).includes('Ana') && !names(r).includes('Ravi'), j(names(r)))
  r = await call('GET', '/admin/mentor-calendar/staff-meeting', chief)
  check('F. a Chief: with anyone now (team null)', r.body.data.may === true && r.body.data.team === null, j(r.body))
  r = await call('GET', `/admin/mentor-calendar?${week}&allAcademies=1`, chief)
  check('F. …both academies\' mentors for them', r.status === 200 && names(r).includes('Ravi') && names(r).includes('Zed'), j(names(r)))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ title: 'Both academies', scheduledStart: iso(420), mentorEmail: 'zed@sa.local', staffEmails: ['ravi@sa.local'] }))
  check('F. Bangalore\'s mentor without allAcademies: not found here, nothing booked', r.status === 404 && /ravi@sa\.local/.test(msg(r)), j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ title: 'Both academies', scheduledStart: iso(420), mentorEmail: 'zed@sa.local', staffEmails: ['ana@sa.local', 'ravi@sa.local'], allAcademies: true }))
  const across = r.body?.data?.meeting?.id ? await M.MentorMeetingModel.findById(r.body.data.meeting.id).lean() : null
  check('F. the Chief, in another team\'s mentor\'s name, with another team\'s and Bangalore\'s: booked', r.status === 200 && (across?.staffIds ?? []).length === 2, j(r.body))
  r = await call('POST', '/admin/mentor-calendar/meetings', chief, meeting({ title: 'Too many', scheduledStart: iso(480), staffEmails: Array.from({ length: 61 }, (_, i) => `m${i}@sa.local`), allAcademies: true }))
  check('F. 61 besides its own: refused, said so', r.status === 400 && /At most 60 mentors/.test(msg(r)), j(r.body))
} catch (err) {
  fail++; console.log('  FAIL  threw', err)
} finally {
  server.close(); fake.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
