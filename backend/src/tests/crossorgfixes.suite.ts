/* ─────────────────────────────────────────────────────────────
   Cross-academy — the round of fixes, pinned.

   Both halves of the feature were reported "not working", and the reads mostly
   were: a guest academy's admin saw the class, its students saw it on the
   schedule, and a booking went through. What was broken sat around the edges,
   and this suite is one check per repair so none of them can quietly come
   undone.

     A  THE WATCH LEAK. getWatchAccess enumerated two of the three entitlement
        verdicts and forgot WRONG_ACADEMY, so it fell through to the returns
        that hand back the Mux playback URL and the LiveKit room. A student of
        an academy the class does not serve, holding no enrolment of any kind,
        opened /live-classes/:id/watch and got a working stream.

     B  WHOSE COURSE WAS THIS SEAT FOR. /bookings/me walked courseId and
        sectionId off the class — the HOST's — so a guest student's Booking
        History named a course they are not enrolled on and a module that does
        not exist in their academy.

     C  ONLY AN INSTRUCTOR MAY BE LENT. The schema's pre('validate') hook is
        document middleware and does not run on findByIdAndUpdate, so the admin
        PATCH could put sharedAcrossOrgs on a student and could leave it behind
        on an instructor promoted to admin.

     D  WHAT THE BORROWING ACADEMY MAY NOT DO. A lent instructor is
        administered by both academies on purpose. Their ROLE and their LENDING
        are not part of that: a borrowing admin setting role 'admin' mints an
        admin inside the LENDING academy.

     E  THE LENT INSTRUCTOR IS A USER TOO. The Users list widened to lent
        instructors only when role=instructor was explicitly asked for, so the
        borrowing academy saw them on one screen and not the next.

     F  ATTENDANCE ON A CANCELLED SEAT. findByIdAndUpdate was handed a filter
        object where the id goes; mongoose takes _id and discards the rest, so
        the status guard never applied and a released seat could be marked
        attended.

     G  AN UNCHANGED INSTRUCTOR IS NOT AN ASSIGNMENT. Re-validating the
        instructor on every save turned "is this a legal assignment" into "is
        this instructor still reachable today" — so un-lending froze every
        class the borrowing academy had scheduled for them.

     H  A COPY OF A SHARED CLASS. Repeat dropped `provider` (every copy of an
        In-App Stream class was born a Mux one) and needed super_admin to carry
        the source's own cohorts, so the academy that owns a shared class could
        not make it weekly.

     I  THE PROGRAMME NARROWING ASKED THE HOST'S QUESTION. A guest academy's
        programme-scoped admin holds their OWN course, never the host's, so a
        shared class vanished from their console list.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_crossorgfixes_suite), dropped on exit.

   Run: bun run test:crossorgfixes
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgfixes_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
/* PINNED ON. Every subject here is a cross-academy behaviour; with the switch
   off doorsFor() returns the host door alone and half of this suite would be
   asserting nothing. Pinned rather than inherited so the result does not
   depend on the operator's shell — the same reason its two siblings pin it. */
process.env.CROSS_ORG_CLASSES   = 'true'
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
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgfixes_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

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
const errOf = (r: any) => String(r.body?.error?.code ?? '')

const PW  = 'CrossOrg1234'
const MIN = 60_000

try {

/* ── Two academies, each with a course and a module ────────────────────── */
const dubai = await OrganizationModel.create({ name: 'Dubai Academy',     slug: 'dubai',     currency: 'AED', paymentGateway: 'abzer' })
const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const hash  = await hashPassword(PW)

const mkUser = (email: string, role: string, org: any, extra: Record<string, unknown> = {}) =>
  UserModel.create({
    name: email.split('@')[0], email, passwordHash: hash, role,
    isActive: true, isVerified: true, organizationId: org?._id,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}),
    ...extra,
  })

const superAdmin = await mkUser('super@x.local', 'super_admin', null)
const dxbAdmin   = await mkUser('dxbadmin@x.local', 'admin', dubai)
const blrAdmin   = await mkUser('blradmin@x.local', 'admin', blr)
const teacher    = await mkUser('teach@x.local', 'instructor', dubai)
const lent       = await mkUser('lent@x.local', 'instructor', dubai, { sharedAcrossOrgs: true })
const blrTeacher = await mkUser('blrteach@x.local', 'instructor', blr)

