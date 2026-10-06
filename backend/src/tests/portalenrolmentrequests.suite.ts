/* ─────────────────────────────────────────────────────────────
   Enrolment requests, for the commission portal
   (services/portalEnrolmentRequests.service.ts, routes/portalActivity.routes.ts).

   Pinned here, against a real database:

     A. with no addresses, every Forex applicant's request — both academies,
        each named — by status, newest first, a page at a time: never another
        programme's, never an express sign-up's, never a student approved into
        another programme who once ticked Forex;
     B. with addresses (a CS's students), just theirs, whatever they applied to;
        none, none; more than 500 at a time, refused;
     C. one request with the whole application — the ID numbers, never a
        scan's address; only for the address it belongs to;
     D. a scan opened through a link, never handed over raw: a legacy public one
        as it is, a private one only where it can be signed;
     E. approving lets them in on Forex as the admin does — from the CS's own
        LMS account, else the shared one with their name on it; programmes
        merged; a turned-away account made full again; the student told on
        WhatsApp; twice is once; with the finance check on and finance away,
        nobody is let in; with neither account, a 503 that says so;
     F. rejecting only a waiting request, with a reason — the account back to
        express, its courses taken off it and their counts brought down;
     G. over HTTP, only behind the /service secret check.

   Run: bun --no-env-file src/tests/portalenrolmentrequests.suite.ts
   (PORTALENROLMENTREQUESTS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALENROLMENTREQUESTS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalenrolmentrequests'
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
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalenrolmentrequests-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalenrolmentrequests-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalenrolmentrequests-suite-refresh-secret-0123456789'
const CRM_SECRET = 'portalenrolmentrequests-suite-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ''
process.env.PORTAL_SUPPORT_USER_EMAIL = 'desk@lms.test'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { Types } = mongoose
const { UserModel, CourseModel, EnrollmentModel, OrganizationModel, WhatsAppOutboxModel } = await import('@/models/schema.ts')
const {
  enrolmentRequestsForPortal, enrolmentRequestForPortal, requestDocumentForPortal,
  approveEnrolmentForPortal, rejectEnrolmentForPortal,
} = await import('@/services/portalEnrolmentRequests.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')
const { setFinanceCheckEnabled } = await import('@/services/settings.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalenrolmentrequests') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = Date.now()
const HOUR = 3_600_000
const at = (ago: number) => new Date(now - ago)
const idOf = (v: unknown) => String(v)

/** What a call refused with: its code and status, or 'ok'. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return 'ok' } catch (err) {
    return err instanceof PortalError ? `${err.code} ${err.statusCode}` : `threw ${String(err)}`
  }
}

/* ── Two academies, two staff accounts, a course, and every kind of request ── */
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Institutions Dubai', slug: 'dubai', createdAt: at(100 * HOUR), updatedAt: at(100 * HOUR) })).insertedId
const blr = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', slug: 'bangalore', createdAt: at(100 * HOUR), updatedAt: at(100 * HOUR) })).insertedId
const staff = async (email: string, name: string, role: string) =>
  (await UserModel.collection.insertOne({ email, name, role, isActive: true, organizationId: dubai, createdAt: at(90 * HOUR), updatedAt: at(90 * HOUR) })).insertedId
const desk = await staff('desk@lms.test', 'Delta Support', 'support')
const ownCs = await staff('cara.cs@portal.test', 'Cara Own', 'sub_admin')

const course = (await CourseModel.collection.insertOne({ title: 'Delta Wave Theory', slug: 'dwt-er', program: '4x-trading', enrolledCount: 5, createdAt: at(80 * HOUR), updatedAt: at(80 * HOUR) })).insertedId
const course2 = (await CourseModel.collection.insertOne({ title: 'Market Structure', slug: 'ms-er', program: '4x-trading', enrolledCount: 3, createdAt: at(80 * HOUR), updatedAt: at(80 * HOUR) })).insertedId

type Seed = Record<string, unknown> & { email: string; name: string }
const student = async (s: Seed, ago: number) =>
  (await UserModel.collection.insertOne({ role: 'student', isActive: true, organizationId: dubai, signupType: 'full', createdAt: at(ago), updatedAt: at(ago), ...s })).insertedId
