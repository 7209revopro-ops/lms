/* ─────────────────────────────────────────────────────────────
   The progress gate, checked against every position rather than a few.

   newsessiongate.suite.ts asserts the positions somebody thought to write
   down: at the prior module, one behind, one ahead, brand new, half-done.
   That is the same weakness that let eight unrequired fields hide in the
   registration schema earlier — the cases you choose reflect what you already
   believe, and the bug lives in the case you did not think of.

   So this one does not choose. For a course of N modules it enrols ONE
   student standing at each possible position (completed 0 modules, 1, 2 …
   N), adds a session to each module in turn, and checks the set QUEUED FOR
   THE DIGEST is exactly the one student whose position matches — no more, no
   fewer. Then it runs the digest and checks the mail that leaves matches.

   The property, stated once:

     a session on module index i is queued for exactly the students whose
     last-completed-module index is i-1, and nobody else; the digest then
     mails each of them ONCE

   (It used to say "emails". Phase 2 of the notification spec made a new
   session a Standard-tier event — parked per student and sent once a day as
   one message — and this suite was not updated with it, which nobody noticed
   because no full chain run reached this file for a while. The check is now
   in two halves so both the parking and the sending are proven.)

   It also re-checks the invariant that must survive all of it: EVERY
   enrolled student gets the in-app notification regardless, because email is
   a layer on top of the notification centre and never a replacement for it.

   Run: bun run test:newsessiongate-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_newsessiongateprop_suite'
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
  EnrollmentModel, LessonProgressModel, EmailOutboxModel, NotificationModel, DigestQueueModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')
const { runDailyDigest } = await import('@/jobs/digest.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_newsessiongateprop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const svc  = new LiveClassService()
const PW   = 'Prop1234'
const MEET = 'https://meet.google.com/pro-pabc-123'

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)
const teacher = await UserModel.create({
  name: 'Teach', email: 'teach@prop.local', passwordHash: hash, role: 'instructor',
  isActive: true, organizationId: org._id,
})

let seq = 0

/* A course of N modules, and N+1 students — one standing at every possible
   position, including "has completed nothing" and "has completed the lot". */
async function buildCourse(moduleCount: number, lessonsPer: number, orders?: number[]) {
  const n = seq++
  const course = await CourseModel.create({
    title: `Prop ${n}`, slug: `prop-${n}`, description: 'd',
    instructorId: teacher._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: org._id,
  })

  const modules: { sec: any; lessons: any[] }[] = []
  for (let i = 0; i < moduleCount; i++) {
    const sec = await SectionModel.create({
      courseId: course._id, title: `M${i + 1}`, order: orders?.[i] ?? (i + 1),
    })
    const lessons: any[] = []
    for (let j = 0; j < lessonsPer; j++) {
      lessons.push(await LessonModel.create({
        courseId: course._id, sectionId: sec._id,
        title: `M${i + 1}L${j + 1}`, type: 'article', order: j + 1,
      }))
    }
    modules.push({ sec, lessons })
  }

  /* students[k] has completed exactly the first k modules. */
  const students: any[] = []
  for (let k = 0; k <= moduleCount; k++) {
    const u = await UserModel.create({
      name: `done-${k}`, email: `c${n}-done${k}@prop.local`, passwordHash: hash,
      role: 'student', isActive: true, isVerified: true,
      enrollmentStatus: 'approved', organizationId: org._id,
    })
    await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active' })
    for (let i = 0; i < k; i++) {
      for (const l of modules[i]!.lessons) {
        await LessonProgressModel.create({
          userId: u._id, courseId: course._id, lessonId: l._id, completedAt: new Date(),
        })
      }
    }
    students.push(u)
  }

  return { course, modules, students }
}

async function addSession(course: any, sectionId: unknown) {
  await svc.create({
    title: `S${seq++}`, courseId: String(course._id), sectionId: String(sectionId),
    instructorId: String(teacher._id),
    scheduledStart: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    durationMins: 60, type: 'external', isOnline: true, meetingUrl: MEET,
    language: 'English', sessionCapacity: 30, organizationId: String(org._id),
  } as any)
  /* The fan-out is awaited inside create(); a short settle keeps the count
     honest if that ever changes. */
  await new Promise(r => setTimeout(r, 400))
}

/* ═════════════════ the property, over several course shapes ═════════════════ */
for (const [moduleCount, lessonsPer, orders, label] of [
  [3, 1, undefined,      '3 modules x 1 lesson'],
  [4, 2, undefined,      '4 modules x 2 lessons'],
  [3, 2, [10, 20, 30],   '3 modules, numbered 10/20/30'],
  [5, 1, [2, 4, 6, 8, 10], '5 modules, even numbering'],
] as [number, number, number[] | undefined, string][]) {

  section(`Course shape: ${label}`)
  const { course, modules, students } = await buildCourse(moduleCount, lessonsPer, orders)

  /* Snapshot per student so each session's effect is measured on its own.
     What is counted is the DIGEST QUEUE — a new session parks a row for the
     student it is relevant to and mails nobody on the spot. */
  const queued = (u: any) => DigestQueueModel.countDocuments({ userId: u._id })
  const before = new Map<string, number>()
  for (const u of students) before.set(String(u._id), await queued(u))

  for (let target = 0; target < moduleCount; target++) {
    await addSession(course, modules[target]!.sec._id)

    /* Exactly one student should have gained a queue row: the one who has
       completed `target` modules, i.e. stands immediately before this one. */
    const gained: string[] = []
    for (const u of students) {
      const now  = await queued(u)
      const prev = before.get(String(u._id)) ?? 0
      if (now > prev) gained.push(u.name)
      before.set(String(u._id), now)
    }

    check(`module ${target + 1}: exactly the student at position ${target} is queued for the digest`,
      gained.length === 1 && gained[0] === `done-${target}`,
      `queued [${gained.join(', ')}], expected [done-${target}]`)
  }

  /* And nobody was mailed on the spot — the whole point of the digest. */
  const mailedNow = await EmailOutboxModel.countDocuments({ to: { $in: students.map((u: any) => u.email) } })
  check('no student was emailed at creation time', mailedNow === 0, `${mailedNow} mail(s)`)

  /* Second half: the digest runs, and the mail that leaves is exactly one
     message to each student who had a row — done-0 … done-(N-1) — and nothing
     to done-N, who has completed the lot and had no session queued. */
  await runDailyDigest()
  const mailed: string[] = []
  for (const u of students) {
    const n = await EmailOutboxModel.countDocuments({ to: u.email })
    if (n === 1) mailed.push(u.name)
    else if (n > 1) mailed.push(`${u.name}x${n}`)
  }
  const expected = students.slice(0, moduleCount).map((u: any) => u.name)
  check(`the digest mails each queued student exactly once (${expected.length} of ${students.length})`,
    JSON.stringify(mailed.sort()) === JSON.stringify(expected.slice().sort()),
    `mailed [${mailed.join(', ')}], expected [${expected.join(', ')}]`)

  /* Whatever the email did, the notification centre saw every session. */
  const everyoneNotified = await Promise.all(students.map(async (u: any) =>
    await NotificationModel.countDocuments({ userId: u._id })))
  check(`every enrolled student has all ${moduleCount} sessions in-app`,
    everyoneNotified.every(c => c === moduleCount),
    everyoneNotified.join(','))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\nnewsessiongate.property.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