const dxbCourse = await CourseModel.create({
  title: 'Dubai Forex', slug: 'dxb-forex', description: 'd', instructorId: teacher._id,
  price: 0, isFree: true, status: 'published', language: 'English',
  organizationId: dubai._id, program: 'forex',
})
const dxbModule = await SectionModel.create({ courseId: dxbCourse._id, title: 'Dubai Module 1', order: 1 })
const blrCourse = await CourseModel.create({
  title: 'Bangalore AI', slug: 'blr-ai', description: 'd', instructorId: blrTeacher._id,
  price: 0, isFree: true, status: 'published', language: 'English',
  organizationId: blr._id, program: 'ai',
})
const blrModule = await SectionModel.create({ courseId: blrCourse._id, title: 'Bangalore Module 1', order: 1 })

const blrStudent = await mkUser('blrstu@x.local', 'student', blr)
const dxbStudent = await mkUser('dxbstu@x.local', 'student', dubai)
await EnrollmentModel.create({ userId: blrStudent._id, courseId: blrCourse._id, status: 'active' })
await EnrollmentModel.create({ userId: dxbStudent._id, courseId: dxbCourse._id, status: 'active' })

/* THE TWO-DEVICE LIMIT IS OFF FOR THIS SUITE, stored rather than assumed.
   It defaults to ON and fails closed by design, and a student login from a
   fresh "device" can come back 403 DEVICE_PENDING — which is correct behaviour
   and has nothing to do with anything here, but it aborts the whole file on the
   throw below. One deliberate `false` makes the run deterministic; devices.suite
   and devicetoggle.suite are where that control is actually tested. */
await (await import('@/services/settings.service.ts')).setDeviceLimitEnabled(false)

const login = async (email: string, admin = false): Promise<Jar> => {
  const jar: Jar = new Map()
  const r = await call('POST', admin ? '/admin/auth/login' : '/auth/login', { jar, body: { email, password: PW } })
  if (r.status !== 200) {
    /* Say WHICH of the two things went wrong. A bare "login failed" on a
       fixture account sent me looking at the auth stack for an hour when the
       account itself was the question. */
    const row = await UserModel.findOne({ email }).select('_id role isActive isVerified').lean() as any
    throw new Error(
      `login failed for ${email}: ${r.status} ${JSON.stringify(r.body?.error ?? '')} `
      + `— user row: ${row ? JSON.stringify({ id: String(row._id), role: row.role, isActive: row.isActive, isVerified: row.isVerified }) : 'MISSING'}`,
    )
  }
  return jar
}
const superJar = await login('super@x.local', true)
const dxbJar   = await login('dxbadmin@x.local', true)
const blrJar   = await login('blradmin@x.local', true)
const stuJar   = await login('blrstu@x.local')

/* A Dubai class SHARED with Bangalore through Bangalore's own course+module. */
const shared = await LiveClassModel.create({
  courseId: dxbCourse._id, sectionId: dxbModule._id, instructorId: lent._id,
  title: 'Shared session', scheduledStart: new Date(Date.now() + 60 * MIN),
  durationMins: 60, type: 'internal', provider: 'livekit', status: 'scheduled',
  organizationId: dubai._id, sessionCapacity: 30, language: 'English',
  muxPlaybackId: 'PLAYBACK_SHARED',
  hostSeatsLeft: 15, overflowSeatsLeft: 5,
  guestCohorts: [{ organizationId: blr._id, courseId: blrCourse._id, sectionId: blrModule._id, seatFloor: 10, seatsLeft: 10 }],
})
/* A Dubai class that is NOT shared — the leak's subject. */
const dubaiOnly = await LiveClassModel.create({
  courseId: dxbCourse._id, instructorId: teacher._id,
  title: 'Dubai only', scheduledStart: new Date(Date.now() + 60 * MIN),
  durationMins: 60, type: 'internal', provider: 'mux', status: 'scheduled',
  organizationId: dubai._id, sessionCapacity: 30, language: 'English',
  muxPlaybackId: 'PLAYBACK_PRIVATE',
})

