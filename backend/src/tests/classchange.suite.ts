/* ─────────────────────────────────────────────────────────────
   FEATURE — students who booked a class are told when it changes.

   Three edits matter to somebody holding a booking:
     • the instructor changed   ← new; produced nothing at all before
     • the time changed         ← emailed before, but never appeared in-app
     • the session was cancelled

   Both channels now fire for all three: the in-app bell AND an email.

   What this suite is careful about, because the feature is fire-and-forget
   and therefore very easy to "pass" while doing nothing:

     • It asserts on the OUTCOME — a Notification row exists, a message really
       reached the mail transport — never merely that the request returned 200.
       The request returns 200 whether or not anybody was told.
     • It checks WHO receives. A student who cancelled their booking must not
       be told, nor a student booked on a DIFFERENT session. Notifying everyone
       would sail through a naive "somebody got a message" assertion.
     • It checks the NEGATIVE: an unrelated edit (the title) must notify
       nobody, and re-saving identical values must notify nobody. A helper that
       fired on every save would look perfect in every positive test.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_classchange_suite), dropped on exit. Mail is captured through the
   service's own console transport — which writes each message to
   .logs/emails/ — so the real send path runs and nothing leaves the machine.

   Run: bun run test:classchange
───────────────────────────────────────────────────────────── */
const nodePathBoot = await import('path')
/* This suite reads the maildir back and asserts on what is in it, so it needs
   a directory of its own. The shared .logs/emails is written by every suite
   and by the dev server, and mailbox() can only filter by timestamp -- so a
   second writer's mail lands inside this run's window, and the teardown below
   would delete it. Per-process directory, named after the pid. */
process.env.EMAIL_LOG_DIR = nodePathBoot.join(
  process.cwd(), '.logs', 'emails-classchange-' + String(process.pid))
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_classchange_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

/* Phase 4 OFF for this suite, deliberately.

   Critical mail is normally parked for a 10-minute buffer and capped per
   student per day. This suite predates both and is about the CONTENT of each
   critical notice — who receives it, what it says, who is excluded — one
   event at a time. With the buffer on, every assertion here would be testing
   the flush; with the cap on, the later sections would start folding into the
   digest simply because this one student triggers six changes in a row.

   The buffer and the cap have their own suite: criticalmail.suite.ts. */
process.env.CRITICAL_DEBOUNCE_MINS = '0'
process.env.CRITICAL_MAIL_CAP      = '0'
/* Force the console transport, which writes each message to .logs/emails/
   instead of sending it.

   Set to '' rather than deleted. dotenv does not overwrite a variable that is
   already present, but it DOES fill in one that is absent — so deleting these
   handed them straight back from .env, the real SMTP sender was selected, and
   the suite quietly attempted to post mail to gmail for every @t.local
   address. Empty strings are falsy to buildSender()'s check and survive
   dotenv. Same trap as the R2 credentials in the other suites. */
process.env.SMTP_HOST  = ''
process.env.SMTP_USER  = ''
process.env.SMTP_PASS  = ''
process.env.EMAIL_FROM = ''
/* No Google credentials → no Meet call leaves the machine. */
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN

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
/* Everything this run writes, for a complete teardown. */
const SUITE_START = Date.now() - 1
let mailMark = SUITE_START

interface Mail { to: string; subject: string; body: string }

/** Every message written since the last resetMail(). */
async function mailbox(): Promise<Mail[]> {
  let names: string[] = []
  try { names = await nodeFs.readdir(MAILDIR) } catch { return [] }
  const out: Mail[] = []
  for (const n of names) {
    if (!n.endsWith('.html')) continue
    const ts = Number(n.split('-')[0])
    if (!Number.isFinite(ts) || ts < mailMark) continue
    const full = nodePath.join(MAILDIR, n)
    const raw  = await nodeFs.readFile(full, 'utf8')
    const head = raw.slice(0, raw.indexOf('\n') + 1)
    const to      = (head.match(/to:\s*([^|]+)\|/)?.[1] ?? '').trim()
    const subject = (head.match(/subject:\s*(.*?)\s*-->/)?.[1] ?? '').trim()
    out.push({ to, subject, body: raw })
  }
  return out
}
const resetMail = () => { mailMark = Date.now() - 1 }

