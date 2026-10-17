/* ─────────────────────────────────────────────────────────────
   Course.enrolledCount — the student number the admin table shows.

   It is a denormalised counter, and it was being maintained on two of the
   five paths that create an enrolment and on NONE of the three that remove
   one. So it could only ever climb, and only for some enrolments: locally 18
   of 19 courses disagreed with the enrolments that actually existed, and any
   course from scripts/seed.ts carried `Math.random() * 3000`.

   Two separate guarantees are worth pinning, because they fail differently:

     A. the ADMIN LIST reports a true count — derived, so it cannot drift
        however badly the stored field is wrong;
     B. the STORED counter tracks creates AND deletes on every path, so the
        public catalogue (which sorts by it) stops telling stories.

   A is the safety net; B is the repair. Test both — if only B is covered, a
   new enrolment path silently reintroduces the bug; if only A is covered, the
   catalogue keeps lying.

   Run: bun run test:enrolledcount
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_enrolledcount'
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
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const {
  UserModel, CourseModel, EnrollmentModel, OrganizationModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_enrolledcount') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const idx = pair!.indexOf('=')
    if (idx > 0 && opts.jar) opts.jar.set(pair!.slice(0, idx), pair!.slice(idx + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

const storedCount = async (courseId: unknown): Promise<number> =>
  ((await CourseModel.findById(courseId).select('enrolledCount').lean()) as
    { enrolledCount?: number } | null)?.enrolledCount ?? 0

const PW = 'CorrectHorse1'

try {
  const org = await OrganizationModel.create({
    name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const admin = await UserModel.create({
    name: 'A', email: 'a@ec.local', passwordHash: hash, role: 'super_admin',
    isActive: true, organizationId: org._id,
  })
  const teacher = await UserModel.create({
    name: 'T', email: 't@ec.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })

  const mkCourse = (title: string, seeded = 0) => CourseModel.create({
    title, slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}${Math.random()}`,
    description: 'd', instructorId: teacher._id, price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: org._id,
    enrolledCount: seeded,
  })

  const aJar: Jar = new Map()
  await call('POST', '/admin/auth/login', { jar: aJar, body: { email: 'a@ec.local', password: PW } })

  /* ═══════════════════════════════════════════════ */
  section('A · the admin list reports a TRUE count, whatever the stored field says')
  {
    /* A course whose stored counter is pure fiction — exactly what
       scripts/seed.ts produces with Math.random() * 3000. */
    const course = await mkCourse('Fiction Counter', 2999)
    const students = await Promise.all([0, 1, 2].map(i => UserModel.create({
      name: `S${i}`, email: `s${i}-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })))
    /* Written straight to the collection, the way the bulk-import scripts do:
       the counter is untouched and stays at 2999. */
    await EnrollmentModel.insertMany(students.map(s => ({
      userId: s._id, courseId: course._id, status: 'active',
    })))

    check('the stored counter is still the fiction it started as',
      await storedCount(course._id) === 2999)

    const res = await call('GET', '/admin/courses?per_page=100', { jar: aJar })
    const row = (res.body?.data ?? []).find((c: any) => c.title === 'Fiction Counter')
    check('the admin list finds the course', !!row, String(res.status))
    check('and reports 3 — the enrolments that exist, not the stored 2999',
      row?.enrolledCount === 3, `got ${row?.enrolledCount}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('B · the stored counter tracks admin enrol and un-enrol')
  {
    const course = await mkCourse('Counted Course')
    const student = await UserModel.create({
      name: 'S', email: `s-admin-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })

    check('a new course starts at zero', await storedCount(course._id) === 0)

    const enrolled = await call('POST', `/admin/users/${String(student._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    check('an admin can enrol someone', enrolled.status === 201 || enrolled.status === 200,
      String(enrolled.status))
    check('and THAT path now increments — it never used to',
      await storedCount(course._id) === 1, `got ${await storedCount(course._id)}`)

    const row = await EnrollmentModel.findOne({ userId: student._id, courseId: course._id }).lean()
    const removed = await call('DELETE', `/admin/enrollments/${String((row as any)._id)}`, { jar: aJar })
    check('an admin can remove the enrolment', removed.status === 200, String(removed.status))
    check('and the counter comes back DOWN — nothing decremented it anywhere before',
      await storedCount(course._id) === 0, `got ${await storedCount(course._id)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · deleting the account releases the seats it held')
  {
    const course = await mkCourse('Seat Release')
    const student = await UserModel.create({
      name: 'S', email: `s-del-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    await call('POST', `/admin/users/${String(student._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    check('the seat is counted', await storedCount(course._id) === 1)

    const { AuthService } = await import('@/services/auth.service.ts')
    await new AuthService().deleteAccount(String(student._id), { password: PW })

    check('and released when the account is deleted',
      await storedCount(course._id) === 0, `got ${await storedCount(course._id)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('C2 · an ADMIN deleting the account releases them too')
  {
    /* The path that did NOT clean up. Self-deletion released the seat; an
       admin deleting the same student left the enrolment behind, pointing at
       a user that no longer existed. The course went on counting it, which is
       how the table could say 7 students on a course whose roster named 1. */
    const course = await mkCourse('Admin Seat Release')
    const student = await UserModel.create({
      name: 'S', email: `s-admindel-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    await call('POST', `/admin/users/${String(student._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    check('the seat is counted', await storedCount(course._id) === 1)

    const del = await call('DELETE', `/admin/users/${String(student._id)}`, { jar: aJar })
    check('the admin can delete the account', del.status === 200, String(del.status))

    check('the enrolment goes with it — it used to survive the account',
      await EnrollmentModel.countDocuments({ userId: student._id }) === 0,
      String(await EnrollmentModel.countDocuments({ userId: student._id })))
    check('and the course counter comes back down',
      await storedCount(course._id) === 0, `got ${await storedCount(course._id)}`)

    const res = await call('GET', `/admin/courses/${String(course._id)}/students`, { jar: aJar })
    check('the roster reports no orphan, because none was created',
      res.body?.data?.orphaned === 0, String(res.body?.data?.orphaned))
    check('and the admin list agrees at zero',
      (((await call('GET', '/admin/courses?per_page=100', { jar: aJar })).body?.data ?? [])
        .find((c: any) => c.title === 'Admin Seat Release')?.enrolledCount) === 0)

    /* Deleting a user who was never enrolled must still work. */
    const bare = await UserModel.create({
      name: 'B', email: `s-bare-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    const del2 = await call('DELETE', `/admin/users/${String(bare._id)}`, { jar: aJar })
    check('deleting a student with no enrolments still succeeds', del2.status === 200,
      String(del2.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('D · the roster — who is on this course, and how they got in')
  {
    const course = await mkCourse('Roster Course')

    const buyer = await UserModel.create({
      name: 'Buyer', email: `buy-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    const granted = await UserModel.create({
      name: 'Granted', email: `grant-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    const ghost = await UserModel.create({
      name: 'Ghost', email: `ghost-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })

    await EnrollmentModel.create({ userId: buyer._id, courseId: course._id, source: 'purchase' })
    await call('POST', `/admin/users/${String(granted._id)}/enrollments`, {
      jar: aJar, body: { courseId: String(course._id) },
    })
    /* An enrolment whose account is then removed from under it — the shape
       that made the roster shorter than the count with no explanation. */
    await EnrollmentModel.create({ userId: ghost._id, courseId: course._id, source: 'script' })
    await UserModel.deleteOne({ _id: ghost._id })

    const res = await call('GET', `/admin/courses/${String(course._id)}/students`, { jar: aJar })
    check('the roster endpoint answers', res.status === 200, String(res.status))

    const d = res.body?.data
    const names = (d?.rows ?? []).map((r: any) => r.student?.name).sort()
    check('it lists only students whose account still exists',
      JSON.stringify(names) === JSON.stringify(['Buyer', 'Granted']), JSON.stringify(names))

    const sourceOf = (n: string) =>
      (d?.rows ?? []).find((r: any) => r.student?.name === n)?.source
    check('a purchase is reported as a purchase', sourceOf('Buyer') === 'purchase', sourceOf('Buyer'))
    check('an admin grant is reported as admin — NOT as a purchase',
      sourceOf('Granted') === 'admin', sourceOf('Granted'))

    check('the source counts cover the whole course, not just the page',
      d?.bySource?.purchase === 1 && d?.bySource?.admin === 1,
      JSON.stringify(d?.bySource))

    check('the orphaned enrolment is COUNTED rather than silently dropped',
      d?.orphaned === 1, String(d?.orphaned))
    check('and listable + orphaned reconciles with the course total',
      (res.body?.meta?.total_count ?? 0) + (d?.orphaned ?? 0) === 3,
      `${res.body?.meta?.total_count} + ${d?.orphaned}`)

    const filtered = await call(
      'GET', `/admin/courses/${String(course._id)}/students?source=purchase`, { jar: aJar })
    check('filtering by source returns only that source',
      (filtered.body?.data?.rows ?? []).length === 1
      && filtered.body.data.rows[0].source === 'purchase',
      JSON.stringify((filtered.body?.data?.rows ?? []).map((r: any) => r.source)))

    /* The chips are what you click to change the filter, so they must keep
       describing the whole course while one is applied. When they shared a
       $facet with the rows, filtering to Purchased dropped the Admin chip
       entirely — leaving no way back to it, and an "All" that meant "all of
       the one source you already chose". */
    check('a filtered request still reports every source in the course',
      filtered.body?.data?.bySource?.purchase === 1
      && filtered.body?.data?.bySource?.admin === 1,
      JSON.stringify(filtered.body?.data?.bySource))
    check('and still reports the orphan count — the reason the list is short',
      filtered.body?.data?.orphaned === 1, String(filtered.body?.data?.orphaned))

    /* Same trap on the other filter. */
    const searched = await call(
      'GET', `/admin/courses/${String(course._id)}/students?search=Buyer`, { jar: aJar })
    check('a search narrows the rows', (searched.body?.data?.rows ?? []).length === 1,
      String((searched.body?.data?.rows ?? []).length))
    check('but leaves the source counts describing the whole course',
      searched.body?.data?.bySource?.purchase === 1
      && searched.body?.data?.bySource?.admin === 1,
      JSON.stringify(searched.body?.data?.bySource))

    const bad = await call('GET', '/admin/courses/not-an-id/students', { jar: aJar })
    check('a malformed course id is rejected', bad.status === 400, String(bad.status))
  }

  /* =============================================== */
  section('E · an enrolment with no stated source SAYS so, rather than guessing')
  {
    /* The schema default is 'unknown' on purpose. Every real source is
       knowable only at write time, so a default that names one -- 'admin', say
       -- would quietly relabel every legacy row and every row written by a
       path that forgot to say. The roster would then report a confident lie,
       which is worse than the gap it is filling. */
    const course = await mkCourse('Unstated Source')
    const student = await UserModel.create({
      name: 'S', email: `s-nosrc-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    /* Written the way the bulk importers and the older code do: no source. */
    await EnrollmentModel.create({ userId: student._id, courseId: course._id })

    const res = await call('GET', `/admin/courses/${String(course._id)}/students`, { jar: aJar })
    check('the roster answers', res.status === 200, String(res.status))
    check("it reads as 'unknown' — the default must never claim a real source",
      res.body?.data?.rows?.[0]?.source === 'unknown',
      String(res.body?.data?.rows?.[0]?.source))
    check('and the chip counts agree',
      res.body?.data?.bySource?.unknown === 1, JSON.stringify(res.body?.data?.bySource))
    check('filtering by unknown finds it',
      ((await call('GET', `/admin/courses/${String(course._id)}/students?source=unknown`,
        { jar: aJar })).body?.data?.rows ?? []).length === 1)
  }

  /* =============================================== */
  section('F · the course DETAIL agrees with the course LIST')
  {
    /* The shape seen in production: a stored counter that drifted upward while
       the real enrolments stayed put. The list already derived the truth; the
       detail page returned the stored field, so one course reported 8 in the
       table and 21 on its own page. */
    const course = await mkCourse('Two Screens', 21)
    const students = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => UserModel.create({
      name: `TS${i}`, email: `ts${i}-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })))
    await EnrollmentModel.insertMany(students.map(u => ({
      userId: u._id, courseId: course._id, status: 'active',
    })))

    check('the stored counter is still the drifted 21',
      await storedCount(course._id) === 21, String(await storedCount(course._id)))

    const list = await call('GET', '/admin/courses?per_page=100', { jar: aJar })
    const row  = (list.body?.data ?? []).find((c: any) => c.title === 'Two Screens')
    check('the LIST reports 8 — the enrolments that exist',
      row?.enrolledCount === 8, String(row?.enrolledCount))

    const detail = await call('GET', `/admin/courses/${String(course._id)}`, { jar: aJar })
    check('the DETAIL page answers', detail.status === 200, String(detail.status))
    check('and reports 8 as well — it used to hand back the stored 21',
      detail.body?.data?.enrolledCount === 8, String(detail.body?.data?.enrolledCount))
    check('so the two screens agree',
      detail.body?.data?.enrolledCount === row?.enrolledCount,
      `detail=${detail.body?.data?.enrolledCount} list=${row?.enrolledCount}`)

    /* And the roster behind the tile lists exactly that many people. */
    const roster = await call('GET', `/admin/courses/${String(course._id)}/students?per_page=100`, { jar: aJar })
    check('the roster holds the same number of students',
      (roster.body?.data?.rows ?? []).length === 8,
      String((roster.body?.data?.rows ?? []).length))
  }

  /* =============================================== */
  section('G · the dashboard counts enrolments the purchase path created')
  {
    /* `enrollmentRepo.create_` does not write Enrollment.organizationId, and it
       is the path behind self-enrolment and every purchase. The dashboard used
       to count enrolments BY that field, so those rows matched nothing and the
       card read 0 while the course list beside it showed enrolled students. */
    const course = await mkCourse('Dashboard Course')
    const student = await UserModel.create({
      name: 'Dash', email: `dash-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })

    const { EnrollmentRepository } = await import('@/repositories/enrollment.repository.ts')
    await new EnrollmentRepository().create_({
      userId: student._id, courseId: course._id, source: 'purchase',
    })

    const row = await EnrollmentModel.findOne({ userId: student._id, courseId: course._id }).lean() as any
    check('the enrolment carries NO organizationId — this is the real shape',
      row?.organizationId === undefined || row?.organizationId === null,
      String(row?.organizationId))

    /* Ask as an ORG-SCOPED admin, not the super admin. A super_admin carries no
       organizationId unless the topbar switcher supplies one, so the org filter
       would be empty and both the old and new implementation would count
       everything — the test would pass either way and prove nothing. A plain
       admin gets their academy from their own account, which is the scope the
       bug actually lived in. */
    const scopedAdmin = await UserModel.create({
      name: 'Scoped', email: `scoped-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'admin', isActive: true, organizationId: org._id,
    })
    const sJar: Jar = new Map()
    await call('POST', '/admin/auth/login', {
      jar: sJar, body: { email: scopedAdmin.email, password: PW },
    })

    const stats = await call('GET', '/admin/stats', { jar: sJar })
    check('the stats endpoint answers', stats.status === 200, String(stats.status))
    check('and counts it anyway — derived from the courses in scope',
      (stats.body?.data?.totalEnrollments ?? 0) >= 1,
      String(stats.body?.data?.totalEnrollments))

    /* The dashboard total must not contradict the sum of the rows beside it. */
    const list = await call('GET', '/admin/courses?per_page=200', { jar: sJar })
    const sumOfRows = (list.body?.data ?? [])
      .reduce((t: number, c: any) => t + (c.enrolledCount ?? 0), 0)
    check('the dashboard total equals the sum of the course rows',
      stats.body?.data?.totalEnrollments === sumOfRows,
      `stats=${stats.body?.data?.totalEnrollments} rows=${sumOfRows}`)

    /* "Total Students" counts PEOPLE on those courses, so it must be at most
       the enrolment total — one student on two courses is two enrolments but
       one student — and it must not count accounts that never enrolled. */
    const distinctOnCourses = (await EnrollmentModel.distinct('userId', {
      courseId: { $in: (await CourseModel.find({ organizationId: org._id }, { _id: 1 }).lean()).map(c => c._id) },
    })).length
    check('Total Students counts distinct people on the academy courses',
      stats.body?.data?.totalStudents === distinctOnCourses,
      `stats=${stats.body?.data?.totalStudents} distinct=${distinctOnCourses}`)
    check('and never exceeds the enrolment count',
      (stats.body?.data?.totalStudents ?? 0) <= (stats.body?.data?.totalEnrollments ?? 0),
      `students=${stats.body?.data?.totalStudents} enrolments=${stats.body?.data?.totalEnrollments}`)

    /* A registered account that never enrolled must NOT inflate the tile. */
    await UserModel.create({
      name: 'Never', email: `never-${Date.now()}@ec.local`, passwordHash: hash,
      role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    const after = await call('GET', '/admin/stats', { jar: sJar })
    check('a student who never enrolled does not move the number',
      after.body?.data?.totalStudents === stats.body?.data?.totalStudents,
      `before=${stats.body?.data?.totalStudents} after=${after.body?.data?.totalStudents}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('H · the dashboard "Most enrolled courses" widget ranks on reality')
  {
    /* The widget read the stored `enrolledCount` AND sorted by it. Two faults,
       and only one is about numbers: sorting by a fictional field picks the
       wrong five COURSES, so re-counting afterwards would have printed honest
       figures next to the wrong names. The order is what this section is for. */
    const fake = await mkCourse('Fake Popular', 5000)
    const real = await mkCourse('Really Popular', 0)

    const mkStudents = (tag: string, n: number) => Promise.all(
      Array.from({ length: n }, (_, i) => UserModel.create({
        name: `${tag}${i}`, email: `${tag}${i}-${Date.now()}-${Math.random()}@ec.local`,
        passwordHash: hash, role: 'student', isActive: true,
        enrollmentStatus: 'approved', organizationId: org._id,
      })),
    )

    /* Straight into the collection, the way the import scripts write — the
       stored counter never moves, which is the whole premise. */
    const few  = await mkStudents('fake', 1)
    const many = await mkStudents('real', 6)
    await EnrollmentModel.insertMany(few.map(u  => ({ userId: u._id, courseId: fake._id, status: 'active' })))
    await EnrollmentModel.insertMany(many.map(u => ({ userId: u._id, courseId: real._id, status: 'active' })))

    check('the fiction is still in the database — this is not a seeding artefact',
      await storedCount(fake._id) === 5000, String(await storedCount(fake._id)))
    check('and the genuinely popular course still stores zero',
      await storedCount(real._id) === 0, String(await storedCount(real._id)))

    const res = await call('GET', '/admin/analytics/top-courses?limit=20', { jar: aJar })
    check('the widget endpoint answers', res.status === 200, String(res.status))

    const rows: any[] = res.body?.data ?? []
    const iReal = rows.findIndex(r => r.title === 'Really Popular')
    const iFake = rows.findIndex(r => r.title === 'Fake Popular')

    check('the genuinely popular course is listed at all', iReal >= 0,
      rows.map(r => r.title).join(' | '))
    check('it OUTRANKS the one with the inflated counter — the order is derived',
      iReal >= 0 && iFake >= 0 && iReal < iFake, `real=${iReal} fake=${iFake}`)

    check('it reports 6, its real enrolments, not the 0 it stores',
      rows[iReal]?.enrolledCount === 6, String(rows[iReal]?.enrolledCount))
    check('and the inflated one reports 1, not 5000',
      rows[iFake]?.enrolledCount === 1, String(rows[iFake]?.enrolledCount))
    check('no row anywhere carries the fictional figure',
      !rows.some(r => r.enrolledCount === 5000),
      rows.map(r => `${r.title}=${r.enrolledCount}`).join(' | '))

    /* Every figure on the widget must survive a direct recount. */
    let mismatched = ''
    for (const r of rows) {
      const truth = await EnrollmentModel.countDocuments({ courseId: r.id })
      if (truth !== r.enrolledCount) mismatched += `${r.title}: shown ${r.enrolledCount}, real ${truth}; `
    }
    check('every row on the widget matches a direct count of its enrolments',
      mismatched === '', mismatched)

    /* A course nobody enrolled on is not a "top performer". */
    await mkCourse('Nobody Wanted This', 4321)
    const again = await call('GET', '/admin/analytics/top-courses?limit=20', { jar: aJar })
    check('a course with zero enrolments stays off the list, however big its counter',
      !(again.body?.data ?? []).some((r: any) => r.title === 'Nobody Wanted This'),
      (again.body?.data ?? []).map((r: any) => r.title).join(' | '))
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