/* ── A ── the watch leak ───────────────────────────────────────────────── */
section('A. the watch page answers every entitlement verdict, not two of three')
const leak = await call('GET', `/live-classes/${dubaiOnly._id}/watch`, { jar: stuJar })
check('a student of an academy the class does not serve is refused',
  leak.status === 404, `got ${leak.status}`)
check('…and the refusal carries no playback url',
  !JSON.stringify(leak.body ?? {}).includes('PLAYBACK_PRIVATE'),
  JSON.stringify(leak.body).slice(0, 160))
check('…answered 404, not 403 — a 403 confirms the class exists elsewhere',
  errOf(leak) === 'LIVE_CLASS_NOT_FOUND', errOf(leak))

const allowed = await call('GET', `/live-classes/${shared._id}/watch`, { jar: stuJar })
check('a GUEST student of a shared class still gets in',
  allowed.status === 200, `got ${allowed.status} ${errOf(allowed)}`)

const hostJar  = await login('dxbstu@x.local')
const hostSees = await call('GET', `/live-classes/${dubaiOnly._id}/watch`, { jar: hostJar })
check('the host academy’s own enrolled student is unaffected',
  hostSees.status === 200, `got ${hostSees.status} ${errOf(hostSees)}`)

/* ── B ── whose course was this seat for ───────────────────────────────── */
section('B. Booking History names YOUR course and module, not the host’s')
await ClassBookingModel.create({
  userId: blrStudent._id, liveClassId: shared._id, status: 'booked',
  bookedAt: new Date(), seatPoolKind: 'guest', seatOrganizationId: blr._id,
})
await ClassBookingModel.create({
  userId: dxbStudent._id, liveClassId: shared._id, status: 'booked',
  bookedAt: new Date(), seatPoolKind: 'host', seatOrganizationId: dubai._id,
})

const mine = await call('GET', '/bookings/me?per_page=20', { jar: stuJar })
const row  = (mine.body?.data ?? [])[0]?.liveClassId
check('the guest’s row carries a cohort of their own',
  !!row?.yourCohort, JSON.stringify(row?.yourCohort ?? null))
check('…naming THEIR course, not the host’s',
  row?.yourCohort?.courseTitle === 'Bangalore AI' && row?.courseId?.title === 'Dubai Forex',
  `${row?.yourCohort?.courseTitle} vs host ${row?.courseId?.title}`)
check('…and THEIR module, which is the one that actually gates them',
  row?.yourCohort?.sectionTitle === 'Bangalore Module 1',
  String(row?.yourCohort?.sectionTitle))
check('…with the slug the Enroll link is built from',
  row?.yourCohort?.courseSlug === 'blr-ai', String(row?.yourCohort?.courseSlug))
check('the class’s academy and cohort list are NEVER serialised to a student',
  row?.organizationId === undefined && row?.guestCohorts === undefined,
  JSON.stringify({ org: row?.organizationId, cohorts: row?.guestCohorts }))

const hostMine = await call('GET', '/bookings/me?per_page=20', { jar: hostJar })
check('a HOST student’s row has no cohort at all — it serialises as it always did',
  (hostMine.body?.data ?? [])[0]?.liveClassId?.yourCohort === undefined,
  JSON.stringify((hostMine.body?.data ?? [])[0]?.liveClassId?.yourCohort))

/* ── C ── only an instructor may be lent ───────────────────────────────── */
section('C. the lending flag cannot land on a non-instructor')
const onStudent = await call('PATCH', `/admin/users/${dxbStudent._id}`, {
  jar: dxbJar, body: { sharedAcrossOrgs: true },
})
check('a STUDENT cannot be marked shared',
  onStudent.status === 400 && errOf(onStudent) === 'INVALID_SHARED_ROLE',
  `${onStudent.status} ${errOf(onStudent)}`)