/* Renders the mailbox for a failure message. A silence assertion that reports
   only a COUNT tells you an email escaped but not which one, and the two are
   very different bugs: a stray notification for this edit, or a late-landing
   one from the previous section crossing the watermark. */
const describeMail = async (): Promise<string> => {
  const box = await mailbox()
  if (!box.length) return 'none'
  return `${box.length}: ` + box.map(m => `${m.to}/${m.subject}`).join(', ')
}

const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel,
  ClassBookingModel, NotificationModel, EnrollmentModel, DigestQueueModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_classchange_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

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

const ok  = (r: { status: number }) => r.status >= 200 && r.status < 300
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 60)}`
const PW  = 'CorrectHorse1'

/** Poll until the fire-and-forget work lands, bounded. */
async function until(want: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    if (await want()) return true
    if (Date.now() - t0 > ms) return false
    await new Promise(r => setTimeout(r, 120))
  }
}

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, role: string, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, organizationId: org._id, ...extra })

  await mk('admin@t.local', 'admin')
  const teacherA  = await mk('teacher.a@t.local', 'instructor')
  const teacherB  = await mk('teacher.b@t.local', 'instructor')
  const booked    = await mk('booked@t.local',    'student', { enrollmentStatus: 'approved' })
  const cancelled = await mk('cancelled@t.local', 'student', { enrollmentStatus: 'approved' })
  const elsewhere = await mk('elsewhere@t.local', 'student', { enrollmentStatus: 'approved' })

  const course = await CourseModel.create({
    title: 'Change Feature Course', slug: `chg-${Date.now()}`,
    description: 'Seeded for the class-change notification suite.',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: teacherA._id, organizationId: org._id,
  })
  for (const u of [booked, cancelled, elsewhere]) {
    await EnrollmentModel.create({ userId: u._id, courseId: course._id })
  }

  const mkClass = (title: string, startsInMs: number) => LiveClassModel.create({
    courseId: course._id, title, scheduledStart: new Date(Date.now() + startsInMs),
    durationMins: 60, type: 'external', instructorId: teacherA._id, organizationId: org._id,
    language: 'English', status: 'scheduled', isOnline: false, location: 'Campus', room: 'A1',
    sessionCapacity: 30,
  })
  const session = await mkClass('Trading Masterclass', 3 * 86_400_000)
  const other   = await mkClass('Unrelated Session',   4 * 86_400_000)

  /* booked → attending · cancelled → withdrew · elsewhere → another session */
  await ClassBookingModel.create({ userId: booked._id,    liveClassId: session._id, status: 'booked' })
  await ClassBookingModel.create({ userId: cancelled._id, liveClassId: session._id, status: 'cancelled' })
  await ClassBookingModel.create({ userId: elsewhere._id, liveClassId: other._id,   status: 'booked' })

  const adminJar: Jar = new Map()
  const li = await call('POST', '/admin/auth/login', { jar: adminJar, body: { email: 'admin@t.local', password: PW } })
  check('admin signs in', ok(li), why(li))

  const notesFor = async (userId: unknown, match: RegExp) =>
    (await NotificationModel.find({ userId }).lean())
      .filter(n => match.test(String((n as any).title)))
  const mailFor = async (to: string, match: RegExp) =>
    (await mailbox()).filter(m => m.to === to && match.test(m.subject))

  /* ══════════ 1. INSTRUCTOR CHANGE — the new behaviour ══════════ */
  section('INSTRUCTOR CHANGE — booked students are told, in-app and by email')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar, body: { instructorId: String(teacherB._id) },
    })
    check('the admin can reassign the instructor', ok(r), why(r))

    check('the booked student gets an in-app notification',
      await until(async () => (await notesFor(booked._id, /Instructor changed/i)).length > 0))

    const note = (await notesFor(booked._id, /Instructor changed/i))[0] as any
    check('...naming the session', !!note && /Trading Masterclass/.test(String(note.title)), String(note?.title))
    check('...and naming both instructors',
      !!note && /teacher\.a/.test(String(note.body)) && /teacher\.b/.test(String(note.body)), String(note?.body))

    check('the booked student gets an email',
      await until(async () => (await mailFor('booked@t.local', /Instructor Update/i)).length === 1))
    const mail = (await mailFor('booked@t.local', /Instructor Update/i))[0]
    check('...the email names the old and new instructor',
      !!mail && /teacher\.a/.test(mail.body) && /teacher\.b/.test(mail.body),
      mail?.subject)

    /* Who must NOT hear about it. */
    check('a student who CANCELLED their booking is not notified',
      (await notesFor(cancelled._id, /Instructor changed/i)).length === 0)
    check('...and gets no email', (await mailFor('cancelled@t.local', /Instructor Update/i)).length === 0)
    check('a student booked on a DIFFERENT session is not notified',
      (await notesFor(elsewhere._id, /Instructor changed/i)).length === 0)
    check('...and gets no email', (await mailFor('elsewhere@t.local', /Instructor Update/i)).length === 0)
  }

  /* ══════════ 2. TIME CHANGE ══════════ */
  section('TIME CHANGE — booked students are told, in-app and by email')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar, body: { scheduledStart: new Date(Date.now() + 9 * 86_400_000).toISOString() },
    })
    check('the admin can move the session', ok(r), why(r))

    check('the booked student gets an in-app notification',
      await until(async () => (await notesFor(booked._id, /rescheduled/i)).length > 0))
    check('the booked student gets an email',
      await until(async () => (await mailFor('booked@t.local', /Rescheduled|Delay/i)).length === 1))
    check('the cancelled-booking student is told nothing',
      (await notesFor(cancelled._id, /rescheduled/i)).length === 0 &&
      (await mailFor('cancelled@t.local', /Rescheduled|Delay/i)).length === 0)
  }

  /* ══════════ 3. BOTH AT ONCE ══════════ */
  section('BOTH AT ONCE — a reschedule and a reassignment are separate facts')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar,
      body: {
        instructorId:   String(teacherA._id),
        scheduledStart: new Date(Date.now() + 12 * 86_400_000).toISOString(),
      },
    })
    check('the edit succeeds', ok(r), why(r))
    await until(async () => (await notesFor(booked._id, /rescheduled|Instructor changed/i)).length >= 2)
    const notes = await notesFor(booked._id, /rescheduled|Instructor changed/i)
    check('the student is told BOTH things', notes.length === 2, `${notes.length} notification(s)`)
    /* Wait for the MAIL, not just the notifications — the two no longer
       arrive together. The bell is written from the request; the email is
       parked and sent afterwards, so a mailbox read that only waited on the
       notifications catches the gap between them. Sections 1 and 2 already
       wrapped their mail assertions this way; this one did not, and it is
       the only reason it failed. */
    check('...and receives both emails',
      await until(async () =>
        (await mailFor('booked@t.local', /Rescheduled|Delay/i)).length === 1 &&
        (await mailFor('booked@t.local', /Instructor Update/i)).length === 1),
      `${(await mailbox()).length} total`)
  }

  /* ══════════ 4. NEGATIVE — an unrelated edit tells nobody ══════════ */
  section('UNRELATED EDIT — no EMAIL  ← the check that keeps this honest')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    await DigestQueueModel.deleteMany({})
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar, body: { title: 'Trading Masterclass (Updated Notes)' },
    })
    check('a title-only edit succeeds', ok(r), why(r))
    /* Give it every chance to misfire before declaring silence. */
    await new Promise(r2 => setTimeout(r2, 1500))
    check('no email is sent for an unrelated edit', (await mailbox()).length === 0,
      await describeMail())

    /* This used to assert ZERO notifications, and that assertion was a record
       of the gap rather than of an intention: a title change reached the
       student in no channel at all. §6 of the Class-Update Notification spec
       makes the notification centre the source of truth for EVERY update, so
       a minor edit is now logged in-app and joins tonight's digest. What has
       to stay true here — and does — is that it sends no mail of its own.
       The tiering itself is covered in detail by sessionedits.suite. */
    check('but it IS logged in the notification centre',
      (await NotificationModel.countDocuments({})) === 1,
      `${await NotificationModel.countDocuments({})} created`)
    check('...and queued for the daily digest rather than mailed now',
      (await DigestQueueModel.countDocuments({})) === 1,
      `${await DigestQueueModel.countDocuments({})} queued`)
  }

  /* ══════════ 5. RE-SUBMITTING THE SAME VALUES ══════════ */
  section('NO-OP EDIT — re-saving identical values must not notify')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const current: any = await LiveClassModel.findById(session._id).lean()
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar,
      body: {
        instructorId:   String(current.instructorId),
        scheduledStart: new Date(current.scheduledStart).toISOString(),
      },
    })
    check('re-saving the same values succeeds', ok(r), why(r))
    await new Promise(r2 => setTimeout(r2, 1500))
    check('...and notifies nobody',
      (await mailbox()).length === 0 && (await NotificationModel.countDocuments({})) === 0,
      `mail=[${await describeMail()}] notifications=${await NotificationModel.countDocuments({})}`)
  }

  /* ══════════ 6. CANCELLATION ══════════ */
  section('CANCELLATION — takes precedence over everything else')
  {
    resetMail()
    await NotificationModel.deleteMany({})
    const r = await call('PATCH', `/admin/live-classes/${session._id}`, {
      jar: adminJar, body: { status: 'cancelled', instructorId: String(teacherB._id) },
    })
    check('the admin can cancel the session', ok(r), why(r))
    await until(async () => (await notesFor(booked._id, /cancelled/i)).length > 0)
    check('the booked student is told it is cancelled',
      (await notesFor(booked._id, /cancelled/i)).length === 1)
    check('...and is NOT also told the instructor changed — that is noise now',
      (await notesFor(booked._id, /Instructor changed/i)).length === 0)
    check('...and gets exactly one email',
      (await mailFor('booked@t.local', /Cancel/i)).length === 1,
      `${(await mailbox()).length} total`)
  }

  /* ══════════ 7. ROBUSTNESS ══════════ */
  section('ROBUSTNESS — a booking whose student was deleted must not stop the rest')
  {
    const { notifyBookedStudents } = await import('@/controllers/liveClass.controller.ts')
    resetMail()
    await NotificationModel.deleteMany({})

    const s2 = await mkClass('Resilience Session', 5 * 86_400_000)
    /* A dangling booking: the account was removed but the booking row remains.
       The loop resolves recipients from the USER collection, so this one simply
       is not there — it must be skipped silently rather than throwing and
       taking the other student's notification down with it. */
    const doomed = await mk(`doomed-${Date.now()}@t.local`, 'student', { enrollmentStatus: 'approved' })
    await ClassBookingModel.create({ userId: booked._id,  liveClassId: s2._id, status: 'booked' })
    await ClassBookingModel.create({ userId: doomed._id,  liveClassId: s2._id, status: 'booked' })
    await UserModel.findByIdAndDelete(doomed._id)

    const result = await notifyBookedStudents({
      liveClassId: String(s2._id), title: 'Resilience Session',
      oldStart: s2.scheduledStart, newStart: s2.scheduledStart,
      wasCancelled: false, wasRescheduled: false, instructorChanged: true,
      oldInstructorId: String(teacherA._id), newInstructorId: String(teacherB._id),
    })

    check('only the surviving student is a recipient', result.recipients === 1, JSON.stringify(result))
    check('...and they are notified in-app', result.notified === 1, JSON.stringify(result))
    check('...and emailed', result.emailed === 1, JSON.stringify(result))
  }

  section('ROBUSTNESS — a session nobody booked is a no-op, not a crash')
  {
    const { notifyBookedStudents } = await import('@/controllers/liveClass.controller.ts')
    const empty = await mkClass('Nobody Booked', 6 * 86_400_000)
    const result = await notifyBookedStudents({
      liveClassId: String(empty._id), title: 'Nobody Booked',
      wasCancelled: false, wasRescheduled: false, instructorChanged: true,
      oldInstructorId: String(teacherA._id), newInstructorId: String(teacherB._id),
    })
    check('no recipients, no error', result.recipients === 0 && result.emailed === 0, JSON.stringify(result))
  }

} finally {
  /* Remove every mail fixture this run wrote — not merely the ones a check
     happened to read. Tracking only what mailbox() returned left behind any
     message written after a section's last read, which is how ten stray
     booked@t.local captures accumulated across four runs. */
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
