/* ─────────────────────────────────────────────────────────────
   Cross-academy instructors — the parts the first suite did not reach.

   crossorginstructor.suite.ts proves VISIBILITY and the CRUD carve-out. It
   never actually SCHEDULES anything, which is the whole point of lending an
   instructor (requirement 4). This suite drives the real endpoints:

     · scheduling a class for a lent instructor from the borrowing academy;
     · every role, in both directions;
     · the super_admin org switcher (X-Organization-Id);
     · the full toggle lifecycle — off at create, on later, off again while a
       class already exists;
     · whether the widening leaked into any OTHER list;
     · determinism — the same assertions run twice against the same fixtures.

   It also covers what class creation validates about instructorId. Those
   three cases were recorded here as OBSERVED behaviour first, because
   liveClass.service.create() cast instructorId straight to an ObjectId
   without checking the academy, the role, or that the user exists at all.
   That predated this feature. It is now fixed in
   liveClass.service.ts #assertInstructorUsable, and the observations have
   become assertions, joined by the two behaviours the fix deliberately KEEPS:
   a non-instructor staff caller may still host their own session, and a lent
   instructor is still schedulable from the borrowing academy.

   Run: bun run test:crossorg:deep
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorg_deep_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''; process.env.R2_PUBLIC_URL = ''
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
export {}

let pass = 0
const failures: string[] = []
const notes: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
/* Behaviour that is real, pre-existing and worth reporting, but is not this
   feature's contract — recorded rather than failed. */