const stillPlain = await UserModel.findById(dxbStudent._id).select('sharedAcrossOrgs').lean() as any
check('…and nothing was written',
  stillPlain?.sharedAcrossOrgs !== true, String(stillPlain?.sharedAcrossOrgs))

const ownLent = await mkUser('ownlent@x.local', 'instructor', dubai, { sharedAcrossOrgs: true })
const promote = await call('PATCH', `/admin/users/${ownLent._id}`, { jar: dxbJar, body: { role: 'admin' } })
check('a LENT instructor cannot be promoted while still lent',
  promote.status === 400 && errOf(promote) === 'INVALID_SHARED_ROLE',
  `${promote.status} ${errOf(promote)}`)
const stillLent = await UserModel.findById(ownLent._id).select('role sharedAcrossOrgs').lean() as any
check('…and the promotion did not half-happen',
  stillLent?.role === 'instructor' && stillLent?.sharedAcrossOrgs === true,
  `${stillLent?.role}/${stillLent?.sharedAcrossOrgs}`)

const bothAtOnce = await call('PATCH', `/admin/users/${ownLent._id}`, {
  jar: dxbJar, body: { role: 'admin', sharedAcrossOrgs: false },
})
check('un-lending and promoting in ONE save works — which is what the modal now sends',
  bothAtOnce.status === 200, `${bothAtOnce.status} ${errOf(bothAtOnce)}`)
const after = await UserModel.findById(ownLent._id).select('role sharedAcrossOrgs').lean() as any
check('…leaving no shared non-instructor behind',
  after?.role === 'admin' && after?.sharedAcrossOrgs !== true,
  `${after?.role}/${after?.sharedAcrossOrgs}`)

/* ── D ── what the borrowing academy may not do ────────────────────────── */
section('D. the borrowing academy administers a lent instructor, it does not re-classify them')
const borrowRole = await call('PATCH', `/admin/users/${lent._id}`, { jar: blrJar, body: { role: 'admin' } })
check('the BORROWING academy cannot promote them — that would mint an admin in the LENDING academy',
  borrowRole.status === 403 && errOf(borrowRole) === 'BORROWED_INSTRUCTOR',
  `${borrowRole.status} ${errOf(borrowRole)}`)
const borrowUnlend = await call('PATCH', `/admin/users/${lent._id}`, { jar: blrJar, body: { sharedAcrossOrgs: false } })
check('…nor un-lend them — the lending is the owner’s decision',
  borrowUnlend.status === 403 && errOf(borrowUnlend) === 'BORROWED_INSTRUCTOR',
  `${borrowUnlend.status} ${errOf(borrowUnlend)}`)
const borrowSame = await call('PATCH', `/admin/users/${lent._id}`, { jar: blrJar, body: { role: 'instructor' } })
check('…but an UNCHANGED role re-sent by the edit form is not a change and is allowed',
  borrowSame.status === 200, `${borrowSame.status} ${errOf(borrowSame)}`)
const borrowOrdinary = await call('PATCH', `/admin/users/${lent._id}`, { jar: blrJar, body: { headline: 'Visiting mentor' } })
check('…and an ordinary field still saves, which is what the carve-out is for',
  borrowOrdinary.status === 200, `${borrowOrdinary.status} ${errOf(borrowOrdinary)}`)
const stillShared = await UserModel.findById(lent._id).select('role sharedAcrossOrgs').lean() as any
check('the lent instructor came through all of that unchanged',
  stillShared?.role === 'instructor' && stillShared?.sharedAcrossOrgs === true,
  `${stillShared?.role}/${stillShared?.sharedAcrossOrgs}`)

/* ── E ── the lent instructor is a user too ────────────────────────────── */
section('E. the borrowing academy sees the lent instructor on every list, not just the filtered one')
const unfiltered = await call('GET', '/admin/users?per_page=100', { jar: blrJar })
const filtered   = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: blrJar })
const hasLent = (r: any) => (r.body?.data ?? []).some((u: any) => u.email === 'lent@x.local')
check('the unfiltered Users list includes them', hasLent(unfiltered),
  `${(unfiltered.body?.data ?? []).length} rows`)
