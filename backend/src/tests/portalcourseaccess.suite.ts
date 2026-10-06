/* ─────────────────────────────────────────────────────────────
   Course access, for the commission portal
   (services/portalCourseAccess.service.ts, the approve in
   services/portalEnrolmentRequests.service.ts, routes/portalActivity.routes.ts).

   Pinned here, against a real database:

     A. a student's Forex courses — never another programme's — each module
        open or locked in the order they see them, what the fee opened; and
        the Forex courses of their academy they could be put on — never a
        draft, another programme's or another academy's;
     B. giving courses, as the admin's Add course does: the modules picked
        locked, the rest open, the course's count kept in step, audited with
        who did it; one they are on already left as it is; a course that
        cannot be given gives nothing at all; with neither account, a 503;
     C. opening and locking modules one by one — a module the fee locked
        included — anything else in the list kept; nothing to change,
        nothing done; only their own Forex courses;
     D. approving with courses: let in and put on them at once; a course that
        cannot be given approves nobody; already in, the courses still given;
        finance refusing, nothing at all;
     E. over HTTP, only behind the /service secret check.

   Run: bun --no-env-file src/tests/portalcourseaccess.suite.ts
   (PORTALCOURSEACCESS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALCOURSEACCESS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalcourseaccess'
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
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalcourseaccess-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalcourseaccess-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalcourseaccess-suite-refresh-secret-0123456789'
const CRM_SECRET = 'portalcourseaccess-suite-crm-secret-0123456789'
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
const { UserModel, CourseModel, SectionModel, EnrollmentModel, OrganizationModel, AuditLogModel } = await import('@/models/schema.ts')
const { courseAccessForPortal, giveCoursesForPortal, setModuleAccessForPortal } = await import('@/services/portalCourseAccess.service.ts')
const { approveEnrolmentForPortal } = await import('@/services/portalEnrolmentRequests.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')
const { setFinanceCheckEnabled } = await import('@/services/settings.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalcourseaccess') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()
await EnrollmentModel.createIndexes()

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

/* ── Two academies; the shared desk account and a CS with an LMS account of their own ── */
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Institutions Dubai', slug: 'dubai', createdAt: at(100 * HOUR), updatedAt: at(100 * HOUR) })).insertedId
const blr = (await OrganizationModel.collection.insertOne({ name: 'Delta Bangalore', slug: 'bangalore', createdAt: at(100 * HOUR), updatedAt: at(100 * HOUR) })).insertedId
const person = async (doc: Record<string, unknown>) =>
  (await UserModel.collection.insertOne({ isActive: true, organizationId: dubai, createdAt: at(90 * HOUR), updatedAt: at(90 * HOUR), ...doc })).insertedId
const desk = await person({ email: 'desk@lms.test', name: 'Delta Support', role: 'support' })
const cara = await person({ email: 'cara.cs@portal.test', name: 'Cara Own', role: 'sub_admin' })

/* ── Courses: two Forex ones in Dubai, and the three that are never offered ── */
const course = async (title: string, program: string, org: unknown, status = 'published', enrolledCount = 0) =>
  (await CourseModel.collection.insertOne({ title, slug: title.toLowerCase().replace(/\W+/g, '-'), program, organizationId: org, status, enrolledCount, createdAt: at(80 * HOUR), updatedAt: at(80 * HOUR) })).insertedId
const dwt = await course('Delta Wave Theory', '4x-trading', dubai, 'published', 5)
const msnr = await course('Market Structure', '4x-trading', dubai, 'published', 2)
const draftFx = await course('Forex Draft', '4x-trading', dubai, 'draft')
const dm = await course('Digital Marketing 101', 'digital-marketing', dubai)
const blrFx = await course('Bangalore Forex', '4x-trading', blr)
/** Modules, given out of order on purpose: the student sees them by `order`. */
const modules = async (courseId: unknown, titles: string[]) => {
  const ids: Record<string, string> = {}
  for (const [i, title] of [...titles.entries()].reverse()) {
    ids[title] = idOf((await SectionModel.collection.insertOne({ courseId, title, order: i + 1, createdAt: at(70 * HOUR), updatedAt: at(70 * HOUR) })).insertedId)
  }
  return ids
}
const W = await modules(dwt, ['W1 Basics', 'W2 Waves', 'W3 Fibonacci', 'W4 Live'])
const M = await modules(msnr, ['M1 Structure', 'M2 Liquidity', 'M3 Entries'])
const D = await modules(dm, ['D1 Ads'])
await modules(blrFx, ['B1'])

