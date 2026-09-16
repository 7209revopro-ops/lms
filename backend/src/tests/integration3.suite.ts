/* ─────────────────────────────────────────────────────────────
   LMS ↔ CLT Connect — Phase 3: host tickets and the entitlement core.

   Phase 3 is the first phase where a wrong answer lets the wrong person into
   a classroom, so the suite is mostly about refusals: an instructor who is not
   assigned, a student without a booking, a blocked module, another academy's
   class, the wrong side of the time window.

   The `assertStudentMayJoin` rules are exercised here even though the student
   endpoint lands in Phase 4 — the logic is what Phase 4 will depend on, and it
   is cheaper to get wrong now than after a watch page is built on top of it.

   Run: bun run test:integration3
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_integration3'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''

/* A signing key, or every mint throws IntegrationDisabledError. */
import { generateKeyPairSync } from 'node:crypto'
const { privateKey } = generateKeyPairSync('ed25519')
process.env.INTEGRATION_JWT_PRIVATE_KEY =
  Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64')
process.env.INTEGRATION_JWT_KID = 'test-p3'

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
const { createServer } = await import('node:http')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_integration3') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

/* Stand-in for CLT so room provisioning resolves. */
const fakeClt = createServer((req, res) => {
  let b = ''
  req.on('data', c => { b += c })
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ courseId: 7, roomName: JSON.parse(b || '{}').roomName, courseCode: 'LMS1' }))
  })
})
await new Promise<void>(r => fakeClt.listen(0, () => r()))
process.env.CLT_BASE_URL   = `http://127.0.0.1:${(fakeClt.address() as { port: number }).port}`
process.env.CLT_S2S_SECRET = 'phase3-secret'

const {
  LiveClassModel, OrganizationModel, CourseModel, UserModel,
  ClassBookingModel, EnrollmentModel, SectionModel,
} = await import('@/models/schema.ts')
const join = await import('@/services/liveClassJoin.service.ts')
const { jwtVerify, importJWK } = await import('jose')
const keys = await import('@/utils/integrationKeys.ts')

async function claimsOf(ticket: string) {
  const { keys: published } = await keys.publicJwks()
  const key = await importJWK(published[0] as never, 'EdDSA')
  const { payload } = await jwtVerify(ticket, key, {
    issuer: 'lms.deltainstitutions', audience: 'clt-connect', algorithms: ['EdDSA'],
  })
  return payload as Record<string, any>
}

const soon = () => new Date(Date.now() + 5 * 60_000)     // inside the join window