check('the Instructors list includes them too — the two screens agree', hasLent(filtered))
const foreignNonInstructors = (unfiltered.body?.data ?? [])
  .filter((u: any) => String(u.organizationId) === String(dubai._id) && u.role !== 'instructor')
check('…and the widening admits ONLY lent instructors, never the other academy’s students or staff',
  foreignNonInstructors.length === 0,
  foreignNonInstructors.map((u: any) => `${u.email}[${u.role}]`).join(','))
const students = await call('GET', '/admin/users?role=student&per_page=100', { jar: blrJar })
check('a student list is still strictly this academy’s',
  (students.body?.data ?? []).every((u: any) => String(u.organizationId) === String(blr._id)))

/* ── F ── attendance on a cancelled seat ───────────────────────────────── */
section('F. a released seat cannot be marked attended')
const cancelled = await ClassBookingModel.create({
  userId: dxbStudent._id, liveClassId: dubaiOnly._id, status: 'cancelled',
  bookedAt: new Date(), cancelledAt: new Date(),
})
const markDead = await call('PATCH', `/admin/bookings/${cancelled._id}/attendance`, {
  jar: dxbJar, body: { status: 'attended' },
})
check('marking a cancelled seat is refused',
  markDead.status === 400 && errOf(markDead) === 'CANNOT_MARK',
  `${markDead.status} ${errOf(markDead)}`)
const deadStill = await ClassBookingModel.findById(cancelled._id).select('status').lean() as any
check('…and the seat was NOT resurrected',
  deadStill?.status === 'cancelled', String(deadStill?.status))
const liveSeat = await ClassBookingModel.create({
  userId: dxbStudent._id, liveClassId: dubaiOnly._id, status: 'booked', bookedAt: new Date(),
})
const markLive = await call('PATCH', `/admin/bookings/${liveSeat._id}/attendance`, {
  jar: dxbJar, body: { status: 'attended' },
})
check('a live seat still marks normally — the guard did not break attendance',
  markLive.status === 200, `${markLive.status} ${errOf(markLive)}`)

/* ── G ── an unchanged instructor is not an assignment ─────────────────── */
section('G. un-lending an instructor does not freeze the classes they already teach')
const borrowed = await LiveClassModel.create({
  courseId: blrCourse._id, instructorId: lent._id,
  title: 'Borrowed teacher session', scheduledStart: new Date(Date.now() + 120 * MIN),
  durationMins: 60, type: 'external', status: 'scheduled',
  organizationId: blr._id, sessionCapacity: 30, language: 'English',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
})
const beforeUnlend = await call('PATCH', `/admin/live-classes/${borrowed._id}`, {
  jar: blrJar, body: { title: 'Renamed while lent', instructorId: String(lent._id) },
})
check('baseline — the borrowing academy can edit it while the lending stands',
  beforeUnlend.status === 200, `${beforeUnlend.status} ${errOf(beforeUnlend)}`)

await UserModel.updateOne({ _id: lent._id }, { $set: { sharedAcrossOrgs: false } })
const afterUnlend = await call('PATCH', `/admin/live-classes/${borrowed._id}`, {
  jar: blrJar, body: { title: 'Renamed after the un-lend', instructorId: String(lent._id) },
})
check('and STILL can once the instructor is un-lent — re-sending the stored id is not a reassignment',
  afterUnlend.status === 200,
  `${afterUnlend.status} ${errOf(afterUnlend)} — a refusal here freezes the class forever`)

const moveToStudent = await call('PATCH', `/admin/live-classes/${borrowed._id}`, {
  jar: blrJar, body: { instructorId: String(blrStudent._id) },
})
check('…while naming a DIFFERENT, illegal instructor is still refused',
  moveToStudent.status >= 400, `${moveToStudent.status} ${errOf(moveToStudent)}`)
const reassign = await call('PATCH', `/admin/live-classes/${borrowed._id}`, {
  jar: blrJar, body: { instructorId: String(blrTeacher._id) },
})
check('…and reassigning to one of their own works, which is the way out',
  reassign.status === 200, `${reassign.status} ${errOf(reassign)}`)
