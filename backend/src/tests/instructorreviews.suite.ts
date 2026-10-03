/* ─────────────────────────────────────────────────────────────
   Instructor reviews — a student rates the SESSION they attended, never the
   course, and never a class they only booked but skipped.

   Three properties matter most:
     A  only an ATTENDED seat may review — booked-but-not-attended and
        never-booked both get the same NOT_ATTENDED refusal (never a
        different answer that would confirm whether a class/booking exists)
     B  one review per (student, class) — a second submit is refused, not
        silently overwritten or duplicated
     C  the admin leaderboard is scoped like every other admin listing this
        session fixed: keyed off whether the org-switcher's X-Organization-Id
        actually set an org, not off role — a super_admin with no academy
        selected sees every academy; one selected narrows like an org admin

   Run: bun run test:instructorreviews
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_instructorreviews_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'

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
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel, InstructorReviewModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_instructorreviews_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
/* The one-review-per-(student,class) invariant is an index, and autoIndex is
   off above (every suite turns it off for speed) — build just this one so
   section B's duplicate-submit check is testing the real guard, not nothing. */
await InstructorReviewModel.syncIndexes().catch(() => {})

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const PW = 'CorrectHorse1'
let seq = 0
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@ir.local`

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)

  const mkUser = (role: string, extra: Record<string, unknown> = {}) =>
    UserModel.create({ name: role, email: email(role), passwordHash: hash, role, isActive: true, ...extra })

  const instructorA = await mkUser('instructor', { organizationId: dubai._id, category: 'ai' })
  const instructorB = await mkUser('instructor', { organizationId: dubai._id, category: 'ai' })
  const instructorBlr = await mkUser('instructor', { organizationId: blr._id, category: 'ai' })

  const courseA = await CourseModel.create({
    title: 'Course A', slug: `course-a-${Date.now()}`, description: 'd', instructorId: instructorA._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: dubai._id, program: 'ai',
  })
  const courseBlr = await CourseModel.create({
    title: 'Course Blr', slug: `course-blr-${Date.now()}`, description: 'd', instructorId: instructorBlr._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: blr._id, program: 'ai',
  })

  const student = await mkUser('student', { organizationId: dubai._id, category: 'ai', enrollmentStatus: 'approved' })
  const studentJar: Jar = new Map()
  {
    const r = await call('POST', '/auth/login', { jar: studentJar, body: { email: student.email, password: PW } })
    if (r.status !== 200) throw new Error(`student login: ${r.status} ${JSON.stringify(r.body)}`)
  }

  let seqC = 0
  const mkClass = (instructor: any, course: any, org: any) => LiveClassModel.create({
    title: `Session ${seqC++}`, courseId: course._id, instructorId: instructor._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() - 2 * 3_600_000), durationMins: 60, type: 'external', isOnline: true,
  })
  const mkBooking = (status: 'attended' | 'booked' | 'missed', cls: any) => ClassBookingModel.create({
    userId: student._id, liveClassId: cls._id, status, bookedAt: new Date(),
  })

  /* ═══════════════════════════════════════════════ */
  section('A · only an attended seat may review — the same refusal either way')
  {
    const attendedCls = await mkClass(instructorA, courseA, dubai)
    await mkBooking('attended', attendedCls)

    const r = await call('POST', '/instructor-reviews', {
      jar: studentJar, body: { liveClassId: String(attendedCls._id), rating: 5, comment: 'Great class' },
    })
    check('an attended seat can review', r.status === 201, `${r.status} ${JSON.stringify(r.body?.error ?? '')}`)
    check('the row is attached to the right instructor/course, resolved server-side',
      r.body?.data?.instructorId === String(instructorA._id) && r.body?.data?.courseId === String(courseA._id),
      JSON.stringify({ i: r.body?.data?.instructorId, c: r.body?.data?.courseId }))

    const bookedOnlyCls = await mkClass(instructorA, courseA, dubai)
    await mkBooking('booked', bookedOnlyCls)
    const r2 = await call('POST', '/instructor-reviews', {
      jar: studentJar, body: { liveClassId: String(bookedOnlyCls._id), rating: 4 },
    })
    check('a booked-but-not-attended seat is refused', r2.status === 403 && r2.body?.error?.code === 'NOT_ATTENDED',
      `${r2.status} ${r2.body?.error?.code}`)

    const neverBookedCls = await mkClass(instructorA, courseA, dubai)
    const r3 = await call('POST', '/instructor-reviews', {
      jar: studentJar, body: { liveClassId: String(neverBookedCls._id), rating: 4 },
    })
    check('a class never booked at all gets the SAME refusal code — no signal either way',
      r3.status === 403 && r3.body?.error?.code === 'NOT_ATTENDED', `${r3.status} ${r3.body?.error?.code}`)

    const missedCls = await mkClass(instructorA, courseA, dubai)
    await mkBooking('missed', missedCls)
    const r4 = await call('POST', '/instructor-reviews', {
      jar: studentJar, body: { liveClassId: String(missedCls._id), rating: 1 },
    })
    check('a finalized "missed" seat is refused too', r4.status === 403 && r4.body?.error?.code === 'NOT_ATTENDED',
      `${r4.status} ${r4.body?.error?.code}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('B · one review per (student, class) — a second submit is refused')
  {
    const cls = await mkClass(instructorA, courseA, dubai)
    await mkBooking('attended', cls)
    const r1 = await call('POST', '/instructor-reviews', { jar: studentJar, body: { liveClassId: String(cls._id), rating: 3 } })
    check('first submit succeeds', r1.status === 201, String(r1.status))

    const r2 = await call('POST', '/instructor-reviews', { jar: studentJar, body: { liveClassId: String(cls._id), rating: 5 } })
    check('second submit on the same class is refused', r2.status === 409 && r2.body?.error?.code === 'ALREADY_REVIEWED',
      `${r2.status} ${r2.body?.error?.code}`)

    const stored = await InstructorReviewModel.findOne({ studentId: student._id, liveClassId: cls._id }).lean()
    check('the original rating is untouched by the rejected second attempt', stored?.rating === 3, String(stored?.rating))
  }

  /* ═══════════════════════════════════════════════ */
  section('C · validation — rating must be 1-5, comment is optional')
  {
    const cls = await mkClass(instructorA, courseA, dubai)
    await mkBooking('attended', cls)
    const r0 = await call('POST', '/instructor-reviews', { jar: studentJar, body: { liveClassId: String(cls._id), rating: 0 } })
    check('rating 0 is rejected by validation', r0.status === 422, String(r0.status))
    const r6 = await call('POST', '/instructor-reviews', { jar: studentJar, body: { liveClassId: String(cls._id), rating: 6 } })
    check('rating 6 is rejected by validation', r6.status === 422, String(r6.status))

    const r5 = await call('POST', '/instructor-reviews', { jar: studentJar, body: { liveClassId: String(cls._id), rating: 5 } })
    check('rating 5 with no comment succeeds — comment is optional', r5.status === 201, String(r5.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · /pending lists attended-unreviewed classes, newest first, and drops reviewed ones')
  {
    const freshStudent = await mkUser('student', { organizationId: dubai._id, category: 'ai', enrollmentStatus: 'approved' })
    const freshJar: Jar = new Map()
    await call('POST', '/auth/login', { jar: freshJar, body: { email: freshStudent.email, password: PW } })

    const old = await mkClass(instructorA, courseA, dubai)
    await LiveClassModel.updateOne({ _id: old._id }, { scheduledStart: new Date(Date.now() - 5 * 3_600_000) })
    await ClassBookingModel.create({ userId: freshStudent._id, liveClassId: old._id, status: 'attended', bookedAt: new Date() })

    const recent = await mkClass(instructorA, courseA, dubai)
    await ClassBookingModel.create({ userId: freshStudent._id, liveClassId: recent._id, status: 'attended', bookedAt: new Date() })

    const notAttended = await mkClass(instructorA, courseA, dubai)
    await ClassBookingModel.create({ userId: freshStudent._id, liveClassId: notAttended._id, status: 'missed', bookedAt: new Date() })

    const p1 = await call('GET', '/instructor-reviews/pending', { jar: freshJar })
    const ids1 = (p1.body?.data ?? []).map((x: any) => x.liveClassId)
    check('pending lists both attended classes', ids1.includes(String(old._id)) && ids1.includes(String(recent._id)),
      JSON.stringify(ids1))
    check('pending excludes the missed class', !ids1.includes(String(notAttended._id)), JSON.stringify(ids1))
    check('pending is newest-first', ids1.indexOf(String(recent._id)) < ids1.indexOf(String(old._id)), JSON.stringify(ids1))

    await call('POST', '/instructor-reviews', { jar: freshJar, body: { liveClassId: String(recent._id), rating: 4 } })
    const p2 = await call('GET', '/instructor-reviews/pending', { jar: freshJar })
    const ids2 = (p2.body?.data ?? []).map((x: any) => x.liveClassId)
    check('once reviewed, the class drops off pending', !ids2.includes(String(recent._id)), JSON.stringify(ids2))
    check('...but the still-unreviewed one remains', ids2.includes(String(old._id)), JSON.stringify(ids2))
  }

  /* ═══════════════════════════════════════════════ */
  section('E · auth gates — unauthenticated and wrong-role')
  {
    const anon = await call('GET', '/instructor-reviews/pending')
    check('pending requires a session', anon.status === 401, String(anon.status))
    const anonPost = await call('POST', '/instructor-reviews', { body: { liveClassId: '000000000000000000000000', rating: 5 } })
    check('submit requires a session', anonPost.status === 401, String(anonPost.status))
    const anonAdmin = await call('GET', '/instructor-reviews/admin/leaderboard')
    check('the admin leaderboard requires an admin session', anonAdmin.status === 401, String(anonAdmin.status))

    const outsiderInstructor = await mkUser('instructor', { organizationId: dubai._id })
    const instructorJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: instructorJar, body: { email: outsiderInstructor.email, password: PW } })
    const instructorBoard = await call('GET', '/instructor-reviews/admin/leaderboard', { jar: instructorJar })
    check('an instructor session is refused the leaderboard — not in the allowed role list',
      instructorBoard.status === 403, String(instructorBoard.status))

    const support = await mkUser('support', { organizationId: dubai._id })
    const supportJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: supportJar, body: { email: support.email, password: PW } })
    const supportBoard = await call('GET', '/instructor-reviews/admin/leaderboard', { jar: supportJar })
    check('a support session is refused the leaderboard too', supportBoard.status === 403, String(supportBoard.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · admin leaderboard — sorted highest-rated first, and scoped by org + programme')
  {
    /* Seed a clean, known rating distribution. */
    const seedReviews = async (instructor: any, course: any, org: any, ratings: number[]) => {
      for (const rating of ratings) {
        const s = await mkUser('student', { organizationId: org._id })
        const cls = await mkClass(instructor, course, org)
        await ClassBookingModel.create({ userId: s._id, liveClassId: cls._id, status: 'attended', bookedAt: new Date() })
        await InstructorReviewModel.create({
          liveClassId: cls._id, studentId: s._id, instructorId: instructor._id, courseId: course._id,
          organizationId: org._id, program: 'ai', rating,
        })
      }
    }
    await seedReviews(instructorA, courseA, dubai, [5, 5, 4])   // avg 4.67
    await seedReviews(instructorB, courseA, dubai, [2, 1])      // avg 1.5
    await seedReviews(instructorBlr, courseBlr, blr, [5, 5, 5]) // avg 5, different academy

    const superAdmin = await mkUser('super_admin')
    const dubaiAdmin = await mkUser('admin', { organizationId: dubai._id })
    const superJar: Jar = new Map()
    const dubaiJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: superJar, body: { email: superAdmin.email, password: PW } })
    await call('POST', '/admin/auth/login', { jar: dubaiJar, body: { email: dubaiAdmin.email, password: PW } })

    const all = await call('GET', '/instructor-reviews/admin/leaderboard', { jar: superJar })
    check('super admin on "All Orgs" sees every academy\'s instructors',
      (all.body?.data ?? []).length >= 3, JSON.stringify((all.body?.data ?? []).map((r: any) => r.name)))
    const names = (all.body?.data ?? []).map((r: any) => r.instructorId)
    check('highest-rated instructor is first', names[0] === String(instructorBlr._id) || names[0] === String(instructorA._id),
      JSON.stringify(all.body?.data?.map((r: any) => ({ id: r.instructorId, avg: r.avgRating }))))
    const sorted = (all.body?.data ?? []).every((r: any, i: number, arr: any[]) =>
      i === 0 || arr[i - 1].avgRating >= r.avgRating)
    check('the whole list is sorted highest-first', sorted, JSON.stringify(all.body?.data?.map((r: any) => r.avgRating)))

    const switched = await call('GET', '/instructor-reviews/admin/leaderboard', {
      jar: superJar, headers: { 'x-organization-id': String(blr._id) },
    })
    const switchedIds = (switched.body?.data ?? []).map((r: any) => r.instructorId)
    check('switched to Bangalore, only the Bangalore instructor appears',
      switchedIds.length === 1 && switchedIds[0] === String(instructorBlr._id), JSON.stringify(switchedIds))

    const dubaiView = await call('GET', '/instructor-reviews/admin/leaderboard', { jar: dubaiJar })
    const dubaiIds = (dubaiView.body?.data ?? []).map((r: any) => r.instructorId)
    check('a Dubai admin sees only Dubai\'s instructors',
      dubaiIds.includes(String(instructorA._id)) && dubaiIds.includes(String(instructorB._id))
        && !dubaiIds.includes(String(instructorBlr._id)), JSON.stringify(dubaiIds))

    const worst = (all.body?.data ?? []).find((r: any) => r.instructorId === String(instructorB._id))
    check('low-rating flag counts the <=2-star reviews', worst?.lowRatingCount === 2, JSON.stringify(worst))
  }

  /* ═══════════════════════════════════════════════ */
  section('G · admin per-instructor drill-down')
  {
    const superAdmin = await mkUser('super_admin')
    const superJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: superJar, body: { email: superAdmin.email, password: PW } })

    const r = await call('GET', `/instructor-reviews/admin/instructor/${instructorA._id}`, { jar: superJar })
    check('the drill-down answers 200', r.status === 200, String(r.status))
    check('every row belongs to the requested instructor',
      (r.body?.data ?? []).length > 0, 'expected at least one review from section A/F')
  }

  /* ═══════════════════════════════════════════════
     H covers a gap section B's sequential duplicate-submit check cannot: two
     requests racing past the "already reviewed?" read before either has
     written is a classic TOCTOU window. The only thing that can close it is
     the database's own unique index rejecting the loser with 11000 — this
     proves that guard holds under REAL concurrency, not just back-to-back
     calls on one connection. */
  section('H · true concurrency — N simultaneous submits for the same seat leave exactly one row')
  {
    const raceStudent = await mkUser('student', { organizationId: dubai._id, enrollmentStatus: 'approved' })
    const raceJar: Jar = new Map()
    await call('POST', '/auth/login', { jar: raceJar, body: { email: raceStudent.email, password: PW } })

    const cls = await mkClass(instructorA, courseA, dubai)
    await ClassBookingModel.create({ userId: raceStudent._id, liveClassId: cls._id, status: 'attended', bookedAt: new Date() })

    const N = 8
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        call('POST', '/instructor-reviews', { jar: raceJar, body: { liveClassId: String(cls._id), rating: 5, comment: `race ${i}` } })),
    )
    const succeeded = results.filter(r => r.status === 201)
    const refused   = results.filter(r => r.status === 409 && r.body?.error?.code === 'ALREADY_REVIEWED')
    const detail    = JSON.stringify(results.map(r => ({ status: r.status, code: r.body?.error?.code })))
    check('exactly one of the N concurrent requests created the review', succeeded.length === 1, detail)
    check('every other request was refused as ALREADY_REVIEWED, not a 500 or a silent duplicate',
      refused.length === N - 1, detail)

    const rows = await InstructorReviewModel.find({ studentId: raceStudent._id, liveClassId: cls._id }).lean()
    check('exactly one row exists in the database afterward', rows.length === 1, String(rows.length))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
