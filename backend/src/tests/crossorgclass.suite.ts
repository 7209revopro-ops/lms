/* ─────────────────────────────────────────────────────────────
   Cross-academy classes — the shape rules (plan phase 2).

   A class may name GUEST COHORTS: other academies it also serves, each
   through THAT academy's own course and that course's own module. This suite
   pins the authoring rules, and one property that matters more than all of
   them: in this phase a cohort can be AUTHORED and no guest can BOOK.

   Authoring without booking is inert. Booking without the roster split would
   put a guest academy's students into the host's export. So the order is not
   cosmetic, and this suite is where it is enforced.

   Driven at the service layer rather than over HTTP, because the admin route
   does not accept cohorts yet — that arrives with the form.

   Run: bun run test:crossorgclass
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_crossorgclass_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
/* PINNED OFF. This suite's whole subject is the DARK state, so it must not
   inherit whatever the operator happens to have exported — running the chain
   with CROSS_ORG_CLASSES=true made three assertions here fail and stopped the
   run before 37 later suites executed. Its sibling crossorgclass.open.suite.ts
   pins the same variable ON for the same reason. */
process.env.CROSS_ORG_CLASSES = ''
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/** Run a thunk and return the LiveClassError code it threw, or null. */
async function codeFrom(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null } catch (e: any) { return e?.code ?? e?.message ?? 'THREW' }
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const {
  UserModel, OrganizationModel, CourseModel, SectionModel, LiveClassModel,
} = await import('@/models/schema.ts')
const { LiveClassService } = await import('@/services/liveClass.service.ts')
const { CROSS_ORG_CLASSES_ENABLED, resolveClassEntitlement } =
  await import('@/services/classEntitlement.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_crossorgclass_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

try {
  const svc = new LiveClassService()

  const dubai = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await OrganizationModel.create({ name: 'BLR', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  const instructor = await UserModel.create({
    name: 'Teacher', email: 'teacher@t.local', passwordHash: 'x',
    role: 'instructor', isActive: true, isVerified: true, organizationId: dubai._id,
  })

  const mkCourse = (title: string, org: any) => CourseModel.create({
    title, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Math.abs(title.length * 7919)}`,
    description: 'x', price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, category: 'digital-marketing', program: 'digital-marketing',
    instructorId: instructor._id,
  })

  /* The scenario from the brief: the same programme, sold separately by each
     academy, each with its own module 2. */
  const dCourse = await mkCourse('DXB Digital Marketing', dubai)
  const bCourse = await mkCourse('BLR Digital Marketing', blr)
  const otherD  = await mkCourse('DXB Forex', dubai)

  const mkSection = (title: string, course: any, order: number) =>
    SectionModel.create({ courseId: course._id, title, order })

  const dModule2 = await mkSection('Module 2', dCourse, 2)
  const bModule2 = await mkSection('Module 2', bCourse, 2)
  const otherSec = await mkSection('Module 1', otherD, 1)

  const base = {
    courseId: String(dCourse._id), instructorId: String(instructor._id),
    title: 'DM module 2', durationMins: 60, type: 'external' as const,
    meetingUrl: 'https://meet.example/abc', language: 'English',
    organizationId: String(dubai._id),
  }
  const soon = () => new Date(Date.now() + 86_400_000)

  const cohort = (over: Record<string, unknown> = {}) => ({
    organizationId: String(blr._id),
    courseId:       String(bCourse._id),
    sectionId:      String(bModule2._id),
    seatFloor:      10,
    ...over,
  })

  /* ═══════════════════════════════════════════════════════ */
  section('A module must belong to the course it gates (pre-existing hole, now closed)')
  {
    const code = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(otherSec._id),
    }))
    check('a host module from ANOTHER course is refused',
      code === 'SECTION_NOT_IN_COURSE', String(code))

    const ok = await svc.create({ ...base, scheduledStart: soon(), sectionId: String(dModule2._id) })
    check('the course-s own module is accepted', !!ok?.id)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Guest cohort validation')
  {
    const ownAcademy = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort({ organizationId: String(dubai._id), courseId: String(dCourse._id), sectionId: String(dModule2._id) })],
    }))
    check('an academy cannot be a guest of itself', ownAcademy === 'INVALID_COHORT', String(ownAcademy))

    const dupe = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort(), cohort()],
    }))
    check('the same academy cannot appear twice', dupe === 'INVALID_COHORT', String(dupe))

    /* A Dubai course named as BANGALORE's cohort course. Answered 404 with the
       same code a missing course gets, so the error cannot be used to discover
       which ids exist in the other academy. */
    const foreignCourse = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort({ courseId: String(dCourse._id), sectionId: String(dModule2._id) })],
    }))
    check('a course from the wrong academy is refused as NOT FOUND',
      foreignCourse === 'COHORT_NOT_FOUND', String(foreignCourse))

    const missingCourse = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort({ courseId: '6aaaaaaaaaaaaaaaaaaaaaaa', sectionId: String(bModule2._id) })],
    }))
    check('and a course that does not exist answers identically',
      missingCourse === foreignCourse, `${missingCourse} vs ${foreignCourse}`)

    const foreignSection = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort({ sectionId: String(dModule2._id) })],
    }))
    check('a module from outside the cohort-s own course is refused',
      foreignSection === 'SECTION_NOT_IN_COURSE', String(foreignSection))

    /* The asymmetry nobody would choose and nobody would notice. */
    const ungatedGuest = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      guestCohorts: [cohort({ sectionId: undefined })],
    }))
    check('a module-gated class cannot admit an UNGATED guest cohort',
      ungatedGuest === 'INVALID_COHORT', String(ungatedGuest))

    const overAllocated = await codeFrom(() => svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      sessionCapacity: 10, guestCohorts: [cohort({ seatFloor: 11 })],
    }))
    check('floors larger than the room are refused',
      overAllocated === 'SEATS_OVERALLOCATED', String(overAllocated))
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A valid cohort is stored, and the seats add up')
  {
    const live = await svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      sessionCapacity: 30, overflowSeats: 5,
      guestCohorts: [cohort({ seatFloor: 10 })],
    })
    const doc = await LiveClassModel.findById(live.id).lean() as any

    check('the class still belongs to its OWNER', String(doc.organizationId) === String(dubai._id))
    check('the guest academy is named', String(doc.guestCohorts?.[0]?.organizationId) === String(blr._id))
    check('through ITS OWN course', String(doc.guestCohorts?.[0]?.courseId) === String(bCourse._id))
    check('and ITS OWN module', String(doc.guestCohorts?.[0]?.sectionId) === String(bModule2._id))
    check('the host door is NOT mirrored into the array', (doc.guestCohorts ?? []).length === 1)
    check('the guest countdown starts at its floor', doc.guestCohorts?.[0]?.seatsLeft === 10)

    const total = doc.hostSeatsLeft + doc.overflowSeatsLeft + doc.bookedCount
      + (doc.guestCohorts ?? []).reduce((n: number, c: any) => n + c.seatsLeft, 0)
    check('the allocation adds up to the capacity', total === doc.sessionCapacity,
      `${total} vs ${doc.sessionCapacity}`)
    check('the host keeps what the guests and overflow did not take', doc.hostSeatsLeft === 15,
      String(doc.hostSeatsLeft))
  }

  /* ═══════════════════════════════════════════════════════
     THE PHASE PROPERTY. Authored, and still shut.
     ═══════════════════════════════════════════════════════ */
  section('Inert: a cohort can be authored and no guest can enter')
  {
    check('cross-academy classes are OFF by default', CROSS_ORG_CLASSES_ENABLED === false)

    const live = await svc.create({
      ...base, scheduledStart: soon(), sectionId: String(dModule2._id),
      sessionCapacity: 30, guestCohorts: [cohort({ seatFloor: 10 })],
    })
    const doc = await LiveClassModel.findById(live.id).lean() as any

    /* A Bangalore student, properly enrolled in the BANGALORE course, with the
       class naming their cohort. Still refused while the flag is off. */
    const bStudent = await UserModel.create({
      name: 'BLR student', email: `blr.${Date.now()}@t.local`, passwordHash: 'x',
      role: 'student', isActive: true, isVerified: true,
      organizationId: blr._id, enrollmentStatus: 'approved',
    })
    const { EnrollmentModel } = await import('@/models/schema.ts')
    await EnrollmentModel.create({
      userId: bStudent._id, courseId: bCourse._id, status: 'active',
    })

    const verdict = await resolveClassEntitlement(doc, String(bStudent._id), String(blr._id), 'active')
    check('the guest student is refused while the feature is off',
      verdict.ok === false, JSON.stringify(verdict))
    check('and refused as WRONG_ACADEMY, not as a module or enrolment problem',
      verdict.code === 'WRONG_ACADEMY', String(verdict.code))

    /* And the host cohort is entirely unaffected by the cohort existing. */
    const dStudent = await UserModel.create({
      name: 'DXB student', email: `dxb.${Date.now()}@t.local`, passwordHash: 'x',
      role: 'student', isActive: true, isVerified: true,
      organizationId: dubai._id, enrollmentStatus: 'approved',
    })
    await EnrollmentModel.create({ userId: dStudent._id, courseId: dCourse._id, status: 'active' })
    const hostVerdict = await resolveClassEntitlement(doc, String(dStudent._id), String(dubai._id), 'active')
    check('the host academy-s own student is admitted as before', hostVerdict.ok === true,
      JSON.stringify(hostVerdict))
    check('through the host door', hostVerdict.door?.isHost === true)

    /* The module gate still bites for the host, which is the invariant the
       whole design rests on. */
    await EnrollmentModel.updateOne(
      { userId: dStudent._id, courseId: dCourse._id },
      { $set: { blockedLessons: [dModule2._id] } },
    )
    const blocked = await resolveClassEntitlement(doc, String(dStudent._id), String(dubai._id), 'active')
    check('a blocked host module still refuses', blocked.code === 'MODULE_BLOCKED', String(blocked.code))
  }

  console.log(lines.join('\n'))
  console.log(`\ncrossorgclass.suite — ${pass} passed, ${failures.length} failed`)
  if (failures.length) { console.error('\nFAILURES:\n' + failures.map(f => '  · ' + f).join('\n')) }
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
} catch (err) {
  console.error(err)
  try { await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect() } catch {}
  process.exit(1)
}