await UserModel.updateOne({ _id: lent._id }, { $set: { sharedAcrossOrgs: true } })

/* ── H ── a copy of a shared class ─────────────────────────────────────── */
section('H. repeating a shared In-App Stream class')
const repeated = await call('POST', `/admin/live-classes/${shared._id}/repeat`, {
  jar: dxbJar, body: { weeks: 2 },
})
check('the academy that OWNS a shared class may repeat it without being a super admin',
  repeated.status === 201,
  `${repeated.status} ${errOf(repeated)} — 403 here means a shared class can never be weekly`)
const copies = await LiveClassModel.find({ title: 'Shared session', _id: { $ne: shared._id } })
  .select('provider type guestCohorts').lean() as any[]
check('…and two copies were made', copies.length === 2, String(copies.length))
check('…each still an In-App Stream on the SAME engine, not silently downgraded to Mux',
  copies.every(c => c.type === 'internal' && c.provider === 'livekit'),
  copies.map(c => `${c.type}/${c.provider}`).join(','))
check('…and each still shared with the guest academy',
  copies.every(c => (c.guestCohorts ?? []).length === 1
    && String(c.guestCohorts[0].organizationId) === String(blr._id)),
  copies.map(c => (c.guestCohorts ?? []).length).join(','))

/* ── I ── the programme narrowing ──────────────────────────────────────── */
section('I. a programme-scoped guest admin can see a class shared into their programme')
await mkUser('blrsub@x.local', 'sub_admin', blr, { program: 'ai' })
const subJar  = await login('blrsub@x.local', true)
const subList = await call('GET', '/admin/live-classes?limit=200', { jar: subJar })
const sawShared = (subList.body?.data ?? []).some((c: any) => String(c.id ?? c._id) === String(shared._id))
check('the shared class is on their list, reached through THEIR course',
  subList.status === 200 && sawShared,
  `${subList.status}, ${(subList.body?.data ?? []).length} rows — their programme owns the guest course, never the host’s`)
const dxbOnlyLeaked = (subList.body?.data ?? []).some((c: any) => String(c.id ?? c._id) === String(dubaiOnly._id))
check('…and the host academy’s UNSHARED class is not',
  !dxbOnlyLeaked, 'a widening that admits an unshared class is a leak, not a fix')

/* The list and the detail view asked the programme question of different
   courses, so the row was there and clicking it said Access denied. */
const subOpen = await call('GET', `/admin/live-classes/${shared._id}`, { jar: subJar })
check('…and OPENING it works too — the list and the detail view agree',
  subOpen.status === 200, `${subOpen.status} ${errOf(subOpen)}`)
const subOpenOther = await call('GET', `/admin/live-classes/${dubaiOnly._id}`, { jar: subJar })
check('…while the unshared one stays shut',
  subOpenOther.status >= 400, `${subOpenOther.status} ${errOf(subOpenOther)}`)

/* A DUBAI sub_admin must not inherit scope from BANGALORE's course. The guest
   arm is narrowed to cohorts serving the caller's own academy; without that
   narrowing this would open. */
await mkUser('dxbsub@x.local', 'sub_admin', dubai, { program: 'ai' })
const dxbSubJar  = await login('dxbsub@x.local', true)
const dxbSubOpen = await call('GET', `/admin/live-classes/${shared._id}`, { jar: dxbSubJar })
check('a HOST-academy sub_admin of another programme does not borrow the guest cohort’s scope',
  dxbSubOpen.status === 403, `${dxbSubOpen.status} ${errOf(dxbSubOpen)}`)

/* ── J ── un-gating a class from its module ────────────────────────────── */
section('J. a class can be let out of its module gate')
const gated = await LiveClassModel.create({
  courseId: dxbCourse._id, sectionId: dxbModule._id, instructorId: teacher._id,
  title: 'Gated session', scheduledStart: new Date(Date.now() + 200 * MIN),
  durationMins: 60, type: 'external', status: 'scheduled',
  organizationId: dubai._id, sessionCapacity: 30, language: 'English',
  meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc',
})
const ungate = await call('PATCH', `/admin/live-classes/${gated._id}`, {
  jar: dxbJar, body: { sectionId: '' },
})
check('"No specific module" is accepted rather than silently dropped',
  ungate.status === 200, `${ungate.status} ${errOf(ungate)}`)
