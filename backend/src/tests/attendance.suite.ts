/* ─────────────────────────────────────────────────────────────
   Auto-attendance.

   ClassBooking has always had attendedAt/attendanceSource — evidence a
   webhook writes when a student actually joins an internal/LiveKit room —
   but the field's own comment in schema.ts explains why nothing ever acted
   on it: `status` stays 'booked' regardless, by design, so "attended" vs
   "missed" was a human decision made one click at a time. That is the
   `unmarked` bucket GET /admin/bookings/stats reports.

   Two changes close that loop:
     1. External (Zoom/Meet) classes now get the SAME evidence — POST
        /live-classes/:id/join (resolveMeetJoin) already runs the full
        entitlement + time-window gate before it ever hands back the link,
        so that gated moment is the strongest signal available for a
        provider the LMS never hears from again.
     2. runAttendanceFinalization (reminders.job.ts) turns evidence into the
        real decision once a class has been over long enough: attendedAt
        present -> 'attended', absent -> 'missed' — but ONLY for a booking
        still sitting at 'booked'; anything already decided (manually, or
        cancelled) is left exactly alone, and OFFLINE classes are excluded
        entirely since nobody clicks a link for those.

   Questions this suite answers:
     A  a student's Join click on an external class records attendedAt/
        attendanceSource='click', idempotently (first click wins)
     B  a student who never clicks Join has no attendedAt at all
     C  finalization turns attendedAt into status:'attended' once the class
        has been over long enough
     D  finalization turns a bare 'booked' seat (no attendedAt) into 'missed'
     E  finalization is skipped entirely while the class is still recent —
        the buffer exists so a trailing click can still land
     F  finalization never touches a seat a human already decided, or one
        that is cancelled
     G  OFFLINE classes are never auto-finalized — there is no join signal
        for them, so touching them would mark everyone 'missed'
     H  finalization is idempotent — attendanceFinalized stops a second pass
        from re-touching (and re-logging) the same class
     I  a click on a class whose join window has already closed is refused
        BEFORE any attendance write happens (CLASS_ENDED / JOIN_WINDOW_CLOSED)

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_attendance_suite), dropped on exit.

   Run: bun run test:attendance
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_attendance_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'off'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.ADMIN_URL    = 'http://localhost:3001'
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
const app = (await import('@/app.ts')).default
const {
  UserModel, OrganizationModel, CourseModel, LiveClassModel, ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runAttendanceFinalization } = await import('@/jobs/reminders.job.ts')
const { studentJoinClosesAt } = await import('@/services/liveClassJoin.service.ts')
const { handleCltEvent } = await import('@/services/cltWebhook.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_attendance_suite') {
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
async function signInStudent(email: string, password: string): Promise<Jar> {
  const jar: Jar = new Map()
  const res = await call('POST', '/auth/login', { jar, body: { email, password } })
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res.body)}`)
  return jar
}

const PW = 'Attendance1'

try {
  const hash = await hashPassword(PW)

  const org = await OrganizationModel.create({
    name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const teacher = await UserModel.create({
    name: 'Teach', email: 'teach@att.local', passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'Forex', slug: 'forex-att', description: 'd', instructorId: teacher._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id,
  })

  let seq = 0
  /** A student, already enrolled on the one course this suite uses — the
      entitlement gate resolveMeetJoin runs (resolveClassEntitlement) checks
      real course enrollment, not just the booking. */
  async function student() {
    const n = seq++
    const s = await UserModel.create({
      name: `Student ${n}`, email: `s${n}@att.local`, passwordHash: hash, role: 'student',
      isActive: true, isVerified: true, enrollmentStatus: 'approved', organizationId: org._id,
    })
    await EnrollmentModel.create({ userId: s._id, courseId: course._id, status: 'active', organizationId: org._id })
    return s
  }
  /** An external class `minutesFromNow` from now, `durationMins` long. */
  async function externalClass(minutesFromNow: number, durationMins = 60, opts: { isOnline?: boolean } = {}) {
    return LiveClassModel.create({
      title: `Session ${seq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() + minutesFromNow * 60_000), durationMins,
      type: 'external', meetingUrl: 'https://meet.google.com/att-test',
      isOnline: opts.isOnline ?? true, status: 'scheduled',
      language: 'English', sessionCapacity: 30, bookedCount: 0,
    })
  }
  async function booking(lc: any, s: any, status: 'booked' | 'attended' | 'missed' | 'cancelled' = 'booked') {
    return ClassBookingModel.create({ userId: s._id, liveClassId: lc._id, status, bookedAt: new Date() })
  }

  /* ═════════════════ A — a Join click records evidence, idempotently ═════════════════ */
  section('A. Joining an external class records attendedAt/attendanceSource=click')
  {
    const lc = await externalClass(-2)  // started 2 min ago — inside the 20-min join window
    const s  = await student()
    await booking(lc, s)
    const jar = await signInStudent(s.email, PW)

    const res = await call('POST', `/live-classes/${lc._id}/join`)
    // (no jar yet — this MUST fail without auth, proving the route is really gated)
    check('A0 an unauthenticated join attempt is refused', res.status === 401, JSON.stringify(res.body))

    const joinRes = await call('POST', `/live-classes/${lc._id}/join`, { jar })
    check('A1 a real booked student gets the link back', joinRes.status === 200 && joinRes.body?.data?.url, JSON.stringify(joinRes.body))

    await new Promise(r => setTimeout(r, 150))  // the write is fire-and-forget
    const row = await ClassBookingModel.findOne({ userId: s._id, liveClassId: lc._id }).lean() as any
    check('A2 attendedAt is set', !!row?.attendedAt)
    check('A3 attendanceSource is "click"', row?.attendanceSource === 'click', row?.attendanceSource)
    check('A4 status is still "booked" — finalization decides that, not the click', row?.status === 'booked')

    const firstTimestamp = row.attendedAt
    await new Promise(r => setTimeout(r, 50))
    await call('POST', `/live-classes/${lc._id}/join`, { jar })
    await new Promise(r => setTimeout(r, 150))
    const rowAfter = await ClassBookingModel.findOne({ userId: s._id, liveClassId: lc._id }).lean() as any
    check('A5 a second click does not move the timestamp', new Date(rowAfter.attendedAt).getTime() === new Date(firstTimestamp).getTime())
  }

  /* ═════════════════ B — never clicked ⇒ no evidence ═════════════════ */
  section('B. A student who never joins has no attendedAt')
  {
    const lc = await externalClass(-2)
    const s  = await student()
    await booking(lc, s)
    const row = await ClassBookingModel.findOne({ userId: s._id, liveClassId: lc._id }).lean() as any
    check('B1 no attendedAt without a join click', !row?.attendedAt)
  }

  /* ═════════════════ C/D — finalization decides both directions ═════════════════ */
  section('C/D. Finalization: attended if there is evidence, missed if not')
  {
    // Ended 90 minutes ago, well past the 15-min buffer.
    const lc = await externalClass(-90, 30)
    const joined   = await student()
    const noShow   = await student()
    const bJoined = await booking(lc, joined)
    const bNoShow = await booking(lc, noShow)
    await ClassBookingModel.updateOne({ _id: bJoined._id }, { $set: { attendedAt: new Date(), attendanceSource: 'click' } })

    await runAttendanceFinalization()

    const rowJoined = await ClassBookingModel.findById(bJoined._id).lean() as any
    const rowNoShow = await ClassBookingModel.findById(bNoShow._id).lean() as any
    check('C1 the student with evidence is marked attended', rowJoined?.status === 'attended', rowJoined?.status)
    check('D1 the student with no evidence is marked missed', rowNoShow?.status === 'missed', rowNoShow?.status)

    const clsAfter = await LiveClassModel.findById(lc._id).lean() as any
    check('C2/D2 the class is flagged attendanceFinalized', clsAfter?.attendanceFinalized === true)
  }

  /* ═════════════════ E — too recent, not finalized yet ═════════════════ */
  section('E. A class that just ended is left alone — the trailing-click buffer')
  {
    // Ended 5 minutes ago — inside the 15-min buffer.
    const lc = await externalClass(-35, 30)
    const s  = await student()
    const b  = await booking(lc, s)

    await runAttendanceFinalization()

    const row = await ClassBookingModel.findById(b._id).lean() as any
    check('E1 the seat is still "booked" — too soon to decide', row?.status === 'booked', row?.status)
    const cls = await LiveClassModel.findById(lc._id).lean() as any
    check('E2 the class is not yet flagged finalized', cls?.attendanceFinalized === false)
  }

  /* ═════════════════ F — never touches what is already decided ═════════════════ */
  section('F. Finalization never overwrites an existing decision')
  {
    const lc = await externalClass(-90, 30)
    const manuallyMissed  = await student()
    const cancelledStd    = await student()
    const bManual = await booking(lc, manuallyMissed, 'attended')  // a human already decided this one
    const bCancel = await booking(lc, cancelledStd, 'cancelled')

    await runAttendanceFinalization()

    const rowManual = await ClassBookingModel.findById(bManual._id).lean() as any
    const rowCancel = await ClassBookingModel.findById(bCancel._id).lean() as any
    check('F1 an already-decided seat is untouched', rowManual?.status === 'attended')
    check('F2 a cancelled seat is never resurrected into attended/missed', rowCancel?.status === 'cancelled')
  }

  /* ═════════════════ G — offline classes are never auto-finalized ═════════════════ */
  section('G. Offline (in-person) classes are excluded entirely')
  {
    const lc = await externalClass(-90, 30, { isOnline: false })
    const s  = await student()
    const b  = await booking(lc, s)  // never clicked anything — there is no link for an in-person class

    await runAttendanceFinalization()

    const row = await ClassBookingModel.findById(b._id).lean() as any
    check('G1 an offline class\'s seat is left "booked", not wrongly marked missed', row?.status === 'booked', row?.status)
    const cls = await LiveClassModel.findById(lc._id).lean() as any
    check('G2 the offline class is never flagged finalized', cls?.attendanceFinalized === false)
  }

  /* ═════════════════ H — idempotent across repeated runs ═════════════════ */
  section('H. Running finalization again touches nothing more')
  {
    const before = await ClassBookingModel.countDocuments({ status: { $in: ['attended', 'missed'] } })
    await runAttendanceFinalization()
    await runAttendanceFinalization()
    const after = await ClassBookingModel.countDocuments({ status: { $in: ['attended', 'missed'] } })
    check('H1 a second and third pass decide nothing new', after === before, `${before} -> ${after}`)
  }

  /* ═════════════════ I0 — internal/LiveKit student join still works after the enum widening ═════════════════
     Pre-existing behaviour (onParticipantJoined's booking-matching branch,
     unchanged by this feature) — attendanceSource went from a 1-value enum
     ('livekit') to 2 ('livekit' | 'click'). Confirming the ORIGINAL value
     still round-trips, and that it flows all the way through finalization
     the same as a click does, catches a regression a type-only widening
     could still cause at the Mongoose validation layer. */
  section('I0. Internal/LiveKit student webhook still works, end-to-end through finalization')
  {
    const lc = await LiveClassModel.create({
      title: `Session ${seq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() - 90 * 60_000), durationMins: 30,
      type: 'internal', provider: 'livekit', cltRoomName: `att-room-${seq}`,
      isOnline: true, status: 'ended',
      language: 'English', sessionCapacity: 30, bookedCount: 0,
    })
    const s = await student()
    const b = await booking(lc, s)

    const result = await handleCltEvent({
      type: 'participant.joined', roomName: `att-room-${seq - 1}`,
      data: { lmsUserId: String(s._id) },
    })
    check('I0a the webhook records attendance, not "no open booking"', /attendance recorded/i.test(result), result)

    const rowBefore = await ClassBookingModel.findById(b._id).lean() as any
    check('I0b attendanceSource="livekit" still validates against the widened enum', rowBefore?.attendanceSource === 'livekit', rowBefore?.attendanceSource)

    await runAttendanceFinalization()
    const rowAfter = await ClassBookingModel.findById(b._id).lean() as any
    check('I0c finalization turns a livekit join into "attended" the same as a click would', rowAfter?.status === 'attended', rowAfter?.status)
  }

  /* ═════════════════ I — a closed join window is refused before any write ═════════════════ */
  section('I. A closed join window is refused — no attendance write happens')
  {
    const lc = await externalClass(-90, 30)  // long over
    const s  = await student()
    await booking(lc, s)
    const jar = await signInStudent(s.email, PW)

    const res = await call('POST', `/live-classes/${lc._id}/join`, { jar })
    check('I1 the request is refused, not silently accepted', res.status >= 400, JSON.stringify(res.body))

    const row = await ClassBookingModel.findOne({ userId: s._id, liveClassId: lc._id }).lean() as any
    check('I2 no attendedAt was written for a refused join', !row?.attendedAt)
  }

  /* ═════════════════ J — the late-joiner gap ═════════════════
     A Meet link stays open until 20 min after the class ends; finalization
     used to decide at 15. A student who clicked Join at end+17 had already
     been marked 'missed' and was refused "You have not booked this class"
     while the page still said the link was open. */
  section('J. A Meet class is not finalized while its join link is still open')
  {
    const lc = await externalClass(-47, 30)  // ended 17 min ago — past the old 15, inside the 20-min link
    const late   = await student()
    const absent = await student()
    const bLate   = await booking(lc, late)
    const bAbsent = await booking(lc, absent)

    await runAttendanceFinalization()
    const lateBefore = await ClassBookingModel.findById(bLate._id).lean() as any
    check('J1 at end+17 the not-yet-joined seat is still "booked", not "missed"', lateBefore?.status === 'booked', lateBefore?.status)
    const clsBefore = await LiveClassModel.findById(lc._id).lean() as any
    check('J2 the class is not flagged finalized while its link is open', clsBefore?.attendanceFinalized === false)

    const jar = await signInStudent(late.email, PW)
    const joinRes = await call('POST', `/live-classes/${lc._id}/join`, { jar })
    check('J3 the late student is let in, not refused as "not booked"', joinRes.status === 200 && !!joinRes.body?.data?.url, JSON.stringify(joinRes.body))

    const fresh = await LiveClassModel.findById(lc._id).lean() as any
    check('J4 the finalizer waits for exactly the instant the join gate reports',
      new Date(joinRes.body?.data?.closesAt).getTime() === studentJoinClosesAt(fresh),
      `${joinRes.body?.data?.closesAt} vs ${new Date(studentJoinClosesAt(fresh)).toISOString()}`)

    await new Promise(r => setTimeout(r, 150))  // the attendance write is fire-and-forget

    // The link closes and the one-minute in-flight margin passes.
    await LiveClassModel.updateOne({ _id: lc._id }, { $set: { scheduledStart: new Date(Date.now() - 52 * 60_000) } })
    await runAttendanceFinalization()

    const lateAfter   = await ClassBookingModel.findById(bLate._id).lean() as any
    const absentAfter = await ClassBookingModel.findById(bAbsent._id).lean() as any
    check('J5 once the link has closed, the late joiner is marked attended', lateAfter?.status === 'attended', lateAfter?.status)
    check('J6 ...and the student who never joined is marked missed', absentAfter?.status === 'missed', absentAfter?.status)
    const clsAfter = await LiveClassModel.findById(lc._id).lean() as any
    check('J7 ...and the class is flagged finalized', clsAfter?.attendanceFinalized === true)
  }

  /* ═════════════════ K — the exact Meet boundary ═════════════════ */
  section('K. Meet boundary: undecided until one minute past the link closing')
  {
    const justClosed = await externalClass(-50.5, 30)  // ended 20.5 min ago — link shut, margin not yet passed
    const sJust = await student()
    const bJust = await booking(justClosed, sJust)
    const pastMargin = await externalClass(-51.5, 30)  // ended 21.5 min ago
    const sPast = await student()
    const bPast = await booking(pastMargin, sPast)

    await runAttendanceFinalization()

    const rJust = await ClassBookingModel.findById(bJust._id).lean() as any
    const rPast = await ClassBookingModel.findById(bPast._id).lean() as any
    check('K1 end+20.5: still "booked" — a click already in flight can still land', rJust?.status === 'booked', rJust?.status)
    check('K2 end+21.5: decided ("missed")', rPast?.status === 'missed', rPast?.status)
  }

  /* ═════════════════ L — in-app classes keep their own (shorter) timing ═════════════════
     The in-app room closes at end+15, so the Meet rule must not delay it. */
  section('L. An in-app class is finalized on its own timing, not the Meet link\'s')
  {
    const mkInternal = (endedMinAgo: number) => LiveClassModel.create({
      title: `Session ${seq++}`, courseId: course._id, instructorId: teacher._id, organizationId: org._id,
      scheduledStart: new Date(Date.now() - (30 + endedMinAgo) * 60_000), durationMins: 30,
      type: 'internal', provider: 'livekit', cltRoomName: `att-room-l-${seq}`,
      isOnline: true, status: 'ended', language: 'English', sessionCapacity: 30, bookedCount: 0,
    })
    const early = await mkInternal(15.5)  // room shut at end+15; margin not yet passed
    const sEarly = await student()
    const bEarly = await booking(early, sEarly)
    const ready = await mkInternal(17)    // would still be waiting under the Meet rule (end+21)
    const sReady = await student()
    const bReady = await booking(ready, sReady)

    await runAttendanceFinalization()

    const rEarly = await ClassBookingModel.findById(bEarly._id).lean() as any
    const rReady = await ClassBookingModel.findById(bReady._id).lean() as any
    check('L1 end+15.5: still "booked"', rEarly?.status === 'booked', rEarly?.status)
    check('L2 end+17: decided — not held back to the Meet link\'s end+21', rReady?.status === 'missed', rReady?.status)
  }

} finally {
  server.close()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
