/* ─────────────────────────────────────────────────────────────
   FEATURE — post-class assignments.

   A student who attended a live class sends work to the instructor who ran
   it. The instructor approves it, or sends it back with a reason; the student
   revises and sends again. Both directions notify in-app AND by email.

   What this suite is careful about, because most of the feature is
   authorisation and most authorisation tests pass while proving nothing:

     • ENTITLEMENT is asserted from both sides. A booked student can submit
       AND a student without a booking is refused AND a student whose booking
       was cancelled is refused. Only checking the happy path would pass with
       the entitlement check deleted entirely.
     • The instructor, course and module are read from the SESSION, never from
       the request. The suite sends a FORGED instructorId in the payload and
       asserts the stored row ignored it — a check that fails the moment
       somebody "helpfully" spreads req.body into the create call.
     • Every isolation check has a POSITIVE twin. "Instructor B sees nothing"
       is worthless unless instructor A sees exactly one thing in the same
       breath — a broken query returns empty for everybody.
     • Notifications are asserted as OUTCOMES: a Notification row exists and a
       message reached the mail transport. The request answers 200 either way.
     • The reason a rejection carries is asserted to reach the student, in
       both channels. A reject flow that silently drops the reason is the
       single most likely way this feature disappoints someone.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_assignments_suite), dropped on exit. Mail is captured through the
   service's own console transport, so the real send path runs and nothing
   leaves the machine.

   Run: bun run test:assignments
───────────────────────────────────────────────────────────── */
const nodePathBoot = await import('path')
/* This suite reads the maildir back and asserts on what is in it, so it needs
   a directory of its own. The shared .logs/emails is written by every suite
   and by the dev server, and mailbox() can only filter by timestamp -- so a
   second writer's mail lands inside this run's window, and the teardown below
   would delete it. Per-process directory, named after the pid. */
process.env.EMAIL_LOG_DIR = nodePathBoot.join(
  process.cwd(), '.logs', 'emails-assignments-' + String(process.pid))
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_assignments_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* Force the console transport. Set to '' rather than deleted: dotenv does not
   overwrite a variable that is present, but it DOES fill in one that is
   absent — deleting these hands them back from .env and the suite starts
   posting real mail to gmail for every @t.local address. */
process.env.SMTP_HOST  = ''
process.env.SMTP_USER  = ''
process.env.SMTP_PASS  = ''
process.env.EMAIL_FROM = ''
/* No R2 → uploads resolve against BACKEND_PUBLIC_URL, which is what the file
   reference validator accepts. Same reason as the other suites. */
process.env.R2_ACCOUNT_ID     = ''
process.env.R2_ACCESS_KEY_ID  = ''
process.env.R2_BUCKET_NAME    = ''

export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)

const nodeFs   = await import('fs/promises')
const nodePath = await import('path')
/* The per-process directory set at the top of this file -- never the
   shared one, which the dev server and every other suite also write. */
const MAILDIR  = process.env.EMAIL_LOG_DIR!
const SUITE_START = Date.now() - 1
let mailMark = SUITE_START

interface Mail { to: string; subject: string; body: string }

async function mailbox(): Promise<Mail[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(MAILDIR) } catch { return [] }
  const out: Mail[] = []
  for (const n of names) {
    if (!n.endsWith('.html')) continue
    const ts = Number(n.split('-')[0])
    if (!Number.isFinite(ts) || ts < mailMark) continue
    const raw  = await nodeFs.readFile(nodePath.join(MAILDIR, n), 'utf8')
    const head = raw.slice(0, raw.indexOf('\n') + 1)
    out.push({
      to:      (head.match(/to:\s*([^|]+)\|/)?.[1] ?? '').trim(),
      subject: (head.match(/subject:\s*(.*?)\s*-->/)?.[1] ?? '').trim(),
      body:    raw,
    })
  }
  return out
}
const resetMail = () => { mailMark = Date.now() - 1 }

const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, NotificationModel, EnrollmentModel, ClassAssignmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { env } = await import('@/config/env.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_assignments_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
/* The one-submission-per-session invariant is an index, and autoIndex is off
   above (it makes every suite slower). Build just this one so the race check
   at the end is testing something real. */
await ClassAssignmentModel.syncIndexes().catch(() => {})

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}