const ungated = await LiveClassModel.findById(gated._id).select('sectionId').lean() as any
check('…and the gate is actually gone',
  !ungated?.sectionId, String(ungated?.sectionId))
const regate = await call('PATCH', `/admin/live-classes/${gated._id}`, {
  jar: dxbJar, body: { sectionId: String(dxbModule._id) },
})
const regated = await LiveClassModel.findById(gated._id).select('sectionId').lean() as any
check('…and naming a module again still works',
  regate.status === 200 && String(regated?.sectionId) === String(dxbModule._id),
  `${regate.status} ${String(regated?.sectionId)}`)
const badGate = await call('PATCH', `/admin/live-classes/${gated._id}`, {
  jar: dxbJar, body: { sectionId: 'not-an-id' },
})
check('…while a malformed module id is still refused — empty is a choice, junk is not',
  badGate.status === 400, `${badGate.status} ${errOf(badGate)}`)

/* Un-gating must lift the rule it imposes on the cohorts, in one request. */
const gatedShared = await LiveClassModel.create({
  courseId: dxbCourse._id, sectionId: dxbModule._id, instructorId: teacher._id,
  title: 'Gated and shared', scheduledStart: new Date(Date.now() + 260 * MIN),
  durationMins: 60, type: 'external', status: 'scheduled',
  organizationId: dubai._id, sessionCapacity: 30, language: 'English',
  meetingUrl: 'https://meet.google.com/ddd-eeee-fff',
  hostSeatsLeft: 20, overflowSeatsLeft: 0,
  guestCohorts: [{ organizationId: blr._id, courseId: blrCourse._id, sectionId: blrModule._id, seatFloor: 10, seatsLeft: 10 }],
})
const liftBoth = await call('PATCH', `/admin/live-classes/${gatedShared._id}`, {
  jar: superJar,
  body: { sectionId: '', guestCohorts: [{ organizationId: String(blr._id), courseId: String(blrCourse._id), seatFloor: 10 }] },
})
check('un-gating the class and its cohort together is one save, not a deadlock',
  liftBoth.status === 200, `${liftBoth.status} ${errOf(liftBoth)}`)
const lifted = await LiveClassModel.findById(gatedShared._id).select('sectionId guestCohorts').lean() as any
check('…and neither side is left gated',
  !lifted?.sectionId && !lifted?.guestCohorts?.[0]?.sectionId,
  `class ${String(lifted?.sectionId)} cohort ${String(lifted?.guestCohorts?.[0]?.sectionId)}`)

/* ── K ── an overflow on a first sharing ───────────────────────────────── */
section('K. a class shared for the first time from Edit can still set an overflow')
const unshared = await LiveClassModel.create({
  courseId: dxbCourse._id, instructorId: teacher._id,
  title: 'Not yet shared', scheduledStart: new Date(Date.now() + 320 * MIN),
  durationMins: 60, type: 'external', status: 'scheduled',
  organizationId: dubai._id, sessionCapacity: 30, language: 'English',
  meetingUrl: 'https://meet.google.com/ggg-hhhh-iii',
})
const shareNow = await call('PATCH', `/admin/live-classes/${unshared._id}`, {
  jar: superJar,
  body: {
    guestCohorts: [{ organizationId: String(blr._id), courseId: String(blrCourse._id), seatFloor: 10 }],
    overflowSeats: 5,
  },
})
check('the overflow is accepted on the request that first shares the class',
  shareNow.status === 200, `${shareNow.status} ${errOf(shareNow)}`)
const pools = await LiveClassModel.findById(unshared._id)
  .select('hostSeatsLeft overflowSeatsLeft guestCohorts sessionCapacity').lean() as any
check('…and it lands as unpromised seats rather than being absorbed into a floor',
  pools?.overflowSeatsLeft === 5, String(pools?.overflowSeatsLeft))