/* ── Students ── */
const student = (email: string, name: string, more: Record<string, unknown> = {}) =>
  person({ email, name, role: 'student', signupType: 'full', enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'], ...more })
const pending = { enrollmentStatus: 'pending', category: undefined, categories: [], enrollmentApplication: { programs: ['Forex Trading'], phone: '+971500000009' } }
const sam = await student('sam@lms.test', 'Sam Student')
const pia = await student('pia@lms.test', 'Pia Pending', pending)
const rae = await student('rae@lms.test', 'Rae Wrong', pending)
const fay = await student('fay@lms.test', 'Fay Finance', pending)
const ava = await student('ava@lms.test', 'Ava Approved')
const stale = new Types.ObjectId()
const samDwt = (await EnrollmentModel.collection.insertOne({
  userId: sam, courseId: dwt, status: 'active', source: 'purchase', progressPercent: 40, enrolledAt: at(20 * HOUR),
  paymentAccess: { status: 'partial', invoiceId: 'inv-1', updatedAt: at(20 * HOUR) },
  blockedLessons: [new Types.ObjectId(W['W3 Fibonacci']), new Types.ObjectId(W['W4 Live']), stale],
  createdAt: at(20 * HOUR), updatedAt: at(20 * HOUR),
})).insertedId
const samDm = (await EnrollmentModel.collection.insertOne({ userId: sam, courseId: dm, status: 'active', source: 'admin', blockedLessons: [], createdAt: at(10 * HOUR), updatedAt: at(10 * HOUR) })).insertedId
const avaDwt = (await EnrollmentModel.collection.insertOne({ userId: ava, courseId: dwt, status: 'active', source: 'admin', blockedLessons: [], createdAt: at(10 * HOUR), updatedAt: at(10 * HOUR) })).insertedId

const by = { byName: 'Cara CS', byEmail: 'cara.cs@portal.test' }
const titles = (list: { title: string }[]) => list.map(x => x.title).join(', ')
const lockedOf = (c: { modules: { title: string; locked: boolean }[] } | undefined) => (c?.modules ?? []).filter(m => m.locked).map(m => m.title).join(', ')
const blockedNow = async (enrolmentId: unknown) =>
  ((await EnrollmentModel.findById(enrolmentId).select('blockedLessons').lean() as { blockedLessons?: unknown[] } | null)?.blockedLessons ?? []).map(idOf)
const countOf = async (courseId: unknown) => ((await CourseModel.findById(courseId).select('enrolledCount').lean()) as { enrolledCount?: number } | null)?.enrolledCount
const audits = (action: string, studentId: unknown) => AuditLogModel.find({ action, 'meta.studentId': idOf(studentId) }).sort({ createdAt: 1 }).lean() as unknown as Promise<Record<string, any>[]>

step('A. A student\'s Forex courses, and the ones they could be put on')
let view = await courseAccessForPortal({ email: ' SAM@lms.test ' })
check('their Forex courses only — not the Digital Marketing one', titles(view.courses) === 'Delta Wave Theory', titles(view.courses))
const dwtView = view.courses[0]
check('...each module in the order they see it, open or locked',
  titles(dwtView?.modules ?? []) === 'W1 Basics, W2 Waves, W3 Fibonacci, W4 Live' && lockedOf(dwtView) === 'W3 Fibonacci, W4 Live', JSON.stringify(dwtView?.modules))
check('...how they were put on it, what the fee opened, their progress',
  dwtView?.how === 'finance' && dwtView?.access === 'partial' && dwtView?.progress === 40 && dwtView?.enrolmentId === idOf(samDwt))
check('the Forex courses of their academy they are not on — never a draft, another programme\'s or another academy\'s',
  titles(view.offered) === 'Market Structure', titles(view.offered))
check('...each with its modules, in order', titles(view.offered[0]?.modules ?? []) === 'M1 Structure, M2 Liquidity, M3 Entries')
check('who they are: let in, their academy', view.student.approved && view.student.academy === 'Delta Institutions Dubai' && view.student.email === 'sam@lms.test')
check('a student not let in yet says so', (await courseAccessForPortal({ email: 'pia@lms.test' })).student.approved === false)
check('nobody by that address: not found', await refusal(() => courseAccessForPortal({ email: 'ghost@lms.test' })) === 'NOT_FOUND 404')
check('a member of staff: not found', await refusal(() => courseAccessForPortal({ email: 'cara.cs@portal.test' })) === 'NOT_FOUND 404')
check('not one address: refused', await refusal(() => courseAccessForPortal({ email: ['sam@lms.test'] })) === 'VALIDATION_ERROR 400')

step('B. Giving courses')
const enrolments = () => EnrollmentModel.countDocuments({})
let before = await enrolments()
const tooMany = Array.from({ length: 21 }, () => ({ courseId: idOf(msnr), locked: [] }))
for (const [label, courses] of [
  ['another programme\'s course', [{ courseId: idOf(dm), locked: [] }]],
  ['a draft', [{ courseId: idOf(draftFx), locked: [] }]],
  ['another academy\'s', [{ courseId: idOf(blrFx), locked: [] }]],
  ['a course that is not there', [{ courseId: idOf(new Types.ObjectId()), locked: [] }]],
  ['one good, one bad — nothing given', [{ courseId: idOf(msnr), locked: [] }, { courseId: idOf(dm), locked: [] }]],
  ['another course\'s module locked on it', [{ courseId: idOf(msnr), locked: [W['W1 Basics']] }]],
  ['no list of locked modules', [{ courseId: idOf(msnr) }]],
  ['none', []],
  ['more than 20', tooMany],
] as const) {
  check(`refused: ${label}`, await refusal(() => giveCoursesForPortal({ email: 'sam@lms.test', courses, ...by })) === 'VALIDATION_ERROR 400')
}
check('...and none of these gave anything', await enrolments() === before && await countOf(msnr) === 2)

await UserModel.updateOne({ _id: desk }, { $set: { isActive: false } })
check('neither the CS\'s own account nor the shared one: a 503 that says so, nothing given',
  await refusal(() => giveCoursesForPortal({ email: 'sam@lms.test', courses: [{ courseId: idOf(msnr), locked: [] }], byName: 'Nina CS', byEmail: 'nina.cs@portal.test' })) === 'NOT_CONFIGURED 503'
    && await enrolments() === before)
await UserModel.updateOne({ _id: desk }, { $set: { isActive: true } })

const gave = await giveCoursesForPortal({ email: 'sam@lms.test', courses: [{ courseId: idOf(msnr), locked: [M['M2 Liquidity']] }], ...by })
check('given: the course, the modules picked locked and the rest open',
  gave.given.join() === 'Market Structure' && lockedOf(gave.courses.find(c => c.title === 'Market Structure')) === 'M2 Liquidity', JSON.stringify(gave.courses.map(c => [c.title, lockedOf(c)])))
const samMsnr = await EnrollmentModel.findOne({ userId: sam, courseId: msnr }).lean() as Record<string, any> | null
check('...made as the admin makes one, the course\'s count kept in step', samMsnr?.source === 'admin' && samMsnr?.status === 'active' && await countOf(msnr) === 3)
check('...and no longer offered', titles(gave.offered) === '', titles(gave.offered))
let rows = await audits('enrollment.create', sam)
check('...audited: from the CS\'s own account, which course, which modules locked',
  rows.length === 1 && idOf(rows[0]?.actorId) === idOf(cara) && rows[0]?.actorEmail === 'cara.cs@portal.test' && rows[0]?.meta?.from === 'own'
    && rows[0]?.meta?.course === 'Market Structure' && rows[0]?.meta?.locked?.join() === 'M2 Liquidity' && rows[0]?.meta?.via === 'tetra-commission'
    && idOf(rows[0]?.organizationId) === idOf(dubai), JSON.stringify(rows[0]))
const again = await giveCoursesForPortal({ email: 'sam@lms.test', courses: [{ courseId: idOf(msnr), locked: [] }], ...by })
check('a course they are on already: left as it is, and said so',
  again.given.length === 0 && again.already.join() === 'Market Structure' && await countOf(msnr) === 3
    && (await blockedNow(samMsnr?._id)).join() === M['M2 Liquidity'] && (await audits('enrollment.create', sam)).length === 1)
const shared = await giveCoursesForPortal({ email: 'ava@lms.test', courses: [{ courseId: idOf(msnr), locked: [] }], byName: 'Nina CS', byEmail: 'nina.cs@portal.test' })
rows = await audits('enrollment.create', ava)
check('a CS with no LMS account: from the shared one, with their address and name',
  shared.given.join() === 'Market Structure' && idOf(rows[0]?.actorId) === idOf(desk) && rows[0]?.actorEmail === 'nina.cs@portal.test'
    && rows[0]?.meta?.byName === 'Nina CS' && rows[0]?.meta?.from === 'shared', JSON.stringify(rows[0]))

step('C. Opening and locking modules')
let changed = await setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDwt), locked: [W['W1 Basics'], W['W4 Live']], ...by })
check('one locked, one the fee had locked opened', changed.changed && changed.locked.join() === 'W1 Basics' && changed.opened.join() === 'W3 Fibonacci',
  JSON.stringify({ locked: changed.locked, opened: changed.opened }))