const ok   = (r: { status: number }) => r.status >= 200 && r.status < 300
const why  = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 70)}`
const code = (r: { body: any }) => String(r.body?.error?.code ?? '')
const PW   = 'CorrectHorse1'

/** A file reference of the shape POST /uploads/document really returns. */
const upload = (name: string, mime = 'image/png') => ({
  url:       `${env.BACKEND_PUBLIC_URL}/uploads/documents/${name}`,
  name,
  mimeType:  mime,
  sizeBytes: 4096,
})

async function until(want: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    if (await want()) return true
    if (Date.now() - t0 > ms) return false
    await new Promise(r => setTimeout(r, 120))
  }
}

try {
  /* ── Fixtures ─────────────────────────────────────────────────────────── */
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy',     slug: 'dubai',     currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (email: string, role: string, org = dubai, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra })

  const superAdmin = await mk('super@t.local', 'super_admin')
  await mk('admin@t.local',    'admin')
  const otherOrgAdmin = await mk('blr.admin@t.local', 'admin', blr)
  const teacherA  = await mk('teacher.a@t.local', 'instructor')
  const teacherB  = await mk('teacher.b@t.local', 'instructor')

  const attendee  = await mk('attendee@t.local',  'student', dubai, { enrollmentStatus: 'approved' })
  const classmate = await mk('classmate@t.local', 'student', dubai, { enrollmentStatus: 'approved' })
  const withdrew  = await mk('withdrew@t.local',  'student', dubai, { enrollmentStatus: 'approved' })
  const outsider  = await mk('outsider@t.local',  'student', dubai, { enrollmentStatus: 'approved' })

  const course = await CourseModel.create({
    title: 'Assignment Feature Course', slug: `asg-${Date.now()}`,
    description: 'Seeded for the post-class assignment suite.',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: teacherA._id, organizationId: dubai._id,
  })
  const module1 = await SectionModel.create({ courseId: course._id, title: 'Module One — Risk', order: 1 })

  for (const u of [attendee, classmate, withdrew, outsider]) {
    await EnrollmentModel.create({ userId: u._id, courseId: course._id })
  }

  const mkClass = (title: string, instructor: typeof teacherA, daysAgo: number, org = dubai) =>
    LiveClassModel.create({
      courseId: course._id, sectionId: module1._id, title,
      scheduledStart: new Date(Date.now() - daysAgo * 86_400_000),
      durationMins: 60, type: 'external', instructorId: instructor._id,
      organizationId: org._id, language: 'English', status: 'scheduled',
      isOnline: false, location: 'Campus', room: 'A1', sessionCapacity: 30,
    })

  const sessionA = await mkClass('Risk Management Live',  teacherA, 2)
  const sessionB = await mkClass('Charting Fundamentals', teacherB, 3)
  const sessionC = await mkClass('Never Attended',        teacherA, 4)

  await ClassBookingModel.create({ userId: attendee._id,  liveClassId: sessionA._id, status: 'attended' })
  await ClassBookingModel.create({ userId: classmate._id, liveClassId: sessionA._id, status: 'booked'   })
  await ClassBookingModel.create({ userId: attendee._id,  liveClassId: sessionB._id, status: 'booked'   })
  await ClassBookingModel.create({ userId: withdrew._id,  liveClassId: sessionA._id, status: 'cancelled' })
  /* `outsider` books nothing at all. */

  /* ── Sessions ─────────────────────────────────────────────────────────── */
  const attendeeJar: Jar  = new Map()
  const classmateJar: Jar = new Map()
  const withdrewJar: Jar  = new Map()
  const outsiderJar: Jar  = new Map()
  const teacherAJar: Jar  = new Map()
  const teacherBJar: Jar  = new Map()
  const superJar: Jar     = new Map()
  const blrAdminJar: Jar  = new Map()

  const login = async (jar: Jar, email: string, admin = false) =>
    call('POST', admin ? '/admin/auth/login' : '/auth/login', { jar, body: { email, password: PW } })

  section('SIGN-IN — every actor this suite needs')
  for (const [jar, email, admin] of [
    [attendeeJar,  'attendee@t.local',  false],
    [classmateJar, 'classmate@t.local', false],
    [withdrewJar,  'withdrew@t.local',  false],
    [outsiderJar,  'outsider@t.local',  false],
    [teacherAJar,  'teacher.a@t.local', true],
    [teacherBJar,  'teacher.b@t.local', true],
    [superJar,     'super@t.local',     true],
    [blrAdminJar,  'blr.admin@t.local', true],
  ] as [Jar, string, boolean][]) {
    const r = await login(jar, email, admin)
    check(`${email} signs in`, ok(r), why(r))
  }

  const notesFor = async (userId: unknown, match: RegExp) =>
    (await NotificationModel.find({ userId }).lean())
      .filter(n => match.test(String((n as any).title)))
  const mailFor = async (to: string, match: RegExp) =>
    (await mailbox()).filter(m => m.to === to && match.test(m.subject))

  /* ══════════ 1. THE DROPDOWN — what a student may submit against ══════════
     This list IS the entitlement surface: the form has no free-text class
     field, so anything absent here cannot be picked in the UI. */
  section('SUBMITTABLE CLASSES — only the sessions this student actually booked')
  {
    const r = await call('GET', '/class-assignments/submittable', { jar: attendeeJar })
    check('the attendee can read their list', ok(r), why(r))
    const ids = (r.body?.data ?? []).map((c: any) => String(c._id ?? c.id))
    check('...it holds exactly their two booked sessions', ids.length === 2, `${ids.length}: ${ids.join(',')}`)
    check('...including the one they attended', ids.includes(String(sessionA._id)))
    check('...and NOT a session they never booked', !ids.includes(String(sessionC._id)))

    const withEntry = (r.body?.data ?? []).find((c: any) => String(c._id ?? c.id) === String(sessionA._id))
    check('...each entry carries the course, so the form fills itself',
      !!withEntry?.courseId?.title, JSON.stringify(withEntry?.courseId))
    check('...the module', !!withEntry?.sectionId?.title, JSON.stringify(withEntry?.sectionId))
    check('...and the instructor', !!withEntry?.instructorId?.name, JSON.stringify(withEntry?.instructorId))

    const w = await call('GET', '/class-assignments/submittable', { jar: withdrewJar })
    check('a student who CANCELLED their booking has an empty list',
      ok(w) && (w.body?.data ?? []).length === 0, why(w))
    const o = await call('GET', '/class-assignments/submittable', { jar: outsiderJar })
    check('a student who booked nothing has an empty list',
      ok(o) && (o.body?.data ?? []).length === 0, why(o))
    const anon = await call('GET', '/class-assignments/submittable')
    check('...and it is not readable without a session', anon.status === 401, why(anon))
  }

  /* ══════════ 1b. WHO SEES WHAT ══════════
     The Assignments tab is in the client nav unconditionally, exactly like
     every other tab in that app — navItems and TOPBAR_TABS are static
     arrays with no role or enrolment gate. So the question that matters is
     not "who sees the tab" but "what does the page do when they open it".

     For anyone without a booking the answer must be a clean empty state:
     the list endpoint returns 200 with [], NOT a 401 or 403. An error there
     would render the section broken for every brand-new signup — the first
     thing a new student would see. */
  section('NEW ACCOUNTS — the page must open cleanly before anyone has booked anything')
  {
    const kinds: Array<[string, string, object]> = [
      ['express signup, awaiting approval', 'new.express@t.local', { signupType: 'express', enrollmentStatus: 'pending' }],
      ['full signup, awaiting approval',    'new.full@t.local',    { signupType: 'full',    enrollmentStatus: 'pending' }],
      ['approved student, nothing booked',  'new.approved@t.local',{ signupType: 'full',    enrollmentStatus: 'approved' }],
      ['a rejected applicant',              'new.rejected@t.local',{ signupType: 'full',    enrollmentStatus: 'rejected' }],
    ]
    for (const [label, email, extra] of kinds) {
      await mk(email, 'student', dubai, extra)
      const jar: Jar = new Map()
      const li = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
      check(`${label} — signs in`, ok(li), why(li))

      const list = await call('GET', '/class-assignments/submittable', { jar })
      check(`${label} — the class list answers 200, not an error`, ok(list), why(list))
      check(`${label} — ...and it is empty`, (list.body?.data ?? []).length === 0, JSON.stringify(list.body?.data ?? []).slice(0, 80))

      const mine = await call('GET', '/class-assignments/me', { jar })
      check(`${label} — their submissions list answers 200`, ok(mine), why(mine))

      /* And they cannot submit anyway — a booking is the entitlement, and
         booking itself is gated on enrolment approval. */
      const attempt = await call('POST', '/class-assignments', {
        jar, body: { liveClassId: String(sessionA._id), title: 'Not entitled', files: [upload('n.png')] },
      })
      check(`${label} — cannot submit against a class they never booked`, attempt.status === 403, why(attempt))
    }
  }

  /* ══════════ 2. SUBMIT ══════════ */
  let assignmentId = ''
  section('SUBMIT — the entitled student sends work, and the instructor hears about it')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const r = await call('POST', '/class-assignments', {
      jar: attendeeJar,
      body: {
        liveClassId: String(sessionA._id),
        title:       'Risk homework — position sizing',
        note:        'Two charts and the worked sheet.',
        files:       [upload('chart1.png'), upload('sheet.pdf', 'application/pdf')],
        /* Fields the client must not be able to set. The schema strips them
           before the service ever sees them — the SERVICE side of the same
           rule is proved directly in the last section, because a mutation
           that made the service trust these sailed through this block. */
        instructorId: String(teacherB._id),
        status:       'approved',
      },
    })
    check('the submission is accepted', r.status === 201, why(r))
    assignmentId = String(r.body?.data?.id ?? r.body?.data?._id ?? '')
    check('...and comes back with an id', assignmentId.length === 24, assignmentId)

    const row = await ClassAssignmentModel.findById(assignmentId).lean()
    check('...the validator dropped the forged instructorId',
      String((row as any)?.instructorId) === String(teacherA._id),
      `stored ${String((row as any)?.instructorId)}`)
    check('...the course comes from the session', String((row as any)?.courseId) === String(course._id))
    check('...the module comes from the session', String((row as any)?.sectionId) === String(module1._id))
    check('...the academy comes from the session', String((row as any)?.organizationId) === String(dubai._id))
    check('...and the forged status too — it opens as pending',
      (row as any)?.status === 'pending', String((row as any)?.status))
    check('...attempt starts at 1', (row as any)?.attempt === 1, String((row as any)?.attempt))
    check('...both files are kept', ((row as any)?.files ?? []).length === 2)

    check('the instructor gets an in-app notification',
      await until(async () => (await notesFor(teacherA._id, /New assignment/i)).length > 0))
    const note = (await notesFor(teacherA._id, /New assignment/i))[0] as any
    check('...naming the class', /Risk Management Live/.test(String(note?.title)), String(note?.title))
    check('...and naming the student', /attendee/.test(String(note?.body)), String(note?.body))

    check('the instructor gets an email',
      await until(async () => (await mailFor('teacher.a@t.local', /New assignment/i)).length === 1))
    const mail = (await mailFor('teacher.a@t.local', /New assignment/i))[0]
    check('...the email names the class and the work',
      !!mail && /Risk Management Live/.test(mail.body) && /position sizing/.test(mail.body), mail?.subject)

    check('the WRONG instructor is told nothing',
      (await notesFor(teacherB._id, /New assignment/i)).length === 0 &&
      (await mailFor('teacher.b@t.local', /New assignment/i)).length === 0)
    check('the student is not notified of their own submission',
      (await notesFor(attendee._id, /assignment/i)).length === 0)
  }

  /* ══════════ 3. WHO MAY SUBMIT ══════════ */
  section('ENTITLEMENT — a booking is what earns the right to submit')
  {
    const body = (id: unknown) => ({
      liveClassId: String(id), title: 'Attempted work', files: [upload('x.png')],
    })
    const noBooking = await call('POST', '/class-assignments', { jar: outsiderJar, body: body(sessionA._id) })
    check('a student who never booked is refused', noBooking.status === 403, why(noBooking))
    check('...with NOT_BOOKED, not a generic error', code(noBooking) === 'NOT_BOOKED', code(noBooking))

    const cancelled = await call('POST', '/class-assignments', { jar: withdrewJar, body: body(sessionA._id) })
    check('a student who cancelled their booking is refused', cancelled.status === 403, why(cancelled))

    const never = await call('POST', '/class-assignments', { jar: attendeeJar, body: body(sessionC._id) })
    check('a booked student cannot submit against a DIFFERENT session', never.status === 403, why(never))

    const anon = await call('POST', '/class-assignments', { body: body(sessionA._id) })
    check('an anonymous caller is refused', anon.status === 401, why(anon))

    /* The positive twin — the same payload from the entitled student works,
       so the three refusals above are the rule biting and not a broken route. */
    const good = await call('POST', '/class-assignments', {
      jar: classmateJar,
      body: { liveClassId: String(sessionA._id), title: 'Classmate work', files: [upload('c.png')] },
    })
    check('...while the classmate WITH a booking succeeds', good.status === 201, why(good))
    await ClassAssignmentModel.deleteOne({ _id: good.body?.data?.id ?? good.body?.data?._id })
  }

  /* ══════════ 4. INPUT ══════════ */
  section('INPUT — what the form will not let through')
  {
    const post = (extra: object) => call('POST', '/class-assignments', {
      jar: attendeeJar,
      body: { liveClassId: String(sessionB._id), title: 'Second class work', files: [upload('a.png')], ...extra },
    })
    check('no files at all is refused',        (await post({ files: [] })).status === 422)
    check('eleven files is refused',           (await post({ files: Array.from({ length: 11 }, (_, i) => upload(`f${i}.png`)) })).status === 422)
    check('a two-character title is refused',  (await post({ title: 'ab' })).status === 422)
    check('a missing class id is refused',     (await post({ liveClassId: undefined })).status === 422)

    const offsite = await post({ files: [{ ...upload('a.png'), url: 'https://evil.example.com/a.png' }] })
    check('a file hosted OFF our storage is refused', offsite.status === 422, why(offsite))
    const scheme = await post({ files: [{ ...upload('a.png'), url: 'javascript:alert(1)' }] })
    check('a javascript: reference is refused', scheme.status === 422, why(scheme))
    const traversal = await post({ files: [{ ...upload('a.png'), url: '../../etc/passwd' }] })
    check('a traversal path is refused', traversal.status === 422, why(traversal))
    const html = await post({ files: [{ ...upload('a.png'), mimeType: 'text/html' }] })
    check('an HTML attachment is refused — the reviewer renders these', html.status === 422, why(html))
    const huge = await post({ files: [{ ...upload('a.png'), sizeBytes: 50 * 1024 * 1024 }] })
    check('a 50 MB claim is refused', huge.status === 422, why(huge))

    const bogus = await call('POST', '/class-assignments', {
      jar: attendeeJar, body: { liveClassId: 'not-an-id', title: 'Bad id work', files: [upload('a.png')] },
    })
    check('a malformed class id answers 4xx, never 500', bogus.status >= 400 && bogus.status < 500, why(bogus))

    /* The positive twin for this whole block. */
    const good = await post({})
    check('...while the same payload with valid files is accepted', good.status === 201, why(good))
    await ClassAssignmentModel.deleteOne({ _id: good.body?.data?.id ?? good.body?.data?._id })
  }

  section('DUPLICATES — one open submission per class')
  {
    const again = await call('POST', '/class-assignments', {
      jar: attendeeJar,
      body: { liveClassId: String(sessionA._id), title: 'Same class again', files: [upload('b.png')] },
    })
    check('a second submission for the same class is refused', again.status === 409, why(again))
    check('...with ALREADY_SUBMITTED', code(again) === 'ALREADY_SUBMITTED', code(again))
    check('...and no second row was written',
      await ClassAssignmentModel.countDocuments({ studentId: attendee._id, liveClassId: sessionA._id }) === 1)
  }

  /* ══════════ 5. THE REVIEW QUEUE ══════════ */
  section('REVIEW QUEUE — an instructor sees their own sessions and nobody else\'s')
  {
    const a = await call('GET', '/class-assignments/review', { jar: teacherAJar })
    check('instructor A can read the queue', ok(a), why(a))
    const aIds = (a.body?.data ?? []).map((x: any) => String(x._id ?? x.id))
    check('...and sees the submission for their session', aIds.includes(assignmentId), aIds.join(','))
    check('...exactly one item, not the whole table', aIds.length === 1, `${aIds.length}`)

    const b = await call('GET', '/class-assignments/review', { jar: teacherBJar })
    check('instructor B sees none of it', ok(b) && (b.body?.data ?? []).length === 0, why(b))

    const su = await call('GET', '/class-assignments/review', { jar: superJar })
    check('a super admin sees it', ok(su) && (su.body?.data ?? []).some((x: any) => String(x._id ?? x.id) === assignmentId), why(su))

    const blrA = await call('GET', '/class-assignments/review', { jar: blrAdminJar })
    check('an admin of the OTHER academy sees none of it',
      ok(blrA) && (blrA.body?.data ?? []).length === 0, why(blrA))

    const student = await call('GET', '/class-assignments/review', { jar: attendeeJar })
    check('a student cannot read the review queue', student.status === 403 || student.status === 401, why(student))

    const filtered = await call('GET', '/class-assignments/review?status=approved', { jar: teacherAJar })
    check('the status filter narrows the queue',
      ok(filtered) && (filtered.body?.data ?? []).length === 0, why(filtered))
    const pending = await call('GET', '/class-assignments/review?status=pending', { jar: teacherAJar })
    check('...and still returns the pending one', ok(pending) && (pending.body?.data ?? []).length === 1, why(pending))
  }

  section('READING ONE — the owner and the reviewer, nobody else')
  {
    const mine = await call('GET', `/class-assignments/${assignmentId}`, { jar: attendeeJar })
    check('the student who sent it can read it', ok(mine), why(mine))
    const theirs = await call('GET', `/class-assignments/${assignmentId}`, { jar: teacherAJar })
    check('the instructor who must judge it can read it', ok(theirs), why(theirs))
    const su = await call('GET', `/class-assignments/${assignmentId}`, { jar: superJar })
    check('a super admin can read it', ok(su), why(su))

    const peer = await call('GET', `/class-assignments/${assignmentId}`, { jar: classmateJar })
    check('a classmate cannot read it', peer.status === 404, why(peer))
    check('...and is told "not found", which leaks nothing', code(peer) === 'NOT_FOUND', code(peer))
    const wrongTeacher = await call('GET', `/class-assignments/${assignmentId}`, { jar: teacherBJar })
    check('an instructor who did not run the class cannot read it', wrongTeacher.status === 404, why(wrongTeacher))
    const otherOrg = await call('GET', `/class-assignments/${assignmentId}`, { jar: blrAdminJar })
    check('an admin of the other academy cannot read it', otherOrg.status === 404, why(otherOrg))
    const anon = await call('GET', `/class-assignments/${assignmentId}`)
    check('an anonymous caller cannot read it', anon.status === 401, why(anon))

    const junk = await call('GET', '/class-assignments/not-an-id', { jar: attendeeJar })
    check('a malformed id answers 404, never 500', junk.status === 404, why(junk))
    const missing = await call('GET', `/class-assignments/${new mongoose.Types.ObjectId()}`, { jar: attendeeJar })
    check('an absent id answers 404', missing.status === 404, why(missing))

    const mineList = await call('GET', '/class-assignments/me', { jar: attendeeJar })
    check('the student\'s own list holds their submission',
      ok(mineList) && (mineList.body?.data ?? []).length === 1, why(mineList))
    const peerList = await call('GET', '/class-assignments/me', { jar: classmateJar })
    check('...and the classmate\'s list is empty — lists are per-student',
      ok(peerList) && (peerList.body?.data ?? []).length === 0, why(peerList))
  }

  /* ══════════ 6. REJECT ══════════ */
  section('REJECT — the reason is the whole point, so it must reach the student')
  {
    resetMail()
    await NotificationModel.deleteMany({})

    const noReason = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'rejected' },
    })
    check('a rejection without a reason is refused', noReason.status === 400, why(noReason))
    check('...with REASON_REQUIRED', code(noReason) === 'REASON_REQUIRED', code(noReason))
    const blank = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'rejected', reason: '   ' },
    })
    check('a whitespace-only reason is refused too', blank.status === 400, why(blank))

    const wrongTeacher = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherBJar, body: { decision: 'approved' },
    })
    check('an instructor who did not run the class cannot review it', wrongTeacher.status === 404, why(wrongTeacher))
    const selfReview = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: attendeeJar, body: { decision: 'approved' },
    })
    check('the student cannot approve their own work', selfReview.status === 403 || selfReview.status === 401, why(selfReview))
    const otherOrg = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: blrAdminJar, body: { decision: 'approved' },
    })
    check('the other academy\'s admin cannot review it', otherOrg.status === 404, why(otherOrg))
    check('...and after all those refusals it is still pending',
      (await ClassAssignmentModel.findById(assignmentId).lean() as any)?.status === 'pending')

    const REASON = 'Redo the position-size table — the risk column is missing.'
    const r = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'rejected', reason: REASON },
    })
    check('the instructor sends it back with a reason', ok(r), why(r))

    const row = await ClassAssignmentModel.findById(assignmentId).lean() as any
    check('...the row is rejected', row?.status === 'rejected', String(row?.status))
    check('...the reason is stored', row?.lastReason === REASON, String(row?.lastReason))
    check('...and the decision is kept in the history', (row?.reviews ?? []).length === 1)
    check('...against the attempt it judged', row?.reviews?.[0]?.attempt === 1, String(row?.reviews?.[0]?.attempt))
    check('...recording WHO judged it', String(row?.reviews?.[0]?.reviewerId) === String(teacherA._id))

    check('the student gets an in-app notification',
      await until(async () => (await notesFor(attendee._id, /sent back/i)).length > 0))
    const note = (await notesFor(attendee._id, /sent back/i))[0] as any
    check('...carrying the reason', String(note?.body).includes('risk column'), String(note?.body))

    check('the student gets an email',
      await until(async () => (await mailFor('attendee@t.local', /sent back/i)).length === 1))
    const mail = (await mailFor('attendee@t.local', /sent back/i))[0]
    check('...carrying the reason', !!mail && mail.body.includes('risk column'), mail?.subject)
    check('...and naming the class', !!mail && /Risk Management Live/.test(mail.body))

    check('the classmate hears nothing about it',
      (await notesFor(classmate._id, /sent back/i)).length === 0 &&
      (await mailFor('classmate@t.local', /sent back/i)).length === 0)

    const twice = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'approved' },
    })
    check('the same submission cannot be judged twice', twice.status === 409, why(twice))
    check('...with ALREADY_REVIEWED', code(twice) === 'ALREADY_REVIEWED', code(twice))
  }

  /* ══════════ 7. RESUBMIT ══════════ */
  section('RESUBMIT — a rejection is a round trip, not a dead end')
  {
    resetMail()
    await NotificationModel.deleteMany({})

    const notMine = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: classmateJar, body: { files: [upload('stolen.png')] },
    })
    check('a classmate cannot revise somebody else\'s submission', notMine.status === 404, why(notMine))
    const byTeacher = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: teacherAJar, body: { files: [upload('t.png')] },
    })
    check('the instructor cannot revise it on the student\'s behalf', byTeacher.status === 401 || byTeacher.status === 404, why(byTeacher))
    const empty = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: attendeeJar, body: { files: [] },
    })
    check('a revision with no files is refused', empty.status === 422, why(empty))

    const r = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: attendeeJar,
      body: { note: 'Added the risk column.', files: [upload('chart2.png'), upload('fixed.pdf', 'application/pdf')] },
    })
    check('the student sends a revision', ok(r), why(r))

    const row = await ClassAssignmentModel.findById(assignmentId).lean() as any
    check('...it is pending again', row?.status === 'pending', String(row?.status))
    check('...the attempt counter moved to 2', row?.attempt === 2, String(row?.attempt))
    check('...the new files replaced the old ones',
      (row?.files ?? []).some((f: any) => f.name === 'chart2.png') &&
      !(row?.files ?? []).some((f: any) => f.name === 'chart1.png'))
    check('...the earlier decision is STILL in the history — the instructor needs it',
      (row?.reviews ?? []).length === 1 && row.reviews[0].reason.includes('risk column'))
    check('...and the previous review timestamp is cleared', !row?.reviewedAt, String(row?.reviewedAt))

    check('the instructor is told it is a revision',
      await until(async () => (await notesFor(teacherA._id, /Revised assignment/i)).length > 0))
    const note = (await notesFor(teacherA._id, /Revised assignment/i))[0] as any
    check('...naming the attempt', /attempt 2/i.test(String(note?.body)), String(note?.body))
    check('the instructor gets the revision email',
      await until(async () => (await mailFor('teacher.a@t.local', /Revised assignment/i)).length === 1))

    const again = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: attendeeJar, body: { files: [upload('third.png')] },
    })
    check('a revision cannot be sent while one is already pending', again.status === 409, why(again))
    check('...with NOT_REJECTED', code(again) === 'NOT_REJECTED', code(again))
  }

  /* ══════════ 8. APPROVE ══════════ */
  section('APPROVE — the happy ending, and it closes the record')
  {
    resetMail()
    await NotificationModel.deleteMany({})

    const r = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'approved' },
    })
    check('the instructor approves the revision', ok(r), why(r))

    const row = await ClassAssignmentModel.findById(assignmentId).lean() as any
    check('...the row is approved', row?.status === 'approved', String(row?.status))
    check('...the rejection reason is cleared', !row?.lastReason, String(row?.lastReason))
    check('...both decisions are in the history', (row?.reviews ?? []).length === 2)
    check('...the second one against attempt 2', row?.reviews?.[1]?.attempt === 2, String(row?.reviews?.[1]?.attempt))
    check('...and it is stamped', !!row?.reviewedAt)

    check('the student is told',
      await until(async () => (await notesFor(attendee._id, /approved/i)).length > 0))
    check('the student gets the approval email',
      await until(async () => (await mailFor('attendee@t.local', /approved/i)).length === 1))

    const revise = await call('POST', `/class-assignments/${assignmentId}/resubmit`, {
      jar: attendeeJar, body: { files: [upload('more.png')] },
    })
    check('approved work cannot be revised', revise.status === 409, why(revise))
    const rejudge = await call('PATCH', `/class-assignments/${assignmentId}/review`, {
      jar: teacherAJar, body: { decision: 'rejected', reason: 'changed my mind' },
    })
    check('approved work cannot be re-judged', rejudge.status === 409, why(rejudge))
    check('...and it is still approved after both attempts',
      (await ClassAssignmentModel.findById(assignmentId).lean() as any)?.status === 'approved')
  }

  /* ══════════ 9. INJECTION ══════════ */
  section('INJECTION — student-controlled text reaches an instructor\'s inbox')
  {
    resetMail()
    const evil = '<img src=x onerror=alert(1)>'
    const r = await call('POST', '/class-assignments', {
      jar: classmateJar,
      body: { liveClassId: String(sessionA._id), title: `Work ${evil}`, files: [upload('x.png')] },
    })
    check('a title containing markup is accepted as text', r.status === 201, why(r))
    const id = String(r.body?.data?.id ?? r.body?.data?._id ?? '')

    check('the email goes out', await until(async () => (await mailFor('teacher.a@t.local', /New assignment/i)).length >= 1))
    const mail = (await mailFor('teacher.a@t.local', /New assignment/i)).slice(-1)[0]
    check('...with the markup ESCAPED, not live',
      !!mail && mail.body.includes('&lt;img') && !mail.body.includes('<img src=x'), mail?.subject)

    /* attendeeJar, not classmateJar — the classmate has no booking on session
       B, so that request 403s and the header assertion below never runs. A
       first draft of this block did exactly that and "passed". */
    resetMail()
    const crlf = await call('POST', '/class-assignments', {
      jar: attendeeJar,
      body: { liveClassId: String(sessionB._id), title: 'Header\r\nBcc: attacker@evil.test', files: [upload('y.png')] },
    })
    check('a title carrying a CRLF is accepted', crlf.status === 201, why(crlf))
    check('the email for it goes out',
      await until(async () => (await mailFor('teacher.b@t.local', /New assignment/i)).length >= 1))
    const m = (await mailFor('teacher.b@t.local', /New assignment/i)).slice(-1)[0]
    check('...and no injected header reached the subject line',
      !!m && !/\r|\n/.test(m.subject) && !/Bcc:/i.test(m.subject), JSON.stringify(m?.subject))
    await ClassAssignmentModel.deleteOne({ _id: crlf.body?.data?.id ?? crlf.body?.data?._id })

    /* An operator query cannot pose as an id (NoSQL injection). */
    const nosql = await call('POST', '/class-assignments', {
      jar: classmateJar,
      body: { liveClassId: { $ne: null }, title: 'Operator work', files: [upload('z.png')] },
    })
    check('an operator object in place of a class id is refused',
      nosql.status >= 400 && nosql.status < 500, why(nosql))

    await ClassAssignmentModel.deleteOne({ _id: id })
  }

  /* ══════════ 10. CONCURRENCY ══════════ */
  section('CONCURRENCY — two simultaneous submissions still leave one row')
  {
    await ClassAssignmentModel.deleteMany({ studentId: classmate._id })
    const body = { liveClassId: String(sessionA._id), title: 'Race condition work', files: [upload('r.png')] }
    const [x, y] = await Promise.all([
      call('POST', '/class-assignments', { jar: classmateJar, body }),
      call('POST', '/class-assignments', { jar: classmateJar, body }),
    ])
    const created = [x, y].filter(r => r.status === 201).length
    check('exactly one of the two requests created a submission', created === 1, `${created} created (${x.status}/${y.status})`)
    check('...and exactly one row exists',
      await ClassAssignmentModel.countDocuments({ studentId: classmate._id, liveClassId: sessionA._id }) === 1)
    await ClassAssignmentModel.deleteMany({ studentId: classmate._id })
  }

  /* ══════════ 11. ROUTE SHAPE ══════════ */
  section('ROUTE SHAPE — the literal paths are not swallowed by /:id')
  {
    const sub = await call('GET', '/class-assignments/submittable', { jar: attendeeJar })
    check('/submittable is its own route, not a lookup for the id "submittable"',
      ok(sub) && Array.isArray(sub.body?.data), why(sub))
    const me = await call('GET', '/class-assignments/me', { jar: attendeeJar })
    check('/me is its own route', ok(me) && Array.isArray(me.body?.data), why(me))
    const review = await call('GET', '/class-assignments/review', { jar: teacherAJar })
    check('/review is its own route', ok(review) && Array.isArray(review.body?.data), why(review))

    /* The existing lesson-level assignments feature must be untouched. A
       well-formed id is the only probe that distinguishes "the route is
       mounted and found nothing" from "the route is gone" — both answer 404
       NOT_FOUND for a malformed one, which is how the first version of this
       check passed without testing anything. */
    const legacy = await call('GET', `/assignments/lessons/${new mongoose.Types.ObjectId()}`, { jar: attendeeJar })
    check('the older /assignments feature still answers on its own prefix', ok(legacy), why(legacy))
    check('...and it is the handler replying, not the 404 fallback',
      !/^Route GET/.test(String(legacy.body?.error?.message ?? '')), String(legacy.body?.error?.message ?? ''))
  }

  /* ══════════ 12. THE OTHER PANEL'S COOKIE ══════════ */
  section('SESSIONS — the review screen lives in the admin panel, so it takes the admin cookie')
  {
    /* B-09 was an entire dead section caused by getting this backwards. */
    const withAdminCookie = await call('GET', '/class-assignments/review', { jar: teacherAJar })
    check('an instructor holding lms_admin_at can read the queue', ok(withAdminCookie), why(withAdminCookie))
    check('...and the admin cookie really is the one in that jar',
      [...teacherAJar.keys()].some(k => k.startsWith('lms_admin_')), [...teacherAJar.keys()].join(','))
    check('...while the student jar holds the client cookie',
      [...attendeeJar.keys()].includes('lms_at'), [...attendeeJar.keys()].join(','))
  }

  /* ══════════ 13. THE SERVICE ITSELF ══════════
     Everything above goes through validate(submitSchema), and a Zod object
     STRIPS keys it does not declare. That is a real defence, but it also
     means an HTTP request can never prove what the service does with a
     forged field — two deliberate mutations that made submit() trust
     `input.instructorId` and `input.status` passed all 138 checks above
     without a murmur. These call the service directly, past the validator,
     which is the only way to pin the rule where it is actually written. */
  section('THE SERVICE ITSELF — called past the validator, the session still wins')
  {
    const { ClassAssignmentService } = await import('@/services/classAssignment.service.ts')
    const svc = new ClassAssignmentService()

    const probe = await mk('probe@t.local', 'student', dubai, { enrollmentStatus: 'approved' })
    await EnrollmentModel.create({ userId: probe._id, courseId: course._id })
    const probeClass = await mkClass('Service Level Probe', teacherA, 5)
    await ClassBookingModel.create({ userId: probe._id, liveClassId: probeClass._id, status: 'booked' })
    const probeCaller = { id: String(probe._id), role: 'student', organizationId: String(dubai._id) }

    const created = await svc.submit(probeCaller, {
      liveClassId:    String(probeClass._id),
      title:          'Service level work',
      files:          [upload('svc.png')],
      /* All forged, all reaching the service this time. */
      instructorId:   String(teacherB._id),
      organizationId: String(blr._id),
      courseId:       String(new mongoose.Types.ObjectId()),
      sectionId:      String(new mongoose.Types.ObjectId()),
      status:         'approved',
      attempt:        99,
      studentId:      String(superAdmin._id),
    } as never)

    const row = await ClassAssignmentModel.findById(created._id).lean() as any
    check('the instructor is the session\'s, not the caller\'s claim',
      String(row?.instructorId) === String(teacherA._id), String(row?.instructorId))
    check('the course is the session\'s',   String(row?.courseId) === String(course._id),   String(row?.courseId))
    check('the module is the session\'s',   String(row?.sectionId) === String(module1._id), String(row?.sectionId))
    check('the academy is the session\'s',  String(row?.organizationId) === String(dubai._id), String(row?.organizationId))
    check('the student is the caller, not a claimed id',
      String(row?.studentId) === String(probe._id), String(row?.studentId))
    check('it opens as pending whatever the caller asked for', row?.status === 'pending', String(row?.status))
    check('attempt is 1 whatever the caller asked for', row?.attempt === 1, String(row?.attempt))

    /* And the entitlement gate, at the same level. */
    let thrown = ''
    try {
      await svc.submit(probeCaller, {
        liveClassId: String(sessionC._id), title: 'Never booked this', files: [upload('n.png')],
      } as never)
    } catch (e) { thrown = String((e as { code?: string }).code ?? (e as Error).message) }
    check('the service refuses a session the caller never booked', thrown === 'NOT_BOOKED', thrown)

    /* A reviewer from the wrong academy, at the same level. */
    let reviewThrew = ''
    try {
      await svc.review({ id: String(otherOrgAdmin._id), role: 'admin', organizationId: String(blr._id) },
        String(created._id), 'approved')
    } catch (e) { reviewThrew = String((e as { code?: string }).code ?? (e as Error).message) }
    check('the service refuses a reviewer from the other academy', reviewThrew === 'NOT_FOUND', reviewThrew)
    check('...and the submission is untouched',
      (await ClassAssignmentModel.findById(created._id).lean() as any)?.status === 'pending')
  }

} finally {
  /* The maildir belongs to this process alone now, so take the whole thing.
     The old sweep filtered by timestamp inside the SHARED directory, which
     meant a concurrent run's mail was deleted along with this one's. */
  let removed = 0
  try {
    removed = (await nodeFs.readdir(MAILDIR)).length
    /* Recursive, not rmdir: the app sends mail fire-and-forget, so a message
       can still land between counting the directory and removing it, and
       rmdir refuses a directory that is not empty. That is exactly how an
       empty emails-<pid> folder was left behind on the first run of this. */
    await nodeFs.rm(MAILDIR, { recursive: true, force: true })
  } catch {}
  lines.push(`\n(cleanup: removed ${removed} captured email file(s))`)
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\n──── EVERY FAILURE ────')
  failures.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f}`))
}
process.exit(failures.length === 0 ? 0 : 1)