const application = (programs: string[], over: Record<string, unknown> = {}) => ({
  enrollmentApplication: { phone: '+971500000001', homeCountry: 'UAE', programs, idType: 'Passport', idNumber: 'P1234567', ...over },
})

const pia = await student({ email: 'pia@lms.test', name: 'Pia Pending', enrollmentStatus: 'pending', fullRegistrationSubmittedAt: at(2 * HOUR),
  ...application(['Forex Trading'], { passportUrl: 'https://cdn.lms.test/documents/pass-pia.png', idDocUrl: 'kyc/1700000000-pia.png' }) }, 3 * HOUR)
const andy = await student({ email: 'andy@lms.test', name: 'Andy Ai', enrollmentStatus: 'pending', ...application(['AI & Data Science']) }, 4 * HOUR)
const bina = await student({ email: 'bina@lms.test', name: 'Bina Bangalore', enrollmentStatus: 'pending', organizationId: blr, ...application(['forex basics']) }, 5 * HOUR)
await student({ email: 'eve@lms.test', name: 'Eve Express', enrollmentStatus: 'pending', signupType: 'express', ...application(['Forex Trading']) }, 6 * HOUR)
const rex = await student({ email: 'rex@lms.test', name: 'Rex Rejected', enrollmentStatus: 'rejected', signupType: 'express', rejectionReason: 'The ID was unreadable',
  rejectedByName: 'Admin A', rejectedAt: at(HOUR), ...application(['Forex Trading']) }, 7 * HOUR)
const ava = await student({ email: 'ava@lms.test', name: 'Ava Approved', enrollmentStatus: 'approved', categories: ['4x-trading'], category: '4x-trading',
  approvedByName: 'Admin A', approvedAt: at(HOUR), ...application(['Forex Trading']) }, 8 * HOUR)
await student({ email: 'dora@lms.test', name: 'Dora DM', enrollmentStatus: 'approved', categories: ['digital-marketing'], category: 'digital-marketing',
  ...application(['Forex Trading', 'Digital Marketing']) }, 9 * HOUR)
const mo = await student({ email: 'mo@lms.test', name: 'Mo Merge', enrollmentStatus: 'pending', categories: ['ai'], category: 'ai', ...application(['Forex Trading']) }, 10 * HOUR)
const rae = await student({ email: 'rae@lms.test', name: 'Rae Reject', enrollmentStatus: 'pending', ...application(['Forex Trading']) }, 11 * HOUR)
await EnrollmentModel.collection.insertMany([
  { userId: rae, courseId: course, createdAt: at(HOUR), updatedAt: at(HOUR) },
  { userId: rae, courseId: course2, createdAt: at(HOUR), updatedAt: at(HOUR) },
  { userId: ava, courseId: course, createdAt: at(HOUR), updatedAt: at(HOUR) },
])

const names = (r: { requests: { name: string }[] }) => r.requests.map(x => x.name).join(', ')

step('A. Every Forex applicant, for a Super Admin')
let r = await enrolmentRequestsForPortal({ status: 'pending' })
check('waiting: the Forex applicants of both academies, newest first — not the AI one, not an express sign-up',
  names(r) === 'Pia Pending, Bina Bangalore, Mo Merge, Rae Reject' && r.total === 4, names(r))
check('each with its academy', r.requests[0]?.academy === 'Delta Institutions Dubai' && r.requests[1]?.academy === 'Delta Bangalore', JSON.stringify(r.requests.map(x => x.academy)))
check('...the programmes applied to, what they gave to be reached by, and when they applied',
  JSON.stringify(r.requests[0]?.programs) === '["Forex Trading"]' && r.requests[0]?.phone === '+971500000001' && r.requests[0]?.country === 'UAE'
    && r.requests[0]?.appliedAt === at(2 * HOUR).toISOString(), JSON.stringify(r.requests[0]))
