/* ─────────────────────────────────────────────────────────────
   The help desk, class assignments and students' courses, for the commission
   portal (services/portalActivity.service.ts, services/portalEnrolments.service.ts,
   routes/portalActivity.routes.ts).

   Pinned here, against a real database:

     A. what happened after `since` is the student's own doing — opening a
        ticket, writing on one, sending a class assignment, having one
        approved or rejected — never support's replies or the automatic
        welcome; oldest first; each with a key that is the same however
        often it is asked for, so an overlap can be dropped;
     B. nothing from before `since`, and nothing from before the longest a
        portal that was away may ask back; a `since` that is not a date is
        refused;
     C. one student's tickets, with who said what; one student's class
        assignments, with the class, the course, the mentor and the reviews —
        the files by name only;
     D. students' courses, by email: each with its academy and programme, how
        they were put on it (a finance invoice told apart from a purchase), how
        much the fee has opened, progress, finished with the certificate, or
        dropped; somebody with no account said so; at most 500 at a time;
     E. over HTTP, only behind the /service secret check — and refused, not
        answered, if mounted where that check has not run.

   Run: bun --no-env-file src/tests/portalactivity.suite.ts
   (PORTALACTIVITY_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PORTALACTIVITY_DATABASE_URL ?? 'mongodb://localhost:27017/lms_portalactivity'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/portalactivity-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'portalactivity-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'portalactivity-suite-refresh-secret-0123456789'
const CRM_SECRET = 'portalactivity-suite-crm-secret-0123456789'
process.env.SALES_CRM_SECRET = CRM_SECRET
process.env.ROOT_ERP_SECRET  = ''

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { Types } = mongoose
const { UserModel, CourseModel, LiveClassModel, SupportTicketModel, ClassAssignmentModel, EnrollmentModel, OrganizationModel } = await import('@/models/schema.ts')
const { enrolmentsForPortal } = await import('@/services/portalEnrolments.service.ts')
const { studentActivityForPortal, supportTicketsForPortal, classAssignmentsForPortal } = await import('@/services/portalActivity.service.ts')
const { PortalError } = await import('@/services/portal.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_portalactivity') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const now = new Date()
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const at = (msAgo: number) => new Date(now.getTime() - msAgo)
const iso = (d: Date) => d.toISOString()

// Raw rows: this is about what is reported, not about what makes a valid ticket or class.
const person = async (email: string, name: string, role = 'student') =>
  (await UserModel.collection.insertOne({ email, name, role, isActive: true, enrollmentStatus: 'approved', createdAt: at(10 * DAY), updatedAt: at(10 * DAY) })).insertedId
const student = await person('learner@lms.test', 'Leila Learner')
const mentor  = await person('mentor@lms.test', 'Marco Mentor', 'instructor')
const helper  = await person('support@lms.test', 'Sara Support', 'admin')
const course  = (await CourseModel.collection.insertOne({ title: 'Delta Wave Theory Trading Programme', slug: 'dwt-pa', program: '4x-trading', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const klass   = (await LiveClassModel.collection.insertOne({ title: 'Wave counts, part 2', courseId: course, scheduledStart: at(4 * HOUR), createdAt: at(DAY), updatedAt: at(DAY) })).insertedId

const msg = (senderRole: 'student' | 'admin', body: string, ago: number, senderId?: unknown) =>
  ({ _id: new Types.ObjectId(), senderRole, body, createdAt: at(ago), ...(senderId ? { senderId } : {}) })
const ticket = async (subject: string, category: string, status: string, messages: ReturnType<typeof msg>[], userId: unknown = student) => {
  const last = messages[messages.length - 1]!
  return (await SupportTicketModel.collection.insertOne({
    userId, subject, category, status, messages,
    lastMessageAt: last.createdAt, lastSenderRole: last.senderRole,
    createdAt: messages[0]!.createdAt, updatedAt: last.createdAt,
  })).insertedId
}

// Opened three hours ago; support answered; the student wrote again an hour ago.
const oldReply = msg('student', 'Still cannot see module 3', HOUR)
const oldTicket = await ticket('Module 3 is locked', 'course', 'open', [
  msg('student', 'Module 3 says locked', 3 * HOUR), msg('admin', 'Thanks — we have your ticket', 3 * HOUR),
  msg('admin', 'Fixed, try again', 2.5 * HOUR, helper), oldReply,
])
// Opened half an hour ago: the welcome, support's answer, then the student again.
const newOpening = msg('student', 'The video will not play on my phone', 30 * MIN)
const newReply = msg('student', 'It is an iPhone 13', 10 * MIN)
const newTicket = await ticket('Video does not play', 'technical', 'open', [
  newOpening, msg('admin', 'Thanks — we have your ticket', 30 * MIN), msg('admin', 'Which phone is it?', 20 * MIN, helper), newReply,
])
// Another student's, forty days old; and one whose account is gone.
const other = await person('other@lms.test', 'Omar Other')
await ticket('Ancient', 'other', 'closed', [msg('student', 'Long ago', 40 * DAY)], other)
await ticket('Orphan', 'other', 'open', [msg('student', 'My account was deleted', 25 * MIN)], new Types.ObjectId())

// Sent, rejected, sent again — and an older one approved five minutes ago.
const revised = (await ClassAssignmentModel.collection.insertOne({
  studentId: student, liveClassId: klass, courseId: course, instructorId: mentor, title: 'Wave count on EURUSD',
  note: 'My count for the London session', files: [{ url: 'r2://x/chart.png', name: 'chart.png', mimeType: 'image/png', sizeBytes: 1200 }],
  status: 'pending', attempt: 2, lastReason: 'Add the chart for wave 3',
  reviews: [{ status: 'rejected', reason: 'Add the chart for wave 3', reviewerId: mentor, attempt: 1, reviewedAt: at(40 * MIN) }],
  submittedAt: at(15 * MIN), reviewedAt: at(40 * MIN), createdAt: at(50 * MIN), updatedAt: at(15 * MIN),
})).insertedId
const approved = (await ClassAssignmentModel.collection.insertOne({
  studentId: student, liveClassId: klass, courseId: course, instructorId: mentor, title: 'First wave count',
  files: [], status: 'approved', attempt: 1,
  reviews: [{ status: 'approved', reviewerId: mentor, attempt: 1, reviewedAt: at(5 * MIN) }],
  submittedAt: at(3 * HOUR), reviewedAt: at(5 * MIN), createdAt: at(3 * HOUR), updatedAt: at(5 * MIN),
})).insertedId

step('A. What happened after `since`')
const two = await studentActivityForPortal({ since: iso(at(2 * HOUR)), now })
const keys = two.events.map(e => e.key)
check('six things the student did, oldest first', JSON.stringify(keys) === JSON.stringify([
  `ticket-reply:${oldTicket}:${oldReply._id}`,
  `assignment-reviewed:${revised}:1`,
  `ticket-opened:${newTicket}`,
  `assignment-submitted:${revised}:2`,
  `ticket-reply:${newTicket}:${newReply._id}`,
  `assignment-reviewed:${approved}:1`,
]), JSON.stringify(keys, null, 1))
check('never support\'s replies, the automatic welcome, or a ticket of an account that is gone',
  !two.events.some(e => /Fixed|Which phone|we have your ticket|deleted/.test(e.ticket?.message ?? '')))
const opened = two.events.find(e => e.type === 'ticket_opened')!
check('a new ticket: its subject, category, status and the student\'s words',
  opened.ticket?.subject === 'Video does not play' && opened.ticket.category === 'technical' && opened.ticket.status === 'open' &&
  opened.ticket.message === 'The video will not play on my phone', JSON.stringify(opened.ticket))
check('...and who: their LMS id, address and name',
  opened.student.lmsUserId === String(student) && opened.student.email === 'learner@lms.test' && opened.student.name === 'Leila Learner')
const reply = two.events.find(e => e.key === `ticket-reply:${newTicket}:${newReply._id}`)!
check('a reply carries what they wrote then', reply.type === 'ticket_reply' && reply.ticket?.message === 'It is an iPhone 13' && reply.at === iso(at(10 * MIN)))
const sent = two.events.find(e => e.type === 'assignment_submitted')!
check('a revision sent: attempt 2, with the class, the course and the mentor',
  sent.assignment?.attempt === 2 && sent.assignment.title === 'Wave count on EURUSD' && sent.assignment.className === 'Wave counts, part 2' &&
  sent.assignment.course === 'Delta Wave Theory Trading Programme' && sent.assignment.mentor === 'Marco Mentor' &&
  sent.assignment.files === 1 && sent.assignment.classAt === iso(at(4 * HOUR)), JSON.stringify(sent.assignment))
const rejected = two.events.find(e => e.key === `assignment-reviewed:${revised}:1`)!
check('a rejection: the decision and the reason', rejected.assignment?.decision === 'rejected' && rejected.assignment.reason === 'Add the chart for wave 3' && rejected.assignment.attempt === 1)
const ok = two.events.find(e => e.key === `assignment-reviewed:${approved}:1`)!
check('an approval: the decision, no reason', ok.assignment?.decision === 'approved' && ok.assignment.reason === undefined)
check('up to now: `until` is the moment asked', two.until === iso(now))
const overlap = await studentActivityForPortal({ since: iso(at(20 * MIN)), now })
check('asked again over the last twenty minutes: the same keys for the same things',
  JSON.stringify(overlap.events.map(e => e.key)) === JSON.stringify(keys.slice(3)), JSON.stringify(overlap.events.map(e => e.key)))

step('B. Before `since`, too long ago, or not a date')
check('nothing from before `since`', (await studentActivityForPortal({ since: iso(at(4 * MIN)), now })).events.length === 0)
const longAway = await studentActivityForPortal({ since: iso(at(60 * DAY)), now })
check('a portal away sixty days is answered for the last thirty-one: the forty-day-old ticket is not there',
  !longAway.events.some(e => e.ticket?.subject === 'Ancient') && longAway.events.some(e => e.key === `ticket-opened:${oldTicket}`))
let refused: unknown = null
try { await studentActivityForPortal({ since: 'last tuesday', now }) } catch (err) { refused = err }
check('a `since` that is not a date is refused', refused instanceof PortalError && (refused as InstanceType<typeof PortalError>).statusCode === 400)

step('C. One student\'s tickets and assignments')
const t = await supportTicketsForPortal({ email: ' Learner@LMS.test ' })
check('found by address, whatever its case', t.exists && t.email === 'learner@lms.test')
check('newest first', t.tickets.map(x => x.subject).join(' | ') === 'Video does not play | Module 3 is locked', t.tickets.map(x => x.subject).join(' | '))
check('who said what: the student, the automatic welcome, support',
  t.tickets[0]!.messages.map(m => m.from).join(',') === 'student,automatic,support,student' && t.tickets[0]!.lastFrom === 'student',
  t.tickets[0]!.messages.map(m => m.from).join(','))
check('nobody with that address: said so, nothing else', JSON.stringify(await supportTicketsForPortal({ email: 'nobody@lms.test' })) === JSON.stringify({ email: 'nobody@lms.test', exists: false, tickets: [] }))
let badEmail: unknown = null
try { await supportTicketsForPortal({ email: 'not an address' }) } catch (err) { badEmail = err }
check('not an address: refused', badEmail instanceof PortalError)
const a = await classAssignmentsForPortal({ email: 'learner@lms.test' })
check('assignments newest first', a.assignments.map(x => x.title).join(' | ') === 'Wave count on EURUSD | First wave count')
const first = a.assignments[0]!
check('the class, course and mentor; waiting again after a rejection, so no reason now — the reviews keep it',
  first.className === 'Wave counts, part 2' && first.course === 'Delta Wave Theory Trading Programme' && first.mentor === 'Marco Mentor' &&
  first.status === 'pending' && first.attempt === 2 && first.reason === '' &&
  first.reviews.length === 1 && first.reviews[0]!.status === 'rejected' && first.reviews[0]!.reason === 'Add the chart for wave 3', JSON.stringify(first))
check('the files by name only — no link to them', JSON.stringify(first.files) === JSON.stringify(['chart.png']) && !JSON.stringify(a).includes('r2://'))

step('D. Students\' courses')
const dubai = (await OrganizationModel.collection.insertOne({ name: 'Delta Dubai', slug: 'dubai-pa', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const mbo = (await CourseModel.collection.insertOne({ title: 'Market Break-Out Trading', slug: 'mbo-pa', program: '4x-trading', organizationId: dubai, createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const oldCourse = (await CourseModel.collection.insertOne({ title: 'Old Course', slug: 'old-pa', createdAt: at(DAY), updatedAt: at(DAY) })).insertedId
const enrol = (courseId: unknown, enrolledAgo: number, extra: Record<string, unknown>) =>
  EnrollmentModel.collection.insertOne({ userId: student, courseId, status: 'active', source: 'admin', progressPercent: 0, blockedLessons: [], enrolledAt: at(enrolledAgo), createdAt: at(enrolledAgo), updatedAt: at(enrolledAgo), ...extra })
await enrol(course, 10 * DAY, { source: 'purchase', progressPercent: 35, paymentAccess: { status: 'partial', invoiceId: 'inv-9' } })
await enrol(mbo, 30 * DAY, { status: 'completed', progressPercent: 100, completedAt: at(2 * DAY), certificateId: 'cert-1' })
await enrol(oldCourse, 20 * DAY, { status: 'dropped', progressPercent: 12 })
const asked = await enrolmentsForPortal({ emails: [' LEARNER@lms.test', 'other@lms.test', 'nobody@lms.test'] })
check('every address asked, in order, whatever its case', asked.students.map(s => `${s.email}:${s.exists}`).join(' ') === 'learner@lms.test:true other@lms.test:true nobody@lms.test:false',
  asked.students.map(s => `${s.email}:${s.exists}`).join(' '))
const theirs = asked.students[0]!.courses
check('their courses, oldest first — dropped ones too', theirs.map(c => `${c.title}:${c.status}`).join(' | ') === 'Market Break-Out Trading:completed | Old Course:dropped | Delta Wave Theory Trading Programme:active',
  theirs.map(c => `${c.title}:${c.status}`).join(' | '))
const fin = theirs.find(c => c.slug === 'dwt-pa')!
check('from a finance invoice: said so, with part of the fee paid and their progress',
  fin.how === 'finance' && fin.access === 'partial' && fin.progress === 35 && fin.program === '4x-trading' && fin.enrolledAt === iso(at(10 * DAY)), JSON.stringify(fin))
const done = theirs.find(c => c.slug === 'mbo-pa')!
check('finished: completed, when, the certificate, and the academy that runs it',
  done.status === 'completed' && done.completedAt === iso(at(2 * DAY)) && done.certificate && done.academy === 'Delta Dubai' && done.how === 'admin' && done.access === '', JSON.stringify(done))
check('an account with no course: there, with none', asked.students[1]!.courses.length === 0)
let badList: unknown = null, tooMany: unknown = null
try { await enrolmentsForPortal({ emails: 'learner@lms.test' }) } catch (err) { badList = err }
try { await enrolmentsForPortal({ emails: Array.from({ length: 501 }, (_, i) => `x${i}@lms.test`) }) } catch (err) { tooMany = err }
check('not a list, or more than 500: refused', badList instanceof PortalError && tooMany instanceof PortalError)

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
// As routes/index.ts mounts them.
const live = await serve(app => { app.use('/service', portalRoutes); app.use('/service', portalActivityRoutes) })
const ask = async (base: string, path: string, secret?: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-portal-secret': secret } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) as { data?: any; error?: { code?: string } } }
}
const sinceQ = `?since=${encodeURIComponent(iso(at(2 * HOUR)))}`
check('no secret: refused', (await ask(live.url, `/service/student-activity${sinceQ}`)).status === 401)
check('a wrong secret: refused', (await ask(live.url, `/service/student-activity${sinceQ}`, 'guess')).status === 401)
const viaHttp = await ask(live.url, `/service/student-activity${sinceQ}`, CRM_SECRET)
check('the sales CRM\'s secret, as the commission portal sends it: answered', viaHttp.status === 200 && viaHttp.body.data?.events?.length === 6, JSON.stringify(viaHttp.body).slice(0, 200))
const noSince = await ask(live.url, '/service/student-activity', CRM_SECRET)
check('no `since`: a 400 with the reason, not a server fault', noSince.status === 400 && noSince.body.error?.code === 'VALIDATION_ERROR', JSON.stringify(noSince.body))
const tix = await ask(live.url, '/service/support-tickets', CRM_SECRET, { email: 'learner@lms.test' })
const asg = await ask(live.url, '/service/class-assignments', CRM_SECRET, { email: 'learner@lms.test' })
check('tickets and assignments by POST', tix.status === 200 && tix.body.data?.tickets?.length === 2 && asg.status === 200 && asg.body.data?.assignments?.length === 2)
const courses = await ask(live.url, '/service/enrolments', CRM_SECRET, { emails: ['learner@lms.test'] })
check('courses by POST, and not without the secret', courses.status === 200 && courses.body.data?.students?.[0]?.courses?.length === 3 &&
  (await ask(live.url, '/service/enrolments', undefined, { emails: ['learner@lms.test'] })).status === 401, JSON.stringify(courses.body).slice(0, 200))
live.close()
const unguarded = await serve(app => { app.use('/service', portalActivityRoutes) })
check('mounted where the secret check has not run: refused even with the right secret',
  (await ask(unguarded.url, `/service/student-activity${sinceQ}`, CRM_SECRET)).status === 401)
unguarded.close()

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
