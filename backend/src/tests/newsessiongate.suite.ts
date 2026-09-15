/* ─────────────────────────────────────────────────────────────
   A new session is added. Who gets an email about it?

   Phase 1 of the Class-Update Notification spec. Creating a live class used
   to loop the WHOLE course roster and mail every one of them — which is the
   behaviour the spec was written to stop: "students have reported receiving
   multiple emails a day ... for new sessions being entered for modules they
   haven't reached yet".

   The rule now: notify by email only the students whose OWN progress has
   brought them to this module — "last completed module is the one immediately
   prior". Everybody else still gets the in-app notification, because the spec
   is explicit that the notification centre stays the source of truth and email
   is a conditional layer on top of it.

   PHASE 2 CHANGED WHAT "EMAILED" MEANS HERE. A new session is Standard tier,
   so passing the gate now puts a row in the student's DIGEST QUEUE instead of
   sending a mail on the spot; the mail goes out once a day carrying every row.
   This suite therefore counts queued rows, not outbox rows.

   That distinction matters for the negative cases especially. While these were
   still counting the outbox, B/C/E/F/G passed for a reason that had nothing to
   do with the gate — NOBODY is mailed immediately any more, so "is not emailed"
   was true no matter what the gate decided. Counting the queue puts the gate
   back under test. A1/D1/H1 are what caught it: they went red the moment the
   send became a queue, which is the whole reason the positive cases exist.

   What this suite pins:
     A  a student sitting exactly at the prior module IS notified
     B  a student further back is NOT — but still sees it in-app
     C  a student further ahead is NOT either
     D  a brand-new student with NO completions counts as being at module 1
     E  a partially-finished module does not count as completed
     F  an empty module cannot be "the prior module"
     G  a session with no module notifies nobody, and still logs in-app
     H  module ORDER is read by position, not by the raw order number
     I  nothing here sends an immediate email at all — Standard tier is queued

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_newsessiongate_suite), dropped on exit.

   Run: bun run test:newsessiongate
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_newsessiongate_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LessonModel,
  EnrollmentModel, LessonProgressModel, EmailOutboxModel, NotificationModel,
  DigestQueueModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_newsessiongate_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const svc = new LiveClassService()
const PW  = 'Gate1234'

/* The queue row is written asynchronously, so a count read too early says 0
   for a student who IS about to be notified.

   Calling this twice in one assertion — once for the condition and again for
   the failure detail — was its own bug: the two reads straddled the write and
   disagreed, so a passing case reported "expected 1, got 1". Read ONCE into a
   variable and assert on that.

   `want` is what the caller expects: polling stops as soon as it is reached,
   so the positive case waits for the write and the negative case still returns
   promptly after its short grace period. */
async function queued(userId: unknown, want = 1, tries = 40): Promise<number> {
  let last = 0
  for (let i = 0; i < tries; i++) {
    last = await DigestQueueModel.countDocuments({ userId, kind: 'new-session' })
    if (last >= want) return last
    await new Promise(r => setTimeout(r, 100))
  }
  return last
}
/** For "this student should not hear about it": a short settle, then one read. */
async function notQueued(userId: unknown): Promise<number> {
  await new Promise(r => setTimeout(r, 900))
  return DigestQueueModel.countDocuments({ userId, kind: 'new-session' })
}
const notifCount = (userId: unknown) => NotificationModel.countDocuments({ userId })

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@gate.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})

let seq = 0
/** A course with `moduleCount` modules, each holding `lessonsPer` lessons. */
async function makeCourse(moduleCount: number, lessonsPer: number, orders?: number[]) {
  const n = seq++
  const course = await CourseModel.create({
    title: `Course ${n}`, slug: `course-gate-${n}`, description: 'd',
    instructorId: teacher._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: org._id,
  })
  const modules: any[] = []
  for (let i = 0; i < moduleCount; i++) {
    const sec = await SectionModel.create({
      courseId: course._id, title: `Module ${i + 1}`, order: orders?.[i] ?? (i + 1),
    })
    const lessons: any[] = []
    for (let j = 0; j < lessonsPer; j++) {
      lessons.push(await LessonModel.create({
        courseId: course._id, sectionId: sec._id,
        title: `M${i + 1} L${j + 1}`, type: 'article', order: j + 1,
      }))
    }
    modules.push({ sec, lessons })
  }
  return { course, modules }
}

/** An enrolled student who has completed the given lessons. */
async function enrol(course: any, label: string, completed: any[] = []) {
  const student = await UserModel.create({
    name: label, email: `${label}-${seq++}@gate.local`, passwordHash: hash,
    role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id,
  })
  await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active' })
  for (const l of completed) {
    await LessonProgressModel.create({
      userId: student._id, courseId: course._id, lessonId: l._id, completedAt: new Date(),
    })
  }
  return student
}

/** Create a session on a module and let the notification fan-out settle. */
async function addSession(course: any, sectionId: unknown | null) {
  const live = await svc.create({
    title: `Session ${seq++}`, courseId: String(course._id),
    ...(sectionId ? { sectionId: String(sectionId) } : {}),
    instructorId: String(teacher._id),
    scheduledStart: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    durationMins: 60, type: 'external', isOnline: true,
    meetingUrl: 'https://meet.google.com/gat-eabc-123',
    language: 'English', sessionCapacity: 30,
    organizationId: String(org._id),
  } as any)
  await new Promise(r => setTimeout(r, 1500))
  return live
}