r = await enrolmentRequestsForPortal({ status: 'approved' })
check('approved: the Forex students — not one approved into another programme who once ticked Forex', names(r) === 'Ava Approved', names(r))
check('...with who approved them, and when', r.requests[0]?.decidedBy === 'Admin A' && r.requests[0]?.decidedAt === at(HOUR).toISOString())
r = await enrolmentRequestsForPortal({ status: 'rejected' })
check('rejected: with the reason', names(r) === 'Rex Rejected' && r.requests[0]?.reason === 'The ID was unreadable' && r.requests[0]?.decidedBy === 'Admin A', JSON.stringify(r.requests[0]))
r = await enrolmentRequestsForPortal({ status: 'all' })
check('all of them', r.total === 6, names(r))
r = await enrolmentRequestsForPortal({ status: 'pending', page: 2, perPage: 2 })
check('a page at a time', names(r) === 'Mo Merge, Rae Reject' && r.total === 4 && r.page === 2 && r.perPage === 2, JSON.stringify({ n: names(r), t: r.total }))
check('a status that does not exist: refused', (await refusal(() => enrolmentRequestsForPortal({ status: 'nonsense' }))) === 'VALIDATION_ERROR 400')

step('B. A CS\'s students, by address')
r = await enrolmentRequestsForPortal({ status: 'pending', emails: ['ANDY@lms.test', 'pia@lms.test', 'nobody@lms.test'] })
check('just theirs, whatever they applied to', names(r) === 'Pia Pending, Andy Ai' && r.total === 2, names(r))
r = await enrolmentRequestsForPortal({ status: 'pending', emails: [] })
check('no students, no requests', r.total === 0 && r.requests.length === 0)
check('more than 500 at a time: refused',
  (await refusal(() => enrolmentRequestsForPortal({ emails: Array.from({ length: 501 }, (_, i) => `s${i}@lms.test`) }))) === 'VALIDATION_ERROR 400')

step('C. One request, with the whole application')
const one = await enrolmentRequestForPortal({ userId: idOf(pia), email: 'pia@lms.test' })
check('the form as they filled it, the ID numbers included', one.request.application?.idType === 'Passport' && one.request.application?.idNumber === 'P1234567'
  && one.request.application?.homeCountry === 'UAE', JSON.stringify(one.request.application))
check('the scans said to be there, never where they are', one.request.documents.passport === true && one.request.documents.idDoc === true
  && !JSON.stringify(one).includes('pass-pia') && !JSON.stringify(one).includes('kyc/'), JSON.stringify(one.request.documents))
check('another address: not found', (await refusal(() => enrolmentRequestForPortal({ userId: idOf(pia), email: 'andy@lms.test' }))) === 'NOT_FOUND 404')
const eve = await UserModel.findOne({ email: 'eve@lms.test' }).select('_id').lean()
check('an express sign-up: not a request', (await refusal(() => enrolmentRequestForPortal({ userId: idOf(eve!._id), email: 'eve@lms.test' }))) === 'NOT_FOUND 404')
check('an id that is not one: not found', (await refusal(() => enrolmentRequestForPortal({ userId: 'nope', email: 'pia@lms.test' }))) === 'NOT_FOUND 404')

step('D. A scan, through a link')
const passport = await requestDocumentForPortal({ userId: idOf(pia), email: 'pia@lms.test', field: 'passport', byName: 'Cara', byEmail: 'cara.cs@portal.test' })
check('a legacy public one: its address', passport.url === 'https://cdn.lms.test/documents/pass-pia.png' && passport.expiresIn === null, JSON.stringify(passport))
check('a private one, with nothing to sign it against: for the LMS admin',
  (await refusal(() => requestDocumentForPortal({ userId: idOf(pia), email: 'pia@lms.test', field: 'idDoc', byName: '', byEmail: '' }))) === 'NOT_AVAILABLE 404')
check('none sent: not found', (await refusal(() => requestDocumentForPortal({ userId: idOf(andy), email: 'andy@lms.test', field: 'passport', byName: '', byEmail: '' }))) === 'NOT_FOUND 404')
check('a field that is not one: refused', (await refusal(() => requestDocumentForPortal({ userId: idOf(pia), email: 'pia@lms.test', field: 'photo', byName: '', byEmail: '' }))) === 'VALIDATION_ERROR 400')
check('another address: not found', (await refusal(() => requestDocumentForPortal({ userId: idOf(pia), email: 'rex@lms.test', field: 'passport', byName: '', byEmail: '' }))) === 'NOT_FOUND 404')

