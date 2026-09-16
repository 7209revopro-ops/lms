/* ─────────────────────────────────────────────────────────────
   The Meet join gate, property/fuzz.

   joinclass.suite walks named scenarios over HTTP. This one generates a few
   hundred random combinations of the things the gate looks at — class type,
   delivery mode, class status, seat status, account state, academy, module
   block, and WHEN the click lands relative to the start — and checks every
   outcome against an exact model of resolveMeetJoin's decision order:

     not a Meet class → cancelled → ended → account disabled → enrolment not
     approved → other academy → no seat → not enrolled → module blocked →
     too early → window closed → the URL

   The order is part of the contract: a permanent "no" must win over a
   temporary "not yet", or the page would show a countdown to somebody who
   is never getting in.

   Part 1 fuzzes the pure window helpers with an injected clock, to the
   millisecond, both ends inclusive. Part 2 fuzzes the whole gate against real
   Mongo rows, steering time by where scheduledStart sits relative to now.

   Invariant on every single step, whatever else happens: the Meet URL is
   returned on success and appears NOWHERE in any refusal.

   Seeded PRNG — a failure names the seed and the scenario.

   Run: bun run test:joinclass-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_joinclassprop_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_LOG_DIR = '.logs/emails-joinclassprop'
process.env.STUDENT_JOIN_GRACE_MINUTES = '20'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const { LiveClassModel, ClassBookingModel, EnrollmentModel, CourseModel, OrganizationModel, UserModel, SectionModel } =
  await import('@/models/schema.ts')
const { studentJoinWindow, STUDENT_JOIN_GRACE_MS } = await import('@/utils/liveStatus.ts')
const { resolveMeetJoin, JoinError } = await import('@/services/liveClassJoin.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_joinclassprop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const MIN  = 60_000
const MEET = 'https://meet.google.com/prop-test-xyz'

try {

/* ═══════════════ PART 1 — the pure window, to the millisecond ═══════════════ */
section('PART 1. studentJoinWindow — the two instants everything else is drawn from')
{
  check('the grace is the 20 minutes this suite asked for', STUDENT_JOIN_GRACE_MS === 20 * MIN, String(STUDENT_JOIN_GRACE_MS))

  /* Only the helper production actually calls is fuzzed here. An earlier
     version also fuzzed an `isStudentJoinOpen` predicate to the millisecond —
     which the gate never used, so its inclusivity was being proven for dead
     code. The gate's own edges are exercised in Part 2 against real rows. */
  const rand = rng(7)
  const broke: string[] = []
  for (let i = 0; i < 2000; i++) {
    const start = Date.UTC(2026, 9, 1, 6, 0, 0) + Math.floor(rand() * 365 * 24) * 3600_000
    const w = studentJoinWindow(new Date(start))
    if (w.opensAt.getTime() !== start) broke.push(`opensAt != start for ${start}`)
    if (w.closesAt.getTime() !== start + 20 * MIN) broke.push(`closesAt != start+20m for ${start}`)

    /* A string start must produce the same instants as a Date start. */
    const ws = studentJoinWindow(new Date(start).toISOString())
    if (ws.opensAt.getTime() !== w.opensAt.getTime() || ws.closesAt.getTime() !== w.closesAt.getTime()) {
      broke.push('ISO string start disagrees with Date start')
    }
  }
  check('P1 2000 random starts: opensAt is the start, closesAt is start+20m, Date or ISO', broke.length === 0,
    broke.slice(0, 3).join(' | '))
}