check('…with the room still adding up: host + guest floors + overflow = capacity',
  (pools?.hostSeatsLeft ?? 0) + (pools?.guestCohorts ?? []).reduce((n: number, c: any) => n + Number(c.seatFloor ?? 0), 0)
    + (pools?.overflowSeatsLeft ?? 0) === pools?.sessionCapacity,
  `${pools?.hostSeatsLeft} + floors + ${pools?.overflowSeatsLeft} vs ${pools?.sessionCapacity}`)
/* Two different refusals, and the test has to reach the one it means. An
   overflow sent ALONE never gets past the validator — withCohortRules refuses
   an overflow with no academy to share it with (422), which is why the modal
   only ever sends the pair. Sent WITH the cohorts it reaches the service, and
   that is where "the class is already allocated" is answered. */
const overflowAlone = await call('PATCH', `/admin/live-classes/${unshared._id}`, {
  jar: superJar, body: { overflowSeats: 9 },
})
check('an overflow with no academy behind it is refused at the validator',
  overflowAlone.status === 422, `${overflowAlone.status} ${errOf(overflowAlone)}`)
const overflowAgain = await call('PATCH', `/admin/live-classes/${unshared._id}`, {
  jar: superJar,
  body: {
    guestCohorts: [{ organizationId: String(blr._id), courseId: String(blrCourse._id), seatFloor: 10 }],
    overflowSeats: 9,
  },
})
check('…and on an ALLOCATED class the overflow is refused outright, which is why the box goes read-only',
  overflowAgain.status === 400 && errOf(overflowAgain) === 'OVERFLOW_NOT_EDITABLE',
  `${overflowAgain.status} ${errOf(overflowAgain)}`)
const unmoved = await LiveClassModel.findById(unshared._id).select('overflowSeatsLeft').lean() as any
check('…leaving the pools exactly where they were',
  unmoved?.overflowSeatsLeft === 5, String(unmoved?.overflowSeatsLeft))

/* ── L ── what the notification calls the course ───────────────────────── */
section('L. a guest student is told the name of THEIR course, not the host’s')
/* Driven through the SERVICE's create, because the notifier is a private method
   fired from there — and through the service rather than the route so no Google
   Meet link is minted. It is fire-and-forget, so the rows are polled for rather
   than awaited. */
const { NotificationModel } = await import('@/models/schema.ts')
await NotificationModel.deleteMany({})
const { LiveClassService } = await import('@/services/liveClass.service.ts')
const svc = new LiveClassService()
await svc.create({
  courseId:        String(dxbCourse._id),
  instructorId:    String(teacher._id),
  title:           'Announced session',
  scheduledStart:  new Date(Date.now() + 400 * MIN),
  durationMins:    60,
  type:            'external',
  meetingUrl:      'https://meet.google.com/jjj-kkkk-lll',
  sessionCapacity: 30,
  language:        'English',
  organizationId:  String(dubai._id),
  guestCohorts:    [{ organizationId: String(blr._id), courseId: String(blrCourse._id), seatFloor: 10 }],
  overflowSeats:   5,
})

let notes: any[] = []
for (let i = 0; i < 40 && notes.length < 2; i++) {
  notes = await NotificationModel.find({ kind: 'live-class-scheduled' }).select('userId title').lean() as any[]
  if (notes.length >= 2) break
  await new Promise(r => setTimeout(r, 50))
}
const forGuest = notes.find(n => String(n.userId) === String(blrStudent._id))
const forHost  = notes.find(n => String(n.userId) === String(dxbStudent._id))
check('both academies’ enrolled students are notified at all',
  !!forGuest && !!forHost,
  `${notes.length} rows: ${notes.map(n => String(n.title)).join(' | ')}`)
check('the guest academy’s student is told about their OWN course',
  /Bangalore AI/.test(String(forGuest?.title ?? '')),
  String(forGuest?.title) + ' — naming the host course here names one they cannot open')
check('…and the host academy’s student still reads the host course',
  /Dubai Forex/.test(String(forHost?.title ?? '')),
  String(forHost?.title))

} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