/* ═════════════════ A–C — the three positions ═════════════════ */
section('A–C. Only the students standing at this module are emailed')
{
  const { course, modules } = await makeCourse(3, 2)

  /* Finished module 1 → standing at module 2. */
  const atM2 = await enrol(course, 'at-module-2', modules[0].lessons)
  /* Finished nothing beyond module 1's first lesson → still inside module 1. */
  const behind = await enrol(course, 'behind', [modules[0].lessons[0]])
  /* Finished modules 1 AND 2 → already past module 2. */
  const ahead = await enrol(course, 'ahead', [...modules[0].lessons, ...modules[1].lessons])

  await addSession(course, modules[1].sec._id)   // a session on module 2

  const nAt = await queued(atM2._id)
  check('A1 the student at the prior module IS notified', nAt === 1, String(nAt))
  const nBehind = await notQueued(behind._id)
  check('B1 the student still inside module 1 is NOT notified', nBehind === 0, String(nBehind))
  const nAhead = await notQueued(ahead._id)
  check('C1 the student already past module 2 is NOT notified', nAhead === 0, String(nAhead))

  /* The half that must NOT change: everyone keeps the in-app record. */
  check('B2 the un-emailed student still sees it in-app',
    (await notifCount(behind._id)) === 1, String(await notifCount(behind._id)))
  check('C2 and so does the one who is ahead',
    (await notifCount(ahead._id)) === 1, String(await notifCount(ahead._id)))
}

/* ═════════════════ D — the brand-new student ═════════════════ */
section('D. A student with no completions counts as being at module 1')
{
  /* Deliberate reading of the spec. Someone who has completed nothing sits
     immediately BEFORE the first module, so a session in it is exactly what
     they want to hear about. Treating "no completions" as "no match" would
     silence the one announcement a new joiner most needs. */
  const { course, modules } = await makeCourse(3, 2)
  const fresh = await enrol(course, 'fresh')
  const midway = await enrol(course, 'midway', modules[0].lessons)

  await addSession(course, modules[0].sec._id)   // a session on module 1

  const nFresh = await queued(fresh._id)
  check('D1 the brand-new student IS notified about module 1', nFresh === 1, String(nFresh))
  const nMid = await notQueued(midway._id)
  check('D2 the student who already finished module 1 is NOT', nMid === 0, String(nMid))
}

/* ═════════════════ E — half a module is not a module ═════════════════ */
section('E. A partially finished module does not count as completed')
{
  const { course, modules } = await makeCourse(3, 3)
  /* Two of module 1's three lessons. Not finished, so they are not yet at
     module 2 — a looser "any progress in the prior module" rule would mail
     them, which is exactly the over-mailing this replaces. */
  const partial = await enrol(course, 'partial', modules[0].lessons.slice(0, 2))

  await addSession(course, modules[1].sec._id)

  const nPartial = await notQueued(partial._id)
  check('E1 a partly-done prior module does not trigger the notification', nPartial === 0, String(nPartial))
  check('E2 but it is still logged in-app', (await notifCount(partial._id)) === 1,
    String(await notifCount(partial._id)))
}

/* ═════════════════ F — empty modules ═════════════════ */
section('F. An empty module can never be "the prior module"')
{
  /* A module with no lessons is vacuously "all lessons complete" under a
     careless every() — which would mail the entire roster the moment an
     admin created an empty module. */
  const { course } = await makeCourse(0, 0)
  const empty = await SectionModel.create({ courseId: course._id, title: 'Empty', order: 1 })
  const real  = await SectionModel.create({ courseId: course._id, title: 'Real',  order: 2 })
  await LessonModel.create({ courseId: course._id, sectionId: real._id, title: 'L', type: 'article', order: 1 })

  const nobody = await enrol(course, 'nobody')
  await addSession(course, real._id)   // session on module 2, module 1 is empty

  const nEmpty = await notQueued(nobody._id)
  check('F1 an empty prior module does not notify the roster', nEmpty === 0, String(nEmpty))
}

/* ═════════════════ G — a session with no module ═════════════════ */
section('G. A session with no module emails nobody but still logs in-app')
{
  /* Relevance cannot be established, and "cannot tell" is not a reason to
     mail everyone — that is the old behaviour by another name. */
  const { course } = await makeCourse(2, 1)
  const anyone = await enrol(course, 'anyone')

  await addSession(course, null)

  const nNoModule = await notQueued(anyone._id)
  check('G1 nobody is notified by mail', nNoModule === 0, String(nNoModule))
  check('G2 the notification is still created', (await notifCount(anyone._id)) === 1,
    String(await notifCount(anyone._id)))
}

/* ═════════════════ H — non-contiguous module numbering ═════════════════ */
section('H. Module position is read by order, not by the order NUMBER')
{
  /* Authors number modules 10/20/30. Comparing raw order values would look
     for "order + 1" and never find it, so nobody would ever be emailed. */
  const { course, modules } = await makeCourse(3, 1, [10, 20, 30])
  const atSecond = await enrol(course, 'gap-at-2', modules[0].lessons)

  await addSession(course, modules[1].sec._id)

  const nGap = await queued(atSecond._id)
  check('H1 a 10/20/30 course still matches the student at module 2', nGap === 1, String(nGap))
}

/* ═════════════════ I — Standard tier never interrupts ═════════════════ */
section('I. Not one of those sessions sent an immediate email')
{
  /* Every case above has now run. Between them they created eight sessions
     across seven students and passed the gate three times — and the outbox
     must still be empty, because a new session is Standard tier and waits for
     the daily digest.

     This is the assertion that would catch a revert to the old send. Counting
     queue rows alone cannot: if someone restored the immediate send ALONGSIDE
     the queue, A1/D1/H1 would still be green and students would be back to a
     mail per session. */
  const outbox = await EmailOutboxModel.countDocuments({})
  check('I1 the outbox is empty — every new session went to the digest',
    outbox === 0, `${outbox} immediate email(s)`)
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\nnewsessiongate.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
