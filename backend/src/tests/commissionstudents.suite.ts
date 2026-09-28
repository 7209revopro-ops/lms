/* ─────────────────────────────────────────────────────────────
   New students → Tetra Commission: who is sent, when, and what is kept.

   Pinned here, against a real database and a stand-in Tetra Commission:

     A. switched off, nothing happens — not even the go-live mark;
     B. only real students (approved, or given a course) created since it was
        switched on; never blocked accounts, other roles, or anybody older;
     C. students finance enrolled are left to finance;
     D. a student made a moment ago waits a few seconds (their request may
        still be running);
     E. what is sent: name, phone, country, academy, the first course;
     F. what comes back is kept, and a sent student is never sent again;
     G. not deployed, not configured there, or down: waited out, never given
        up; a bad secret: stopped.

   The Tetra Commission half is proven on its side
   (tetracapitals backend/test-lms-students.sh).

   Run: bun --no-env-file src/tests/commissionstudents.suite.ts
   (COMMISSIONSTUDENTS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.COMMISSIONSTUDENTS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_commissionstudents'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/commissionstudents-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'commissionstudents-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'commissionstudents-suite-refresh-secret-0123456789'
delete process.env.COMMISSION_API_URL
delete process.env.COMMISSION_S2S_SECRET

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

/* ── A stand-in Tetra Commission ── */
const SECRET = 'commissionstudents-suite-shared-secret'
let mode: 'ok' | 'notDeployed' | 'notConfigured' = 'ok'
const received: Record<string, unknown>[] = []
const known = new Map<string, string>()          // lmsUserId → STU code
const alreadyThere = new Set(['hand.added@commission.test'])
const teams = ['Falcons', 'Eagles', 'Hawks']
let turn = 0, code = 100
const { createServer } = await import('node:http')
const tc = createServer(async (req, res) => {
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (mode === 'notDeployed') return send(404, { error: 'Not found' })
  if (mode === 'notConfigured') return send(503, { success: false, error: { code: 'INTEGRATION_DISABLED', message: 'The Delta LMS link is not configured on this server' } })
  if (req.url !== '/api/v1/integrations/lms/students') return send(404, { error: 'Not found' })
  if (req.headers['x-lms-secret'] !== SECRET) return send(401, { success: false, error: { code: 'UNAUTHORISED', message: 'Bad secret' } })
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { lmsUserId: string; email: string }
  received.push(body)
  const answer = (created: boolean, existing: string | null, studentCode: string, mentorName: string, teamName: string) =>
    send(200, { success: true, data: { created, existing, studentId: 'x', studentCode, assignment: 'assigned', mentorName, teamName, detail: '' } })
  if (alreadyThere.has(body.email)) return answer(false, 'email', 'STU-0042', 'Hand Added', '')
  const seen = known.get(body.lmsUserId)
  if (seen) return answer(false, 'lms', seen, 'someone', '')
  const studentCode = `STU-0${++code}`
  known.set(body.lmsUserId, studentCode)
  const team = teams[turn++ % teams.length]!
  return answer(true, null, studentCode, `${team} Lead`, team)
})
await new Promise<void>(resolve => tc.listen(0, '127.0.0.1', resolve))
const TC_URL = `http://127.0.0.1:${(tc.address() as { port: number }).port}`

const mongoose = (await import('mongoose')).default
const { UserModel, EnrollmentModel, CourseModel, OrganizationModel, SystemSettingModel } = await import('@/models/schema.ts')
const { drainCommissionStudentsOnce, SINCE_KEY } = await import('@/services/commissionStudents.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_commissionstudents') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = Date.now()
const at = (msAgo: number) => new Date(now - msAgo)
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