try {
  const orgA = await OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const orgB = await OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })

  const mk = (email: string, role: string, org = orgA._id, extra: Record<string, unknown> = {}) =>
    UserModel.create({ name: email, email, passwordHash: 'x', role, isActive: true,
      organizationId: org, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...extra })

  const teacher   = await mk('teacher@t.local', 'instructor')
  const other     = await mk('other@t.local', 'instructor')
  const superA    = await mk('super@t.local', 'super_admin')
  const student   = await mk('student@t.local', 'student')
  const stranger  = await mk('stranger@t.local', 'student')
  const pending   = await mk('pending@t.local', 'student', orgA._id, { enrollmentStatus: 'pending' })
  const offOrg    = await mk('offorg@t.local', 'student', orgB._id)

  const course = await CourseModel.create({
    title: 'C', slug: 'c-' + Date.now(), description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: orgA._id,
  })
  const moduleRow = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 0 })

  const mkClass = (over: Record<string, unknown> = {}) => LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'Live',
    scheduledStart: soon(), durationMins: 60, type: 'internal', provider: 'livekit',
    sessionCapacity: 30, organizationId: orgA._id, ...over,
  })

  const ctx = (u: any, role?: string) => ({
    userId: String(u._id), name: u.name, email: u.email, role: role ?? u.role,
    organizationId: String(u.organizationId), enrollmentStatus: u.enrollmentStatus, isActive: true,
  })

  /* ═══════════════════════════════════════════════ */
  section('A · the assigned instructor can host')
  const live = await mkClass()
  const hosted = await join.mintHostTicket(live.id, ctx(teacher))
  check('a ticket is issued', !!hosted.ticket && hosted.expiresIn === 90)
  check('the room name is derived from the class', hosted.roomName === `lms-${live.id}`, hosted.roomName)

  const hc = await claimsOf(hosted.ticket)
  check('role is instructor', hc.role === 'instructor', hc.role)
  check('roomAdmin is granted — they may start and moderate', hc.grants.roomAdmin === true)
  check('and they may publish', hc.grants.canPublish === true)
  check('sub is the LMS user id', hc.sub === String(teacher._id))
  check('the class is bound into the ticket', hc.liveClassId === live.id)

  section('B · a lazily provisioned room repairs a failed Phase-2 attempt')
  const refetched = await LiveClassModel.findById(live.id)
  check('the CLT course id was stored on first host',
    (refetched as any)?.cltCourseId === 7, String((refetched as any)?.cltCourseId))

  section('C · hosting is restricted to THIS class')
  let notMine: any = null
  try { await join.mintHostTicket(live.id, ctx(other)) } catch (e) { notMine = e }
  check('another instructor is refused', notMine?.code === 'NOT_YOUR_CLASS', notMine?.code)
  check('with 403', notMine?.status === 403, String(notMine?.status))

  const adminTicket = await join.mintHostTicket(live.id, ctx(superA))
  const ac = await claimsOf(adminTicket.ticket)
  check('a super admin may enter', ac.role === 'admin', ac.role)
  check('but silently — no publish', ac.grants.canPublish === false)
  check('and without room control', ac.grants.roomAdmin === false,
    'watching a class must not be indistinguishable from running it')

  section('D · only LiveKit classes')
  const muxClass = await mkClass({ provider: 'mux' })
  let notLk: any = null
  try { await join.mintHostTicket(muxClass.id, ctx(teacher)) } catch (e) { notLk = e }
  check('a Mux class is refused', notLk?.code === 'NOT_A_LIVEKIT_CLASS', notLk?.code)

  const cancelled = await mkClass({ status: 'cancelled' })
  let canc: any = null
  try { await join.mintHostTicket(cancelled.id, ctx(teacher)) } catch (e) { canc = e }
  check('a cancelled class is refused', canc?.code === 'CLASS_CANCELLED', canc?.code)

  const ended = await mkClass({ status: 'ended' })
  let end: any = null
  try { await join.mintHostTicket(ended.id, ctx(teacher)) } catch (e) { end = e }
  check('an ended class is refused', end?.code === 'CLASS_ENDED', end?.code)

  let bad: any = null
  try { await join.mintHostTicket('not-an-id', ctx(teacher)) } catch (e) { bad = e }
  check('a malformed id is a 400, not a 500', bad?.status === 400, String(bad?.status))

  /* ═══════════════════════════════════════════════ */
  section('E · ENTITLEMENT — a student needs a booking')
  const cls = await mkClass()
  let noBooking: any = null
  try { await join.mintStudentTicket(cls.id, ctx(student)) } catch (e) { noBooking = e }
  check('no booking → refused', noBooking?.code === 'NOT_BOOKED', noBooking?.code)

  await ClassBookingModel.create({ userId: student._id, liveClassId: cls._id, status: 'booked' })

  /* A seat is not enough on its own. This fixture used to mint straight after
     booking with no enrolment at all — which is precisely the shape an admin
     leaves behind by deleting an enrolment (booking rows are not touched),
     and the gate now refuses it, for a room exactly as for a Meet link. */
  let noEnrolment: any = null
  try { await join.mintStudentTicket(cls.id, ctx(student)) } catch (e) { noEnrolment = e }
  check('a booking whose enrolment is gone → NOT_ENROLLED', noEnrolment?.code === 'NOT_ENROLLED', noEnrolment?.code)

  await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active', blockedLessons: [] })
  const joined = await join.mintStudentTicket(cls.id, ctx(student))
  const sc = await claimsOf(joined.ticket)
  check('with a booking → a student ticket', sc.role === 'student', sc.role)
  check('students never get room control', sc.grants.roomAdmin === false)
  check('but may speak', sc.grants.canPublish === true)

  await ClassBookingModel.create({ userId: stranger._id, liveClassId: cls._id, status: 'cancelled' })
  let cancelledBooking: any = null
  try { await join.mintStudentTicket(cls.id, ctx(stranger)) } catch (e) { cancelledBooking = e }
  check('a CANCELLED booking is not a booking', cancelledBooking?.code === 'NOT_BOOKED', cancelledBooking?.code)

  section('F · enrolment, academy and account state')
  await ClassBookingModel.create({ userId: pending._id, liveClassId: cls._id, status: 'booked' })
  let notApproved: any = null
  try { await join.mintStudentTicket(cls.id, ctx(pending)) } catch (e) { notApproved = e }
  check('a pending enrolment is refused', notApproved?.code === 'ENROLMENT_NOT_APPROVED', notApproved?.code)

  await ClassBookingModel.create({ userId: offOrg._id, liveClassId: cls._id, status: 'booked' })
  let wrongOrg: any = null
  try { await join.mintStudentTicket(cls.id, ctx(offOrg)) } catch (e) { wrongOrg = e }
  check('another academy’s student is refused', wrongOrg?.code === 'WRONG_ACADEMY', wrongOrg?.code)

  let disabled: any = null
  try { await join.mintStudentTicket(cls.id, { ...ctx(student), isActive: false }) } catch (e) { disabled = e }
  check('a disabled account is refused', disabled?.code === 'ACCOUNT_DISABLED', disabled?.code)

  section('G · module blocking (blockedLessons holds SECTION ids)')
  const gated = await mkClass({ sectionId: moduleRow._id })
  await ClassBookingModel.create({ userId: student._id, liveClassId: gated._id, status: 'booked' })
  /* The enrolment already exists from section E; block the module on it. */
  await EnrollmentModel.updateOne(
    { userId: student._id, courseId: course._id },
    { $set: { blockedLessons: [moduleRow._id] } },
  )
  let blocked: any = null
  try { await join.mintStudentTicket(gated.id, ctx(student)) } catch (e) { blocked = e }
  check('a blocked module refuses the live class too', blocked?.code === 'MODULE_BLOCKED', blocked?.code)

  section('H · the time window')
  const early = await mkClass({ scheduledStart: new Date(Date.now() + 4 * 60 * 60_000) })
  await ClassBookingModel.create({ userId: student._id, liveClassId: early._id, status: 'booked' })
  let tooEarly: any = null
  try { await join.mintStudentTicket(early.id, ctx(student)) } catch (e) { tooEarly = e }
  check('too early → 425, not 403', tooEarly?.status === 425, String(tooEarly?.status))
  check('and it says how long to wait, so the UI can count down',
    typeof tooEarly?.retryAfter === 'number' && tooEarly.retryAfter > 0, String(tooEarly?.retryAfter))

  const over = await mkClass({ scheduledStart: new Date(Date.now() - 4 * 60 * 60_000) })
  await ClassBookingModel.create({ userId: student._id, liveClassId: over._id, status: 'booked' })
  let tooLate: any = null
  try { await join.mintStudentTicket(over.id, ctx(student)) } catch (e) { tooLate = e }
  check('long after the end → refused', tooLate?.code === 'CLASS_OVER', tooLate?.code)

  const justStarted = await mkClass({ scheduledStart: new Date(Date.now() - 10 * 60_000) })
  await ClassBookingModel.create({ userId: student._id, liveClassId: justStarted._id, status: 'booked' })
  check('joining ten minutes late still works',
    !!(await join.mintStudentTicket(justStarted.id, ctx(student))).ticket)

  section('I · every ticket is single-use by construction')
  const a = await join.mintHostTicket(live.id, ctx(teacher))
  const b = await join.mintHostTicket(live.id, ctx(teacher))
  const [ca, cb] = [await claimsOf(a.ticket), await claimsOf(b.ticket)]
  check('two mints produce different jtis', ca.jti !== cb.jti, `${ca.jti} vs ${cb.jti}`)
  check('both name the same room', ca.roomName === cb.roomName)

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  fakeClt.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