/* ═══════════════ PART 2 — the whole gate against real rows ═══════════════ */
section('PART 2. The gate against real rows — every refusal in the right order, the URL only on success')
{
  const org   = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const other = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const teacher = await UserModel.create({ name: 'T', email: 't@jp.local', passwordHash: 'x', role: 'instructor', isActive: true, organizationId: org._id })
  const course  = await CourseModel.create({ title: 'C', slug: 'c-jp', description: 'd', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id })
  const module1 = await SectionModel.create({ courseId: course._id, title: 'M1', order: 1 })

  const TYPES    = ['external', 'external', 'external', 'internal'] as const
  const ONLINE   = [true, true, true, false] as const
  const CSTATUS  = ['scheduled', 'scheduled', 'scheduled', 'live', 'cancelled', 'ended'] as const
  const SEAT     = ['booked', 'booked', 'attended', 'cancelled', 'missed', 'none'] as const
  const ACTIVE   = [true, true, true, false] as const
  const ENROL    = ['approved', 'approved', 'approved', 'pending', 'rejected', undefined] as const
  const ACADEMY  = ['same', 'same', 'same', 'other', 'unset'] as const
  const BLOCK    = [false, false, false, true] as const
  /* A seat can outlive its enrolment (an admin deletes the enrolment; the
     booking row stays). The gate must refuse that seat. */
  const ENROLLED = [true, true, true, false] as const
  /* Where the click lands relative to the start, in ms. Kept ≥ 5 s away from
     both edges: the gate reads the wall clock, so an offset ON an edge could
     flip during the call and prove nothing either way. */
  const OFFSETS  = [
    -3 * 3600_000, -30 * MIN, -14 * MIN, -90_000, -5_000,
    +5_000, +30_000, +5 * MIN, +19 * MIN, +(20 * MIN - 5_000),
    +(20 * MIN + 5_000), +25 * MIN, +3 * 3600_000,
  ] as const

  const broke: string[] = []
  const tally: Record<string, number> = {}
  let urlLeaks = 0

  for (let seed = 1; seed <= 320; seed++) {
    const rand = rng(1000 + seed)
    /* Two populations. A uniform draw over every axis reaches the URL only
       ~3% of the time — ten axes each have to line up — which leaves the
       happy path and the two clock refusals thinly covered. So a third of
       the seeds start from the happy path and perturb exactly ONE axis;
       that is also the shape of a real bug: everything right but one thing. */
    let type: typeof TYPES[number], isOnline: boolean, cstatus: typeof CSTATUS[number]
    let seat: typeof SEAT[number], isActive: boolean, enrol: typeof ENROL[number]
    let academy: typeof ACADEMY[number], blocked: boolean, hasUrl: boolean, enrolled: boolean
    let offset: number
    if (rand() < 0.35) {
      type = 'external'; isOnline = true; cstatus = 'scheduled'; seat = 'booked'; isActive = true
      enrol = 'approved'; academy = 'same'; blocked = false; hasUrl = true; enrolled = true
      /* The clock is an axis like the others: mostly inside the window here,
         so the happy path is actually reached, with the two clock refusals
         still drawn often enough to matter. */
      offset = rand() < 0.7
        ? pick(rand, [+5_000, +30_000, +5 * MIN, +19 * MIN, +(20 * MIN - 5_000)] as const)
        : pick(rand, [-90_000, -5_000, +(20 * MIN + 5_000), -3 * 3600_000, +25 * MIN] as const)
      switch (Math.floor(rand() * 13)) {
        case 9: enrolled = false; break
        case 0: type = 'internal'; break
        case 1: isOnline = false; break
        case 2: cstatus = pick(rand, ['cancelled', 'ended'] as const); break
        case 3: seat = pick(rand, ['cancelled', 'missed', 'none', 'attended'] as const); break
        case 4: isActive = false; break
        case 5: enrol = pick(rand, ['pending', 'rejected', undefined] as const); break
        case 6: academy = pick(rand, ['other', 'unset'] as const); break
        case 7: blocked = true; break
        case 8: hasUrl = false; break
        default: /* untouched — the happy path itself */ break
      }
    } else {
      offset = pick(rand, OFFSETS)
      type = pick(rand, TYPES); isOnline = pick(rand, ONLINE); cstatus = pick(rand, CSTATUS)
      seat = pick(rand, SEAT); isActive = pick(rand, ACTIVE); enrol = pick(rand, ENROL)
      academy = pick(rand, ACADEMY); blocked = pick(rand, BLOCK); enrolled = pick(rand, ENROLLED)
      hasUrl = type === 'external' ? rand() < 0.9 : false
    }

    const student = await UserModel.create({
      name: `s${seed}`, email: `s${seed}@jp.local`, passwordHash: 'x', role: 'student',
      isActive, organizationId: org._id, ...(enrol ? { enrollmentStatus: enrol } : {}),
    })
    const lc = await LiveClassModel.create({
      title: `S${seed}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() - offset),   // offset>0 means "started offset ago"
      durationMins: 60, type, isOnline, status: cstatus, language: 'English',
      sessionCapacity: 30, bookedCount: 0, sectionId: module1._id,
      ...(hasUrl ? { meetingUrl: MEET } : {}),
    })
    if (seat !== 'none') await ClassBookingModel.create({ userId: student._id, liveClassId: lc._id, status: seat, bookedAt: new Date() })
    /* 'dropped' is a real enrolment row that must count as none. */
    const enrolStatus = enrolled ? pick(rand, ['active', 'active', 'completed', 'dropped'] as const) : undefined
    if (enrolled) {
      await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: enrolStatus, blockedLessons: blocked ? [module1._id] : [] })
    }

    const ctx = {
      userId: String(student._id), name: student.name, email: student.email, role: 'student',
      organizationId: academy === 'same' ? String(org._id) : academy === 'other' ? String(other._id) : undefined,
      ...(enrol ? { enrollmentStatus: enrol } : {}),
      isActive,
    }

    /* ── the model ── */
    let expect: string
    if (!(type === 'external' && isOnline !== false && hasUrl)) expect = 'NOT_A_MEET_CLASS'
    else if (cstatus === 'cancelled') expect = 'CLASS_CANCELLED'
    else if (cstatus === 'ended')     expect = 'CLASS_ENDED'
    else if (!isActive)               expect = 'ACCOUNT_DISABLED'
    else if (enrol && enrol !== 'approved') expect = 'ENROLMENT_NOT_APPROVED'
    /* 'unset' (a student with no academy on record) is NOT refused. That is
       the convention every tenancy guard in this codebase follows — an
       unscoped account stays unscoped, only a genuine mismatch is a refusal
       (see assertAdminMayObserve) — and the seat check behind it still
       requires a booking on this exact class. The model encodes the
       convention deliberately, so tightening it is a visible decision. */
    else if (academy === 'other')     expect = 'WRONG_ACADEMY'
    else if (!(seat === 'booked' || seat === 'attended')) expect = 'NOT_BOOKED'
    else if (!enrolled || enrolStatus === 'dropped') expect = 'NOT_ENROLLED'
    else if (blocked)                 expect = 'MODULE_BLOCKED'
    else if (offset < 0)              expect = 'TOO_EARLY'
    else if (offset > 20 * MIN)       expect = 'JOIN_WINDOW_CLOSED'
    else                              expect = 'OK'

    /* ── the gate ── */
    let got: string, detail = ''
    try {
      const r = await resolveMeetJoin(String(lc._id), ctx)
      got = 'OK'
      if (r.url !== MEET) { got = 'OK-but-wrong-url'; detail = r.url }
      if (Math.abs(r.closesAt.getTime() - (lc.scheduledStart.getTime() + 20 * MIN)) > 1) { got = 'OK-but-wrong-closesAt' }
    } catch (e) {
      if (!(e instanceof JoinError)) { got = 'THREW:' + (e as Error).message; }
      else {
        got = e.code
        if (e.message.includes('meet.google.com') || e.message.includes('prop-test-xyz')) urlLeaks++
        if (e.code === 'TOO_EARLY') {
          const want = Math.ceil(-offset / 1000)
          if (e.status !== 425 || !e.retryAfter || Math.abs(e.retryAfter - want) > 3) {
            got = 'TOO_EARLY-bad-shape'; detail = `status ${e.status} retryAfter ${e.retryAfter} want≈${want}`
          }
        } else if (e.code === 'JOIN_WINDOW_CLOSED' || e.code === 'CLASS_CANCELLED' || e.code === 'CLASS_ENDED') {
          if (e.status !== 409) { got = e.code + '-bad-status'; detail = String(e.status) }
        } else if (e.code === 'NOT_A_MEET_CLASS') {
          if (e.status !== 400) { got = e.code + '-bad-status'; detail = String(e.status) }
        } else if (e.status !== 403) { got = e.code + '-bad-status'; detail = String(e.status) }
      }
    }

    tally[expect] = (tally[expect] ?? 0) + 1
    if (got !== expect) {
      broke.push(`seed ${seed}: {type:${type},online:${isOnline},url:${hasUrl},class:${cstatus},seat:${seat},active:${isActive},enrol:${enrol},academy:${academy},blocked:${blocked},offset:${offset / 1000}s} expected ${expect}, got ${got} ${detail}`)
    }
  }

  check('P2 320 random scenarios match the model, refusal order included', broke.length === 0, broke.slice(0, 4).join(' || '))
  check('P3 the URL never appears in any refusal', urlLeaks === 0, String(urlLeaks))

  /* A fuzz that never reached the interesting branches would pass for the
     wrong reason. Every outcome the model can produce must have been produced. */
  const outcomes = ['OK', 'NOT_A_MEET_CLASS', 'CLASS_CANCELLED', 'CLASS_ENDED', 'ACCOUNT_DISABLED',
    'ENROLMENT_NOT_APPROVED', 'WRONG_ACADEMY', 'NOT_BOOKED', 'NOT_ENROLLED', 'MODULE_BLOCKED', 'TOO_EARLY', 'JOIN_WINDOW_CLOSED']
  const missing = outcomes.filter(o => (tally[o] ?? 0) === 0)
  check('P4 every outcome was exercised at least once', missing.length === 0, `missing: ${missing.join(',')} | ${JSON.stringify(tally)}`)
  check('P5 and the URL was actually released a meaningful number of times', (tally['OK'] ?? 0) >= 15, String(tally['OK']))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\njoinclass.property.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