check('...as the student will see it', lockedOf(changed.courses.find(c => c.title === 'Delta Wave Theory')) === 'W1 Basics, W4 Live')
const blocked = await blockedNow(samDwt)
check('...anything else in the list kept as it was', blocked.includes(idOf(stale)) && blocked.length === 3, blocked.join())
rows = await audits('enrollment.access', sam)
check('...audited with what was opened and what was locked',
  rows.length === 1 && rows[0]?.meta?.opened?.join() === 'W3 Fibonacci' && rows[0]?.meta?.locked?.join() === 'W1 Basics' && rows[0]?.meta?.course === 'Delta Wave Theory')
changed = await setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDwt), locked: [W['W4 Live'], W['W1 Basics']], ...by })
check('nothing to change: nothing done, nothing audited', !changed.changed && (await audits('enrollment.access', sam)).length === 1)
changed = await setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDwt), locked: [], ...by })
check('an empty list opens them all — the old id still kept', changed.opened.join(', ') === 'W1 Basics, W4 Live' && (await blockedNow(samDwt)).join() === idOf(stale))
check('another student\'s course: not found',
  await refusal(() => setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(avaDwt), locked: [], ...by })) === 'NOT_FOUND 404')
check('a course of another programme: not found here',
  await refusal(() => setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDm), locked: [D['D1 Ads']], ...by })) === 'NOT_FOUND 404')