step('E. Approving: in on Forex, as the admin does')
const ok = await approveEnrolmentForPortal({ userId: idOf(pia), email: 'pia@lms.test', byName: 'Cara CS', byEmail: 'Cara.CS@portal.test' })
let row: any = await UserModel.findById(pia).lean()
check('approved into Forex', row.enrollmentStatus === 'approved' && JSON.stringify(row.categories) === '["4x-trading"]' && row.category === '4x-trading', JSON.stringify(row.categories))
check('from the CS\'s own LMS account, as themselves', ok.from === 'own' && idOf(row.approvedBy) === idOf(ownCs) && row.approvedByName === 'Cara Own'
  && row.approvedByEmail === 'cara.cs@portal.test' && row.approvedByRole === 'sub_admin', JSON.stringify({ by: row.approvedBy, n: row.approvedByName, e: row.approvedByEmail }))
check('the request comes back approved', ok.request.status === 'approved' && ok.request.decidedBy === 'Cara Own')
check('the student told on WhatsApp', (await WhatsAppOutboxModel.countDocuments({ templateName: 'enrollment_approved', to: { $regex: '971500000001' } })) >= 1)
const approvedAt = String(row.approvedAt)
const again = await approveEnrolmentForPortal({ userId: idOf(pia), email: 'pia@lms.test', byName: 'Someone', byEmail: 'someone@portal.test' })
row = await UserModel.findById(pia).lean()
check('twice is once: nothing changes', again.already === true && String(row.approvedAt) === approvedAt && row.approvedByName === 'Cara Own')

const shared = await approveEnrolmentForPortal({ userId: idOf(mo), email: 'mo@lms.test', byName: 'Nadia CS', byEmail: 'nadia@portal.test' })
row = await UserModel.findById(mo).lean()
check('a CS with no LMS account: from the shared one, with their name on it', shared.from === 'shared' && idOf(row.approvedBy) === idOf(desk)
  && row.approvedByName === 'Nadia CS (Tetra Commission)' && row.approvedByEmail === 'nadia@portal.test' && row.approvedByRole === 'support',
  JSON.stringify({ n: row.approvedByName, e: row.approvedByEmail, r: row.approvedByRole }))
check('their other programme kept, Forex added', JSON.stringify(row.categories) === '["ai","4x-trading"]', JSON.stringify(row.categories))