// Raw rows: this is about who is sent, not about what makes a valid course or student.
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', countryFilter: null, createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const bangalore = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', countryFilter: 'India', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const dwt = (await CourseModel.collection.insertOne({ title: 'Delta Wave Theory Trading Programme', slug: 'dwt-cs', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const mbt = (await CourseModel.collection.insertOne({ title: 'Market Break-Out Trading', slug: 'mbt-cs', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId

type Opts = { createdAgo: number; status?: string; role?: string; isActive?: boolean; org?: unknown; app?: Record<string, string> }
const person = async (email: string, o: Opts) => (await UserModel.collection.insertOne({
  name: email.split('@')[0], email, role: o.role ?? 'student', enrollmentStatus: o.status ?? 'pending',
  isActive: o.isActive ?? true, ...(o.org ? { organizationId: o.org } : {}),
  ...(o.app ? { enrollmentApplication: o.app } : {}), createdAt: at(o.createdAgo), updatedAt: at(o.createdAgo),
})).insertedId
const enrol = async (userId: unknown, courseId: unknown, createdAgo: number, extra: Record<string, unknown> = {}) =>
  EnrollmentModel.collection.insertOne({ userId, courseId, status: 'active', source: 'purchase', createdAt: at(createdAgo), updatedAt: at(createdAgo), ...extra })
const sync = async (id: unknown) => ((await UserModel.findById(id).lean()) as { commissionSync?: Record<string, unknown> } | null)?.commissionSync
const sentEmails = () => received.map(r => String(r.email)).sort().join(',')

step('A. Switched off')
let t = await drainCommissionStudentsOnce()
check('nothing is sent, nothing is marked', t.sent + t.skipped + t.retry + t.failed === 0 && !(await SystemSettingModel.exists({ key: SINCE_KEY })))

process.env.COMMISSION_API_URL = TC_URL
process.env.COMMISSION_S2S_SECRET = SECRET
// Switched on an hour ago.
await SystemSettingModel.collection.insertOne({ key: SINCE_KEY, value: at(HOUR).toISOString(), createdAt: at(HOUR), updatedAt: at(HOUR) })

step('B. Who counts')
const older     = await person('older@lms.test', { createdAgo: 2 * DAY, status: 'approved' })
await enrol(older, dwt, 2 * DAY)
const waiting   = await person('waiting@lms.test', { createdAgo: 50 * MIN })
const approved  = await person('approved@lms.test', { createdAgo: 50 * MIN, status: 'approved', org: bangalore, app: { phone: '+91 90000 00001', nationality: 'Indian' } })
const buyer     = await person('buyer@lms.test', { createdAgo: 40 * MIN, org: dubai, app: { phone: '+971 50 000 0002', homeCountry: 'United Arab Emirates', nationality: 'Indian' } })
await enrol(buyer, mbt, 30 * MIN)
await enrol(buyer, dwt, 35 * MIN)                        // the first course is the earliest
const finance   = await person('finance@lms.test', { createdAgo: 45 * MIN, org: dubai })
await enrol(finance, dwt, 45 * MIN, { paymentAccess: { status: 'partial', invoiceId: 'inv-123' } })
const blocked   = await person('blocked@lms.test', { createdAgo: 40 * MIN, status: 'approved', isActive: false })
const teacher   = await person('teacher@lms.test', { createdAgo: 40 * MIN, status: 'approved', role: 'instructor' })
const fresh     = await person('fresh@lms.test', { createdAgo: 10_000, status: 'approved' })
const handAdded = await person('hand.added@commission.test', { createdAgo: 30 * MIN, status: 'approved' })

t = await drainCommissionStudentsOnce()
check('sent: the approved student, the one given a course, and one Tetra Commission already has',
  sentEmails() === 'approved@lms.test,buyer@lms.test,hand.added@commission.test', sentEmails())
check('not sent: somebody signed up but not yet a student', !received.some(r => r.email === 'waiting@lms.test') && !(await sync(waiting)))
check('not sent: an account from before it was switched on', !(await sync(older)))
check('not sent: a blocked account, or an instructor', !(await sync(blocked)) && !(await sync(teacher)))

step('C. Finance enrolled them')
const f = await sync(finance)
check('left to finance, and marked so it is not looked at again', f?.state === 'skipped' && !received.some(r => r.email === 'finance@lms.test') && t.skipped === 1, JSON.stringify(f))

step('D. Made a moment ago')
check('waits a few seconds', !(await sync(fresh)))
await UserModel.collection.updateOne({ _id: fresh }, { $set: { createdAt: at(2 * MIN) } })
await UserModel.collection.updateOne({ _id: waiting }, { $set: { enrollmentStatus: 'approved' } })
await drainCommissionStudentsOnce()
check('...then goes', (await sync(fresh))?.state === 'sent')
check('and the sign-up goes once an admin approves them', (await sync(waiting))?.state === 'sent')

step('E. What is sent')
const b = received.find(r => r.email === 'buyer@lms.test')!
check('who they are, and where', b.lmsUserId === String(buyer) && b.name === 'buyer' && b.phone === '+971 50 000 0002' && b.academy === 'Delta Dubai', JSON.stringify(b))
check('their country: home country first', b.country === 'United Arab Emirates', String(b.country))
check('their first course', b.course === 'Delta Wave Theory Trading Programme', String(b.course))
const a = received.find(r => r.email === 'approved@lms.test')!
check('approved with no course yet: sent without one, nationality standing in for country', a.course === '' && a.country === 'Indian' && a.academy === 'Delta Bangalore', JSON.stringify(a))

step('F. What is kept')
const bs = await sync(buyer)
check('the student code, team and mentor', bs?.state === 'sent' && /^STU-0\d+$/.test(String(bs?.studentCode)) && !!bs?.team && bs?.mentorName === `${bs?.team} Lead` && bs?.alreadyThere === false, JSON.stringify(bs))
const hs = await sync(handAdded)
check('somebody Tetra Commission already had: recorded as such', hs?.state === 'sent' && hs?.alreadyThere === true && hs?.studentCode === 'STU-0042', JSON.stringify(hs))
const before = received.length
await drainCommissionStudentsOnce()
check('a sent student is never sent again', received.length === before)
await UserModel.collection.updateOne({ _id: buyer }, { $set: { 'commissionSync.state': 'pending', 'commissionSync.nextAttemptAt': at(MIN) } })
await drainCommissionStudentsOnce()
const again = await sync(buyer)
check('sent again by hand: the same student, and the team it was given is kept', again?.studentCode === bs?.studentCode && again?.team === bs?.team, JSON.stringify(again))

step('G. Tetra Commission not ready, refusing, or down')
const late = await person('late@lms.test', { createdAgo: 20 * MIN, status: 'approved' })
mode = 'notDeployed'
await drainCommissionStudentsOnce()
let l = await sync(late)
check('not deployed yet: waits, with the reason', l?.state === 'pending' && l?.attempts === 1 && /Not found/.test(String(l?.lastError)), JSON.stringify(l))
await UserModel.collection.updateOne({ _id: late }, { $set: { 'commissionSync.attempts': 20, 'commissionSync.nextAttemptAt': at(MIN) } })
mode = 'notConfigured'
await drainCommissionStudentsOnce()
l = await sync(late)
check('not configured there: still waiting, however many tries', l?.state === 'pending' && l?.attempts === 21, JSON.stringify(l))
mode = 'ok'
await UserModel.collection.updateOne({ _id: late }, { $set: { 'commissionSync.nextAttemptAt': at(MIN) } })
await drainCommissionStudentsOnce()
check('...and sent once it is', (await sync(late))?.state === 'sent')

const refused = await person('refused@lms.test', { createdAgo: 20 * MIN, status: 'approved' })
process.env.COMMISSION_S2S_SECRET = 'not-the-secret'
await drainCommissionStudentsOnce()
const r = await sync(refused)
check('a wrong secret: stopped, with the reason', r?.state === 'failed' && /Bad secret/.test(String(r?.lastError)), JSON.stringify(r))
process.env.COMMISSION_S2S_SECRET = SECRET

const outage = await person('outage@lms.test', { createdAgo: 20 * MIN, status: 'approved' })
process.env.COMMISSION_API_URL = 'http://127.0.0.1:1'
await drainCommissionStudentsOnce()
let o = await sync(outage)
check('down: retried later', o?.state === 'pending' && o?.attempts === 1 && new Date(String(o?.nextAttemptAt)) > new Date(), JSON.stringify(o))
await UserModel.collection.updateOne({ _id: outage }, { $set: { 'commissionSync.attempts': 7, 'commissionSync.nextAttemptAt': at(MIN) } })
await drainCommissionStudentsOnce()
o = await sync(outage)
check('...and still waiting after eight tries, never given up', o?.state === 'pending' && o?.attempts === 8 &&
  new Date(String(o?.nextAttemptAt)).getTime() - Date.now() <= 15 * MIN, JSON.stringify(o))
process.env.COMMISSION_API_URL = TC_URL

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
tc.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