check('another course\'s module: refused',
  await refusal(() => setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDwt), locked: [M['M1 Structure']], ...by })) === 'VALIDATION_ERROR 400')
check('no list: refused', await refusal(() => setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: idOf(samDwt), locked: W['W1 Basics'], ...by })) === 'VALIDATION_ERROR 400')
check('not an id: not found', await refusal(() => setModuleAccessForPortal({ email: 'sam@lms.test', enrolmentId: 'give', locked: [], ...by })) === 'NOT_FOUND 404')

step('D. Approving with courses')
const approved = await approveEnrolmentForPortal({
  userId: idOf(pia), email: 'pia@lms.test', ...by,
  courses: [{ courseId: idOf(dwt), locked: [W['W4 Live']] }, { courseId: idOf(msnr), locked: [] }],
})
check('let in on Forex and put on both courses at once',
  approved.request.status === 'approved' && approved.request.categories.includes('4x-trading') && approved.courses?.given.join() === 'Delta Wave Theory,Market Structure',
  JSON.stringify({ status: approved.request.status, courses: approved.courses }))
view = await courseAccessForPortal({ email: 'pia@lms.test' })
check('...each with the modules picked locked', lockedOf(view.courses.find(c => c.title === 'Delta Wave Theory')) === 'W4 Live' && lockedOf(view.courses.find(c => c.title === 'Market Structure')) === '')
before = await enrolments()
check('a course that cannot be given: approves nobody',
  await refusal(() => approveEnrolmentForPortal({ userId: idOf(rae), email: 'rae@lms.test', ...by, courses: [{ courseId: idOf(dm), locked: [] }] })) === 'VALIDATION_ERROR 400'
    && (await UserModel.findById(rae).select('enrollmentStatus').lean() as { enrollmentStatus?: string } | null)?.enrollmentStatus === 'pending' && await enrolments() === before)