await approveEnrolmentForPortal({ userId: idOf(rex), email: 'rex@lms.test', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' })
row = await UserModel.findById(rex).lean()
check('a turned-away account let in again: full once more, the old reason gone', row.enrollmentStatus === 'approved' && row.signupType === 'full'
  && row.rejectionReason === undefined, JSON.stringify({ s: row.enrollmentStatus, t: row.signupType, why: row.rejectionReason }))
check('another address: not found', (await refusal(() => approveEnrolmentForPortal({ userId: idOf(bina), email: 'pia@lms.test', byName: '', byEmail: '' }))) === 'NOT_FOUND 404')

await setFinanceCheckEnabled(true)
const financeAway = await refusal(() => approveEnrolmentForPortal({ userId: idOf(bina), email: 'bina@lms.test', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }))
row = await UserModel.findById(bina).lean()
check('finance check on, finance away: nobody let in', /^(FINANCE_CHECK_FAILED|NOT_IN_FINANCE) (5\d\d|422)$/.test(financeAway) && row.enrollmentStatus === 'pending', financeAway)
await setFinanceCheckEnabled(false)

await UserModel.updateOne({ _id: desk }, { $set: { isActive: false } })
const nobody = await refusal(() => approveEnrolmentForPortal({ userId: idOf(bina), email: 'bina@lms.test', byName: 'Nadia CS', byEmail: 'nadia@portal.test' }))
check('neither their own account nor the shared one: a 503 that says so, nobody let in',
  nobody === 'NOT_CONFIGURED 503' && (await UserModel.findById(bina).lean() as any).enrollmentStatus === 'pending', nobody)
await UserModel.updateOne({ _id: desk }, { $set: { isActive: true } })

step('F. Rejecting: a waiting request, with a reason')
check('a reason too short: refused', (await refusal(() => rejectEnrolmentForPortal({ userId: idOf(rae), email: 'rae@lms.test', reason: 'no', byName: '', byEmail: 'cara.cs@portal.test' }))) === 'VALIDATION_ERROR 400')
const turned = await rejectEnrolmentForPortal({ userId: idOf(rae), email: 'rae@lms.test', reason: 'The documents are unclear — send them again', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' })
row = await UserModel.findById(rae).lean()
check('turned away, with the reason, by the CS', row.enrollmentStatus === 'rejected' && row.signupType === 'express' && JSON.stringify(row.categories) === '[]'
  && row.rejectionReason === 'The documents are unclear — send them again' && row.rejectedByName === 'Cara Own' && turned.from === 'own', JSON.stringify(row))
check('its courses taken off it, and their counts brought down', (await EnrollmentModel.countDocuments({ userId: rae })) === 0
  && (await CourseModel.findById(course).lean() as any).enrolledCount === 4 && (await CourseModel.findById(course2).lean() as any).enrolledCount === 2)
check('nobody else\'s courses touched', (await EnrollmentModel.countDocuments({ userId: ava })) === 1)
check('an approved student: not rejected here', (await refusal(() => rejectEnrolmentForPortal({ userId: idOf(ava), email: 'ava@lms.test', reason: 'Not here, please', byName: '', byEmail: 'cara.cs@portal.test' }))) === 'NOT_PENDING 409')
check('one already rejected: not again', (await refusal(() => rejectEnrolmentForPortal({ userId: idOf(rae), email: 'rae@lms.test', reason: 'Twice over, please', byName: '', byEmail: 'cara.cs@portal.test' }))) === 'NOT_PENDING 409')

step('G. Over HTTP, behind the /service secret')
const express = (await import('express')).default
const portalRoutes = (await import('@/routes/portal.routes.ts')).default
const portalActivityRoutes = (await import('@/routes/portalActivity.routes.ts')).default
const { errorMiddleware } = await import('@/middleware/error.middleware.ts')
const serve = async (mount: (app: ReturnType<typeof express>) => void) => {
  const app = express()
  app.use(express.json())
  mount(app)
  app.use(errorMiddleware)
  const server = await new Promise<import('node:http').Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }
}
// As routes/index.ts mounts them.
const live = await serve(app => { app.use('/service', portalRoutes); app.use('/service', portalActivityRoutes) })
const ask = async (path: string, body: unknown, secret?: string) => {
  const res = await fetch(`${live.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-portal-secret': secret } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } } }
}
check('no secret: refused', (await ask('/service/enrolment-requests', { status: 'pending' })).status === 401)
const list = await ask('/service/enrolment-requests', { status: 'pending' }, CRM_SECRET)
check('the list, by POST', list.status === 200 && list.body.data?.total === 1 && list.body.data?.requests?.[0]?.name === 'Bina Bangalore', JSON.stringify(list.body).slice(0, 200))
const detail = await ask(`/service/enrolment-requests/${idOf(bina)}`, { email: 'bina@lms.test' }, CRM_SECRET)
check('one request', detail.status === 200 && detail.body.data?.request?.application?.idNumber === 'P1234567')
const approved = await ask(`/service/enrolment-requests/${idOf(bina)}/approve`, { email: 'bina@lms.test', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }, CRM_SECRET)
check('approved over HTTP', approved.status === 200 && approved.body.data?.request?.status === 'approved', JSON.stringify(approved.body).slice(0, 200))
const rejected = await ask(`/service/enrolment-requests/${idOf(andy)}/reject`, { email: 'andy@lms.test', reason: 'Not a Forex applicant', byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }, CRM_SECRET)
check('rejected over HTTP', rejected.status === 200 && rejected.body.data?.request?.status === 'rejected', JSON.stringify(rejected.body).slice(0, 200))
const refused = await ask(`/service/enrolment-requests/${idOf(ava)}/reject`, { email: 'ava@lms.test', reason: 'Not here, please' }, CRM_SECRET)
check('a refusal as its code, not a server fault', refused.status === 409 && refused.body.error?.code === 'NOT_PENDING', JSON.stringify(refused.body))
live.close()
const unguarded = await serve(app => { app.use('/service', portalActivityRoutes) })
const sneaked = await fetch(`${unguarded.url}/service/enrolment-requests`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-portal-secret': CRM_SECRET }, body: '{}' })
check('mounted where the secret check has not run: refused even with the right secret', sneaked.status === 401)
unguarded.close()

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