function observe(label: string, detail: string) {
  notes.push(`${label} — ${detail}`)
  lines.push(`  NOTE  ${label}  — ${detail}`)
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, LiveClassModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorg_deep_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; org?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.org) headers['x-organization-id'] = opts.org
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
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 70)}`
const PW = 'CorrectHorse1'
const ids = (b: any): string[] => {
  const rows = b?.data?.items ?? b?.data?.users ?? b?.data ?? []
  return (Array.isArray(rows) ? rows : []).map((u: any) => String(u.id ?? u._id))
}
const soon = () => new Date(Date.now() + 7 * 86_400_000).toISOString()

try {
  const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash  = await hashPassword(PW)
  const mk = (email: string, role: string, org: any, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org._id, ...extra })

  const AI = { category: 'ai', categories: ['ai'] }

  const superAdmin = await UserModel.create({ name: 'root', email: 'root@t.local', passwordHash: hash, role: 'super_admin', isActive: true, isVerified: true })
  const dAdmin  = await mk('d.admin@t.local',  'admin',     dubai)
  const bAdmin  = await mk('b.admin@t.local',  'admin',     blr)
  const bSub    = await mk('b.sub@t.local',    'sub_admin', blr, { program: 'ai' })
  const bSupport= await mk('b.support@t.local','support',   blr)

  const lent = await mk('lent@t.local', 'instructor', dubai, { sharedAcrossOrgs: true, ...AI })
  const kept = await mk('kept@t.local', 'instructor', dubai, AI)
  const bOwn = await mk('b.own@t.local','instructor', blr,   AI)
  const bStudent = await mk('b.student@t.local', 'student', blr, { enrollmentStatus: 'approved', ...AI })
  /* A Dubai student exists purely so the borrowing academy can try to probe
     for them: a foreign record must answer exactly what a missing one does. */
  const dStudent = await mk('d.student@t.local', 'student', dubai, { enrollmentStatus: 'approved', ...AI })

  /* A Bangalore course — the class the borrowing academy will schedule. */
  const bCourse = await CourseModel.create({
    title: 'BLR Course', slug: `blr-course-${Date.now()}`, description: 'x',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: bOwn._id, organizationId: blr._id, category: 'ai',
    /* `program`, not `category` — liveClass.controller.ts compares the
       sub-admin's categoryScope against course.program (free-form string), and
       a course without it is refused for every programme-scoped caller. */
    program: 'ai',
  })

  /* A Dubai course. The lent instructor needs a class in BOTH academies for
     the next section to mean anything: one at home, one where they are lent. */
  const dCourse = await CourseModel.create({
    title: 'DXB Course', slug: `dxb-course-${Date.now()}`, description: 'x',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: kept._id, organizationId: dubai._id, category: 'ai',
    program: 'ai',
  })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`admin login ${email} → ${why(r)}`)
    return jar
  }
  const ROOT = await login('root@t.local')
  const D    = await login('d.admin@t.local')
  const B    = await login('b.admin@t.local')
  const BSUB = await login('b.sub@t.local')
  const BSUP = await login('b.support@t.local')

  const lentId = String(lent._id), keptId = String(kept._id)

  /* ═══════════════════════════════════════════════════════
     THE ACTUAL REQUIREMENT: schedule a class for a lent instructor
     ═══════════════════════════════════════════════════════ */
  section('Requirement 4 — the borrowing academy can schedule for a lent instructor')
  {
    const made = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Lent instructor teaches BLR',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: lentId, language: 'English',
    } })
    check('a Bangalore admin can schedule a Dubai-owned LENT instructor', made.status === 201, why(made))

    if (made.status === 201) {
      const id = String(made.body?.data?.id ?? made.body?.data?._id)
      const doc = await LiveClassModel.findById(id).lean() as any
      check('the class records the lent instructor', String(doc?.instructorId) === lentId)
      /* The class belongs to the academy of its COURSE — lending a person does
         not lend the class. This is the boundary that keeps students apart. */
      check('and belongs to BANGALORE, not to the lender',
        String(doc?.organizationId) === String(blr._id), String(doc?.organizationId))

      const bList = await call('GET', '/admin/live-classes', { jar: B })
      check('it appears in the borrowing academy list', ids(bList.body).includes(id), why(bList))
      const dList = await call('GET', '/admin/live-classes', { jar: D })
      check('and NOT in the lending academy list — the class was not shared',
        !ids(dList.body).includes(id))
    }

    const sub = await call('POST', '/admin/live-classes', { jar: BSUB, body: {
      courseId: String(bCourse._id), title: 'Sub schedules lent instructor',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: lentId, language: 'English',
    } })
    check('a borrowing SUB-ADMIN can schedule too (view + schedule, per the brief)',
      sub.status === 201, why(sub))
  }

  /* ══════════════════════════════════════════════════════
     What class creation checks about instructorId
     ══════════════════════════════════════════════════════

     These three were NOTEs until liveClass.service.ts grew
     #assertInstructorUsable. The exact code is asserted, not just the refusal:
     a cross-academy id and a missing id must be INDISTINGUISHABLE, or the
     error message becomes an oracle for which ids exist in the other academy.
     ══════════════════════════════════════════════════════ */
  section('Class creation validates instructorId')
  {
    const unshared = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Unshared cross-org instructor',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: keptId, language: 'English',
    } })
    check('an UNSHARED cross-academy instructor is refused',
      unshared.status === 404 && unshared.body?.error?.code === 'INSTRUCTOR_NOT_FOUND', why(unshared))

    const asStudent = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'A student as instructor',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: String(bStudent._id), language: 'English',
    } })
    check("a STUDENT's id is refused as instructorId",
      asStudent.status === 400 && asStudent.body?.error?.code === 'INSTRUCTOR_NOT_STAFF', why(asStudent))

    const ghost = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Nonexistent instructor',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: '6aaaaaaaaaaaaaaaaaaaaaaa', language: 'English',
    } })
    check('an instructorId that matches NO user is refused',
      ghost.status === 404 && ghost.body?.error?.code === 'INSTRUCTOR_NOT_FOUND', why(ghost))

    check('a foreign id and a missing id are indistinguishable',
      unshared.status === ghost.status &&
      unshared.body?.error?.code === ghost.body?.error?.code, `${why(unshared)} vs ${why(ghost)}`)

    /* The role rule must not answer before the tenancy rule. If it did, a
       borrowing admin could tell "exists, and is a student in Dubai" from
       "does not exist" by the error code alone. */
    const foreignStudent = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Another academy-s student',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: String(dStudent._id), language: 'English',
    } })
    check("another academy's student is refused as NOT FOUND, not as NOT STAFF",
      foreignStudent.status === ghost.status &&
      foreignStudent.body?.error?.code === ghost.body?.error?.code,
      `${why(foreignStudent)} vs ${why(ghost)}`)

    const garbage = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Unparseable instructor',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: 'not-an-object-id', language: 'English',
    } })
    check('an unparseable instructorId is refused before Google is called',
      garbage.status === 400 && garbage.body?.error?.code === 'INVALID_INSTRUCTOR_ID', why(garbage))

    /* The bypass the create-side check would otherwise have. */
    const ok = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Legitimate, then repointed',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: lentId, language: 'English',
    } })
    check('a lent instructor is still schedulable from the borrowing academy',
      ok.status === 201, why(ok))

    if (ok.status === 201) {
      const id = String(ok.body?.data?.id ?? ok.body?.data?._id ?? '')
      const repoint = await call('PATCH', `/admin/live-classes/${id}`, {
        jar: B, body: { instructorId: String(bStudent._id) },
      })
      check('PATCH cannot repoint a class onto a student',
        repoint.status === 400 && repoint.body?.error?.code === 'INSTRUCTOR_NOT_STAFF', why(repoint))

      const repointForeign = await call('PATCH', `/admin/live-classes/${id}`, {
        jar: B, body: { instructorId: keptId },
      })
      check('PATCH cannot repoint a class onto an unshared foreign instructor',
        repointForeign.status === 404, why(repointForeign))
    }

    /* KEPT ON PURPOSE. The rule is "not a student", not "is an instructor":
       the admin form omits instructorId for a session the caller will host
       themselves, and the controller defaults it to the caller's own id. */
    const selfHosted = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Admin hosts this one',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      language: 'English',
    } })
    check('an admin scheduling a session for themselves is still allowed',
      selfHosted.status === 201, why(selfHosted))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Every role, both directions')
  {
    const cases: Array<[string, Jar, boolean]> = [
      ['super_admin',          ROOT, true],
      ['lending admin',        D,    true],
      ['borrowing admin',      B,    true],
      ['borrowing sub_admin',  BSUB, true],
      ['borrowing support',    BSUP, true],
    ]
    for (const [name, jar, shouldSee] of cases) {
      const r = await call('GET', '/admin/users?role=instructor&per_page=100', { jar })
      const seen = ids(r.body).includes(lentId)
      check(`${name} ${shouldSee ? 'sees' : 'does not see'} the lent instructor`,
        seen === shouldSee, `${why(r)} seen=${seen}`)
    }

    /* The unshared one is the control on every single role. */
    for (const [name, jar] of [['borrowing admin', B], ['borrowing sub_admin', BSUB], ['borrowing support', BSUP]] as Array<[string, Jar]>) {
      const r = await call('GET', '/admin/users?role=instructor&per_page=100', { jar })
      check(`${name} still cannot see the UNSHARED instructor`, !ids(r.body).includes(keptId), why(r))
    }
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Super admin org switcher')
  {
    const asDubai = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: ROOT, org: String(dubai._id) })
    check('viewing Dubai shows both its instructors',
      ids(asDubai.body).includes(lentId) && ids(asDubai.body).includes(keptId), why(asDubai))

    const asBlr = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: ROOT, org: String(blr._id) })
    check('viewing Bangalore shows the lent one', ids(asBlr.body).includes(lentId), why(asBlr))
    check('and Bangalore-s own', ids(asBlr.body).includes(String(bOwn._id)))
    check('but not the unshared Dubai one', !ids(asBlr.body).includes(keptId),
      'the org switcher leaked an unshared record')
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Toggle lifecycle')
  {
    /* Off at create, lent later. */
    const created = await call('POST', '/admin/users', { jar: D, body: {
      name: 'Later Lent', email: `later.${Date.now()}@t.local`, password: PW,
      role: 'instructor', category: 'ai',
    } })
    check('an instructor can be created unshared', created.status === 201, why(created))
    const laterId = String(created.body?.data?.id)

    const before = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: B })
    check('and starts invisible to the other academy', !ids(before.body).includes(laterId))

    const lend = await call('PATCH', `/admin/users/${laterId}`, { jar: D, body: { sharedAcrossOrgs: true } })
    check('the owner can lend them afterwards', lend.status === 200, why(lend))
    const after = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: B })
    check('and they become visible immediately', ids(after.body).includes(laterId), why(after))

    /* Un-lend while a class exists in the borrowing academy. */
    const cls = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Class before un-lending',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: laterId, language: 'English',
    } })
    check('the borrowing academy schedules them', cls.status === 201, why(cls))

    const unlend = await call('PATCH', `/admin/users/${laterId}`, { jar: D, body: { sharedAcrossOrgs: false } })
    check('the owner can un-lend', unlend.status === 200, why(unlend))
    const gone = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: B })
    check('they disappear from the borrowing academy list', !ids(gone.body).includes(laterId), why(gone))

    /* The class does not vanish with them — it belongs to Bangalore. */
    const stillThere = await LiveClassModel.findById(String(cls.body?.data?.id ?? cls.body?.data?._id)).lean() as any
    if (stillThere) {
      observe('un-lending leaves the already-scheduled class in place',
        'the class still names an instructor the borrowing academy can no longer see or manage — flagged in the plan as a sharp edge')
    }

    /* And the borrowing admin loses CRUD the moment the grant is withdrawn. */
    const editAfter = await call('PATCH', `/admin/users/${laterId}`, { jar: B, body: { headline: 'nope' } })
    check('and the borrowing admin immediately loses CRUD', editAfter.status === 404, why(editAfter))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('The widening did not leak into any other list')
  {
    for (const role of ['student', 'admin', 'sub_admin', 'support']) {
      const r = await call('GET', `/admin/users?role=${role}&per_page=100`, { jar: B })
      const dubaiIds = [String(dAdmin._id), String(kept._id), String(lent._id)]
      const leaked = ids(r.body).filter(i => dubaiIds.includes(i))
      check(`the ${role} list shows no Dubai record`, leaked.length === 0, leaked.join(','))
    }
    /* No role filter at all — the widest possible query. */
    const all = await call('GET', '/admin/users?per_page=200', { jar: B })
    check('an unfiltered user list still shows no unshared Dubai instructor',
      !ids(all.body).includes(keptId), why(all))
    observe('an unfiltered list DOES include the lent instructor',
      ids(all.body).includes(lentId)
        ? 'expected — the widening is keyed on the record, not on the role filter'
        : 'not present; the widening only applies when role=instructor is passed')
  }

  /* ═══════════════════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════════
     THE LENT INSTRUCTOR'S OWN VIEW

     Lending an instructor is pointless if the person lent cannot see, open or
     run the class they were lent out to teach. Every guard below used to ask
     the ACADEMY question before the ASSIGNMENT question, and a lent
     instructor's borrowed-academy sessions sit on the far side of their own
     academy by design — so the list hid them, the studio 404'd, and
     attendance could not be marked.

     The rule these now share is instructorOwnsSession() in utils/tenancy.ts:
     for the instructor a session NAMES, assignment is the authority. The
     negatives at the end of this block are the point — the carve-out is
     assignment-gated, not role-gated, and it widens nothing else.
     ═══════════════════════════════════════════════════════ */
  section('A lent instructor can see and run their borrowed-academy class')
  {
    /* Home academy: Dubai owns the lent instructor and schedules for them. */
    const atHome = await call('POST', '/admin/live-classes', { jar: D, body: {
      courseId: String(dCourse._id), title: 'Lent instructor teaches DXB',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: lentId, language: 'English',
    } })
    check('the owning academy can schedule its own instructor', atHome.status === 201, why(atHome))

    /* Borrowing academy: Bangalore schedules the same person. */
    const borrowed = await call('POST', '/admin/live-classes', { jar: B, body: {
      courseId: String(bCourse._id), title: 'Lent instructor teaches BLR again',
      scheduledStart: soon(), durationMins: 60, type: 'external',
      instructorId: lentId, language: 'English',
    } })
    check('the borrowing academy can schedule the lent instructor', borrowed.status === 201, why(borrowed))

    const homeId     = String(atHome.body?.data?.id   ?? atHome.body?.data?._id   ?? '')
    const borrowedId = String(borrowed.body?.data?.id ?? borrowed.body?.data?._id ?? '')

    const LENT = await login('lent@t.local')
    const OWN  = await login('b.own@t.local')

    /* ── The reported symptom ── */
    const mine = await call('GET', '/admin/live-classes', { jar: LENT })
    const mineIds = (mine.body?.data ?? []).map((c: any) => String(c.id ?? c._id))
    check('the lent instructor sees their OWN academy-s class',
      mineIds.includes(homeId), why(mine))
    check('the lent instructor ALSO sees the borrowing academy-s class',
      mineIds.includes(borrowedId), `${why(mine)} got ${mineIds.length} rows`)

    /* ── Opening and editing it ── */
    const open = await call('GET', `/admin/live-classes/${borrowedId}`, { jar: LENT })
    check('the lent instructor can open the borrowed class', open.status === 200, why(open))

    const edit = await call('PATCH', `/admin/live-classes/${borrowedId}`, {
      jar: LENT, body: { title: 'Renamed by the lent instructor' },
    })
    check('the lent instructor can edit the borrowed class', edit.status === 200, why(edit))

    /* ── The roster and attendance ── */
    const { ClassBookingModel } = await import('@/models/schema.ts')
    const seat = await ClassBookingModel.create({
      userId: bStudent._id, liveClassId: borrowedId, status: 'booked',
    })

    const roster = await call('GET', `/admin/bookings?liveClassId=${borrowedId}`, { jar: LENT })
    const rosterIds = (roster.body?.data ?? []).map((b: any) => String(b.id ?? b._id))
    check('the lent instructor can see who booked the borrowed class',
      roster.status === 200 && rosterIds.includes(String(seat._id)), why(roster))

    const mark = await call('PATCH', `/admin/bookings/${String(seat._id)}/attendance`, {
      jar: LENT, body: { status: 'attended' },
    })
    check('the lent instructor can mark attendance on the borrowed class',
      mark.status === 200, why(mark))

    /* ══ NEGATIVES — the carve-out is assignment-gated, not role-gated ══ */

    /* Another academy's instructor, not assigned, must still be walled out. */
    const theirs = await call('GET', '/admin/live-classes', { jar: OWN })
    const theirIds = (theirs.body?.data ?? []).map((c: any) => String(c.id ?? c._id))
    check('an UNASSIGNED instructor does not see the lent instructor-s classes',
      !theirIds.includes(homeId) && !theirIds.includes(borrowedId), why(theirs))

    const peek = await call('GET', `/admin/live-classes/${homeId}`, { jar: OWN })
    check('an UNASSIGNED instructor cannot open a class in the other academy',
      peek.status === 404, why(peek))

    const peekSame = await call('GET', `/admin/live-classes/${borrowedId}`, { jar: OWN })
    check('nor a colleague-s class inside their OWN academy',
      peekSame.status === 403, why(peekSame))

    const steal = await call('PATCH', `/admin/bookings/${String(seat._id)}/attendance`, {
      jar: OWN, body: { status: 'missed' },
    })
    check('an UNASSIGNED instructor cannot mark attendance on it',
      steal.status === 404, why(steal))

    /* The academy wall still stands for ADMINS — this is the clause that was
       dropped for instructors, and dropping it for admins would hand each
       academy the other-s timetable. */
    const bAdminList = await call('GET', '/admin/live-classes', { jar: B })
    const bAdminIds = (bAdminList.body?.data ?? []).map((c: any) => String(c.id ?? c._id))
    check('a borrowing-academy ADMIN still cannot see the Dubai class',
      !bAdminIds.includes(homeId), why(bAdminList))
    check('but does see the class in their own academy',
      bAdminIds.includes(borrowedId), why(bAdminList))

    const dAdminList = await call('GET', '/admin/live-classes', { jar: D })
    const dAdminIds = (dAdminList.body?.data ?? []).map((c: any) => String(c.id ?? c._id))
    check('a lending-academy ADMIN still cannot see the Bangalore class',
      !dAdminIds.includes(borrowedId), why(dAdminList))
  }

  section('Determinism — the same reads twice')
  {
    const a1 = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: B })
    const a2 = await call('GET', '/admin/users?role=instructor&per_page=100', { jar: B })
    check('two identical reads return the same set',
      JSON.stringify(ids(a1.body).sort()) === JSON.stringify(ids(a2.body).sort()))

    const s1 = await call('GET', '/admin/users?role=instructor&search=lent&per_page=100', { jar: B })
    const s2 = await call('GET', '/admin/users?role=instructor&search=lent&per_page=100', { jar: B })
    check('and so do two identical searches',
      JSON.stringify(ids(s1.body).sort()) === JSON.stringify(ids(s2.body).sort()))
    check('the search still finds the lent instructor', ids(s1.body).includes(lentId), why(s1))
  }

} catch (err) {
  failures.push(`suite threw — ${(err as Error).message}`)
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
if (notes.length) {
  console.log('\nOBSERVED (pre-existing or worth a decision, not this feature\'s contract):')
  for (const n of notes) console.log(`  · ${n}`)
}
console.log(`\n${pass} passed, ${failures.length} failed, ${notes.length} noted`)
process.exit(failures.length === 0 ? 0 : 1)