const twice = await approveEnrolmentForPortal({ userId: idOf(ava), email: 'ava@lms.test', ...by, courses: [{ courseId: idOf(dwt), locked: [] }] })
check('already in: nothing else changed, the course they are on left as it is', twice.already === true && twice.courses?.already.join() === 'Delta Wave Theory')
await setFinanceCheckEnabled(true)
before = await enrolments()
const refused = await refusal(() => approveEnrolmentForPortal({ userId: idOf(fay), email: 'fay@lms.test', ...by, courses: [{ courseId: idOf(msnr), locked: [] }] }))
check('finance refusing: nobody let in, no course given',
  refused !== 'ok' && (await UserModel.findById(fay).select('enrollmentStatus').lean() as { enrollmentStatus?: string } | null)?.enrollmentStatus === 'pending' && await enrolments() === before, refused)
await setFinanceCheckEnabled(false)
const plain = await approveEnrolmentForPortal({ userId: idOf(fay), email: 'fay@lms.test', ...by })
check('approving without courses works as before', plain.request.status === 'approved' && plain.courses === undefined && plain.from === 'own')

step('E. Over HTTP, behind the /service secret')
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
const live = await serve(app => { app.use('/service', portalRoutes); app.use('/service', portalActivityRoutes) })
const ask = async (path: string, body: unknown, secret?: string) => {
  const res = await fetch(`${live.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-portal-secret': secret } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } } }
}
check('no secret: refused', (await ask('/service/students/course-access', { email: 'sam@lms.test' })).status === 401)
const httpView = await ask('/service/students/course-access', { email: 'sam@lms.test' }, CRM_SECRET)
check('the courses, by POST', httpView.status === 200 && httpView.body.data?.courses?.length === 2, JSON.stringify(httpView.body).slice(0, 200))
const rex = await student('rex@lms.test', 'Rex Http')
const httpGive = await ask('/service/students/course-access/give', { email: 'rex@lms.test', courses: [{ courseId: idOf(dwt), locked: [W['W2 Waves']] }], ...by }, CRM_SECRET)
check('given over HTTP — /give is not taken for a course', httpGive.status === 200 && httpGive.body.data?.given?.[0] === 'Delta Wave Theory', JSON.stringify(httpGive.body).slice(0, 200))
const rexDwt = await EnrollmentModel.findOne({ userId: rex, courseId: dwt }).select('_id').lean() as { _id: unknown } | null
const httpLock = await ask(`/service/students/course-access/${idOf(rexDwt?._id)}`, { email: 'rex@lms.test', locked: [W['W1 Basics']], ...by }, CRM_SECRET)
check('modules over HTTP', httpLock.status === 200 && httpLock.body.data?.locked?.[0] === 'W1 Basics' && httpLock.body.data?.opened?.[0] === 'W2 Waves', JSON.stringify(httpLock.body).slice(0, 300))
const httpApprove = await ask(`/service/enrolment-requests/${idOf(rae)}/approve`, { email: 'rae@lms.test', ...by, courses: [{ courseId: idOf(msnr), locked: [] }] }, CRM_SECRET)
check('approved with a course over HTTP', httpApprove.status === 200 && httpApprove.body.data?.courses?.given?.[0] === 'Market Structure', JSON.stringify(httpApprove.body).slice(0, 300))
const httpBad = await ask('/service/students/course-access/give', { email: 'rex@lms.test', courses: [{ courseId: idOf(dm), locked: [] }], ...by }, CRM_SECRET)
check('a refusal as its code, not a server fault', httpBad.status === 400 && httpBad.body.error?.code === 'VALIDATION_ERROR', JSON.stringify(httpBad.body))
live.close()
const unguarded = await serve(app => { app.use('/service', portalActivityRoutes) })
const sneaked = await fetch(`${unguarded.url}/service/students/course-access`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-portal-secret': CRM_SECRET }, body: '{"email":"sam@lms.test"}' })
check('mounted where the secret check has not run: refused even with the right secret', sneaked.status === 401)
unguarded.close()

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
