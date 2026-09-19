/* ─────────────────────────────────────────────────────────────
   Cross-academy classes, OPEN (plan phase 6b).

   THE OWNER'S QUESTION, ANSWERED END TO END:

     "The class is created for the Dubai org, Digital Marketing course, 2nd
      module. The students who purchased that Dubai course module 2 can join —
      and ALSO Bangalore students who purchased the BANGALORE Digital Marketing
      course, 2nd module."

   Every other suite runs with the feature OFF, which is how the product ships.
   This one turns it on and drives the whole path over real HTTP: discovery,
   booking, seats, and the gate that matters most.

   THE GATE THAT MATTERS MOST is module blocking. A Bangalore admin revokes
   module 2 from a Bangalore student by writing a BANGALORE section id into
   their blockedLessons. If entitlement tested that student against the class's
   own DUBAI section id, the two ids could never match, MODULE_BLOCKED would
   never fire, and the revoked student would walk into the class with nothing in
   the logs. That is the failure every cheaper design ships, and it is asserted
   here directly.

   Run: bun run test:crossorgclass:open
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgclass_open'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* The one suite that opens the door. Set BEFORE the service module is
   imported, because the flag is read once at module load. */
process.env.CROSS_ORG_CLASSES = 'true'
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
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel, EnrollmentModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { CROSS_ORG_CLASSES_ENABLED } = await import('@/services/classEntitlement.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgclass_open') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise(r => server.once('listening', r))
const port = (server.address() as { port: number }).port
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.jar?.size) headers['Cookie'] = [...opts.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, {
    method, headers, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  })
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const [k, v] = (pair ?? '').split('=')
    if (k && v && opts.jar) opts.jar.set(k.trim(), v.trim())
  }
  let body: any = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}
const why = (r: { status: number; body: any }) =>
  `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 60)}`
const PW = 'TestPass123'

try {
  check('the feature is ON for this suite', CROSS_ORG_CLASSES_ENABLED === true)

  const hash = await hashPassword(PW)
  const dubai = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'BLR', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  const mk = (email: string, role: string, org: any, extra: object = {}) =>
    UserModel.create({
      name: email.split('@')[0], email, passwordHash: hash, role,
      isActive: true, isVerified: true, organizationId: org._id, ...extra,
    })
  const teacher = await mk('t@t.local', 'instructor', dubai)

  /* The brief, literally: the same programme sold separately by each academy. */
  const mkCourse = (t: string, org: any) => CourseModel.create({
    title: t, slug: `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'x', price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, instructorId: teacher._id,
    category: 'digital-marketing', program: 'digital-marketing',
  })
  const dCourse = await mkCourse('dxb-dm', dubai)
  const bCourse = await mkCourse('blr-dm', blr)
  const dMod2 = await SectionModel.create({ courseId: dCourse._id, title: 'Module 2', order: 2 })
  const bMod2 = await SectionModel.create({ courseId: bCourse._id, title: 'Module 2', order: 2 })

  /* Dubai's class, module 2, also serving Bangalore's module 2. */
  const cls = await LiveClassModel.create({
    courseId: dCourse._id, sectionId: dMod2._id, instructorId: teacher._id,
    title: 'DM module 2 live', type: 'external', meetingUrl: 'https://meet.example/dm',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
    organizationId: dubai._id, sessionCapacity: 6, bookedCount: 0,
    hostSeatsLeft: 3, overflowSeatsLeft: 1,
    guestCohorts: [{
      organizationId: blr._id, courseId: bCourse._id, sectionId: bMod2._id,
      seatFloor: 2, seatsLeft: 2,
    }],
  })

  const student = async (email: string, org: any, course: any, blocked: unknown[] = []) => {
    const u = await mk(email, 'student', org, { enrollmentStatus: 'approved', category: 'digital-marketing' })
    await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', blockedLessons: blocked })
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return { u, jar }
  }

  const dxbStudent = await student('dxb.s@t.local', dubai, dCourse)
  const blrStudent = await student('blr.s@t.local', blr, bCourse)
  /* Blocked on BANGALORE's module 2 — the id their own admin would write. */
  const blrBlocked = await student('blr.blocked@t.local', blr, bCourse, [bMod2._id])
  /* Enrolled in neither course. */
  const outsider   = await student('blr.out@t.local', blr, await mkCourse('blr-other', blr))

  const book = (jar: Jar) => call('POST', '/bookings', { jar, body: { liveClassId: String(cls._id) } })

  /* ═══════════════════════════════════════════════════════ */
  section('The owner-s question: both cohorts can book the same class')
  {
    const d = await book(dxbStudent.jar)
    check('the Dubai student who bought the Dubai module 2 books', d.status === 201, why(d))

    const b = await book(blrStudent.jar)
    check('the BANGALORE student who bought the BANGALORE module 2 books the SAME class',
      b.status === 201, why(b))

    const doc = await LiveClassModel.findById(cls._id).lean() as any
    check('and they drew from different academies-s seats',
      doc.hostSeatsLeft === 2 && doc.guestCohorts[0].seatsLeft === 1,
      `host ${doc.hostSeatsLeft}, guest ${doc.guestCohorts[0].seatsLeft}`)

    const seat = await ClassBookingModel.findOne({ userId: blrStudent.u._id, liveClassId: cls._id }).lean() as any
    check('the guest seat is stamped with the BANGALORE door',
      String(seat.seatOrganizationId) === String(blr._id)
      && String(seat.seatCourseId) === String(bCourse._id)
      && String(seat.seatSectionId) === String(bMod2._id),
      JSON.stringify({ o: String(seat.seatOrganizationId), c: String(seat.seatCourseId) }))
  }

  /* ═══════════════════════════════════════════════════════
     THE GATE THAT MATTERS MOST.
     ═══════════════════════════════════════════════════════ */
  section('Each academy-s OWN module blocking still bites')
  {
    const r = await book(blrBlocked.jar)
    check('a Bangalore student blocked on BANGALORE module 2 is refused',
      r.status === 403 && r.body?.error?.code === 'MODULE_BLOCKED', why(r))

    /* The cheaper designs fail exactly here: they would compare this student
       against the class's DUBAI section id, which is in nobody's Bangalore
       blocked list, so the gate would silently pass. */
    const blockedIds = (await EnrollmentModel.findOne({ userId: blrBlocked.u._id }).lean() as any).blockedLessons.map(String)
    check('and the id that blocked them is BANGALORE-s, not the class-s own',
      blockedIds.includes(String(bMod2._id)) && !blockedIds.includes(String(dMod2._id)),
      blockedIds.join(','))
  }

  section('Somebody enrolled in neither course is still refused')
  {
    const r = await book(outsider.jar)
    check('a student of the right academy but the wrong course gets NOT_ENROLLED',
      r.status === 403 && r.body?.error?.code === 'NOT_ENROLLED', why(r))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Discovery: the guest finds it on their OWN course page')
  {
    const r = await call('GET', `/courses/${(await CourseModel.findById(bCourse._id).lean() as any).slug}/live-classes`,
      { jar: blrStudent.jar })
    const titles = (r.body?.data ?? []).map((c: any) => String(c.title))
    check('the shared class appears on the Bangalore course page',
      titles.includes('DM module 2 live'), `${why(r)} ${titles.join(' | ')}`)

    const sched = await call('GET', '/live-classes', { jar: blrStudent.jar })
    const schedTitles = (sched.body?.data ?? []).map((c: any) => String(c.title))
    check('and on their schedule list', schedTitles.includes('DM module 2 live'), schedTitles.join(' | '))

    /* The third discovery surface. upcomingfeed.suite.ts asserts the mirror of
       this with the switch off: the same class is invisible there. Together the
       two pin that the switch governs discovery and entitlement alike. */
    const up = await call('GET', '/live-classes/upcoming?limit=100', { jar: blrStudent.jar })
    const upTitles = (up.body?.data ?? []).map((c: any) => String(c.title))
    check('and in the browse feed', upTitles.includes('DM module 2 live'), upTitles.join(' | '))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('One academy-s floor cannot be eaten by the other')
  {
    /* Dubai has 2 of its 3 left, Bangalore 1 of 2, overflow 1. Fill Dubai. */
    const d2 = await student('dxb.s2@t.local', dubai, dCourse)
    const d3 = await student('dxb.s3@t.local', dubai, dCourse)
    const d4 = await student('dxb.s4@t.local', dubai, dCourse)
    check('Dubai takes its remaining floor', (await book(d2.jar)).status === 201)
    check('and the rest of it', (await book(d3.jar)).status === 201)
    check('then the shared overflow', (await book(d4.jar)).status === 201)

    const d5 = await student('dxb.s5@t.local', dubai, dCourse)
    const full = await book(d5.jar)
    check('and then Dubai is full', full.status === 400 && full.body?.error?.code === 'SESSION_FULL', why(full))

    const b2 = await student('blr.s2@t.local', blr, bCourse)
    const stillIn = await book(b2.jar)
    check('but Bangalore-s last promised seat is still there — the whole point of a floor',
      stillIn.status === 201, why(stillIn))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A student-s programme is judged against their OWN door')
  {
    /* WHY THIS WAS INVISIBLE UNTIL A REAL CLASS WAS MADE. Every fixture above
       gives BOTH academies a course with the same `program`, so the feed's
       category filter matched on the HOST course and the guest arm was never
       exercised. Two academies author their courses independently; there is no
       reason their programmes agree, and in the case that found this the Dubai
       course carried none at all.

       The filter narrowed on `courseId` — the class's HOST course — so a
       Bangalore student whose category matched their OWN course still lost the
       class, because the Dubai course it was filtered on carried a different
       programme. Bookable and invisible: the one rule this feature rests on,
       never compare a value from one door against a value from another, broken
       in discovery while entitlement got it right. */
    const hostCourse = await CourseModel.create({
      title: 'dxb-forex', slug: `dxb-forex-${Date.now()}`, description: 'x',
      price: 0, isFree: true, status: 'published', language: 'English',
      organizationId: dubai._id, instructorId: teacher._id,
      /* DELIBERATELY DIFFERENT from the guest course below. */
      category: '4x-trading', program: '4x-trading',
    })
    const guestCourse = await CourseModel.create({
      title: 'blr-ai', slug: `blr-ai-${Date.now()}`, description: 'x',
      price: 0, isFree: true, status: 'published', language: 'English',
      organizationId: blr._id, instructorId: teacher._id,
      category: 'ai', program: 'ai',
    })

    const shared = await LiveClassModel.create({
      courseId: hostCourse._id, instructorId: teacher._id,
      title: 'Cross-programme shared class', type: 'external',
      meetingUrl: 'https://meet.example/x',
      scheduledStart: new Date(Date.now() + 3 * 3600_000), durationMins: 60,
      organizationId: dubai._id, sessionCapacity: 10, bookedCount: 0,
      hostSeatsLeft: 6, overflowSeatsLeft: 0,
      guestCohorts: [{ organizationId: blr._id, courseId: guestCourse._id,
                       seatFloor: 4, seatsLeft: 4 }],
    })

    /* Their category matches their OWN course, and nothing else. */
    const pupil = await student('blr.ai@t.local', blr, guestCourse)
    await UserModel.updateOne({ _id: pupil.u._id }, { $set: { category: 'ai' } })

    const up = await call('GET', '/live-classes/upcoming?limit=100', { jar: pupil.jar })
    const titles = (up.body?.data ?? []).map((c: any) => String(c.title))
    check('the shared class survives a category filter it only matches through its GUEST course',
      titles.includes('Cross-programme shared class'),
      `${why(up)}  saw: ${titles.join(' | ') || '(nothing)'}`)

    /* And the narrowing still narrows: a category matching NEITHER course must
       not admit it, or the fix has simply disabled the filter. */
    await UserModel.updateOne({ _id: pupil.u._id }, { $set: { category: 'jura' } })
    const off = await call('GET', '/live-classes/upcoming?limit=100', { jar: pupil.jar })
    const offTitles = (off.body?.data ?? []).map((c: any) => String(c.title))
    check('and an unrelated category still filters it out',
      !offTitles.includes('Cross-programme shared class'), offTitles.join(' | '))

    /* The host academy is unaffected either way. */
    await UserModel.updateOne({ _id: pupil.u._id }, { $set: { category: 'ai' } })
    const dxb = await student('dxb.forex@t.local', dubai, hostCourse)
    await UserModel.updateOne({ _id: dxb.u._id }, { $set: { category: '4x-trading' } })
    const host = await call('GET', '/live-classes/upcoming?limit=100', { jar: dxb.jar })
    const hostTitles = (host.body?.data ?? []).map((c: any) => String(c.title))
    check('the host academy still finds it on its own course-s programme',
      hostTitles.includes('Cross-programme shared class'), hostTitles.join(' | '))

    void shared
  }

  console.log(lines.join('\n'))
  console.log(`\ncrossorgclass.open.suite — ${pass} passed, ${failures.length} failed`)
  if (failures.length) console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n'))
  server.close()
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
} catch (err) {
  console.error(err)
  try { server.close(); await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
  process.exit(1)
}
