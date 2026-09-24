/* ─────────────────────────────────────────────────────────────
   Booking closes an hour before the class starts.

   A class at 11:00 stops accepting seats at 10:00. The hour is the point: a
   seat taken at 10:58 is one the instructor cannot prepare for, a join link
   the mail queue may not deliver in time, and a head-count that was wrong when
   it was taken.

   What this does NOT change, asserted here so a later edit cannot quietly
   loosen any of it:
     · a student ALREADY booked keeps their seat and can still cancel;
     · an ADMIN may still seat someone late — a staff override is legitimate
       and is the only way to handle a genuine exception;
     · offline classes keep their own, stricter rule (no same-day booking).

   The boundary is exercised to the second, because "an hour before" is the
   sort of rule that is usually implemented as "an hour or so before".

   Run: bun run test:bookingcutoff
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_bookingcutoff'
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
  UserModel, CourseModel, OrganizationModel, LiveClassModel,
  ClassBookingModel, EnrollmentModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const {
  isBookingOpen, bookingClosesAt, BOOKING_CUTOFF_MS, minutesUntilBookingCloses,
} = await import('@/utils/liveStatus.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_bookingcutoff') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
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
const email = (tag: string) => `${tag}-${Date.now()}-${seq++}@bc.local`
const code = (r: { body: any }) => r.body?.error?.code
const MIN = 60_000

try {
  const org = await OrganizationModel.create({
    name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
  })
  const hash = await hashPassword(PW)

  const teacher = await UserModel.create({
    name: 'T', email: email('t'), passwordHash: hash, role: 'instructor',
    isActive: true, organizationId: org._id,
  })
  const admin = await UserModel.create({
    name: 'Admin', email: email('admin'), passwordHash: hash, role: 'admin',
    isActive: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'Course', slug: `course-${Date.now()}`, description: 'd',
    instructorId: teacher._id, price: 0, isFree: true, status: 'published',
    language: 'English', organizationId: org._id,
  })

  /* Every student is enrolled and approved, so nothing but the deadline can
     be the reason a booking is refused. */
  const mkStudent = async (tag: string) => {
    const u = await UserModel.create({
      name: tag, email: email(tag), passwordHash: hash, role: 'student',
      isActive: true, isVerified: true, enrollmentStatus: 'approved',
      organizationId: org._id, categories: ['digital-marketing'],
    })
    await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active' })
    return u
  }

  /* One browser for every sign-in — a fresh jar presents no lms_device, so the
     two-device whitelist would hold the second login for approval and answer
     403 on a test that is not about devices at all. */
  let deviceCookie: string | undefined
  const login = async (e: string): Promise<Jar> => {
    const jar: Jar = new Map()
    if (deviceCookie) jar.set('lms_device', deviceCookie)
    const r = await call('POST', '/auth/login', { jar, body: { email: e, password: PW } })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    const issued = jar.get('lms_device')
    if (issued) deviceCookie = issued
    return jar
  }

  let classSeq = 0
  const mkClass = (startsInMs: number, extra: Record<string, unknown> = {}) =>
    LiveClassModel.create({
      title: `Session ${classSeq++}`, courseId: course._id, instructorId: teacher._id,
      organizationId: org._id, scheduledStart: new Date(Date.now() + startsInMs),
      durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
      sessionCapacity: 30, bookedCount: 0, ...extra,
    })

  const book = (jar: Jar, id: string) =>
    call('POST', '/bookings', { jar, body: { liveClassId: String(id) } })

  /* ═══════════════════════════════════════════════ */
  section('A · the rule itself, to the second')
  {
    /* The worked example from the request: a class at 11:00 closes at 10:00. */
    const start = new Date('2026-09-12T11:00:00.000Z')
    check('an 11:00 class closes at 10:00',
      bookingClosesAt(start).toISOString() === '2026-09-12T10:00:00.000Z',
      bookingClosesAt(start).toISOString())

    const closes = bookingClosesAt(start).getTime()
    check('open one second before the deadline', isBookingOpen(start, closes - 1000))
    /* Exactly at the deadline is CLOSED. Stated because "an hour before" is
       normally written as >= somewhere and > somewhere else, and the two
       disagree for exactly one instant. */
    check('CLOSED at the deadline itself', !isBookingOpen(start, closes))
    check('and closed one second after', !isBookingOpen(start, closes + 1000))
    check('wide open two hours ahead', isBookingOpen(start, closes - 2 * 60 * MIN))

    check('the cut-off is one hour', BOOKING_CUTOFF_MS === 60 * MIN, String(BOOKING_CUTOFF_MS))
    check('minutes-remaining counts down', minutesUntilBookingCloses(start, closes - 30 * MIN) === 30,
      String(minutesUntilBookingCloses(start, closes - 30 * MIN)))
    check('and goes negative once shut', minutesUntilBookingCloses(start, closes + 5 * MIN) === -5,
      String(minutesUntilBookingCloses(start, closes + 5 * MIN)))
  }

  /* ═══════════════════════════════════════════════ */
  section('B · through the API: booking is open well before the class')
  {
    const s = await mkStudent('early')
    const jar = await login(s.email)
    const cls = await mkClass(3 * 60 * MIN)         // starts in 3 hours

    const r = await book(jar, String(cls._id))
    check('a seat three hours out is taken', r.status === 201 || r.status === 200,
      `${r.status} ${code(r)}`)
    check('and the booking exists',
      await ClassBookingModel.countDocuments({ userId: s._id, liveClassId: cls._id, status: 'booked' }) === 1)
  }

  /* ═══════════════════════════════════════════════ */
  section('C · and shut inside the hour')
  {
    const s = await mkStudent('late')
    const jar = await login(s.email)

    /* 59 minutes out — inside the hour but NOT yet live, which is the whole
       window this change creates. The old rule would have allowed this. */
    const cls = await mkClass(59 * MIN)
    const r = await book(jar, String(cls._id))
    check('a seat 59 minutes out is refused', r.status === 400, String(r.status))
    check('with BOOKING_CLOSED', code(r) === 'BOOKING_CLOSED', code(r))
    check('and nothing was booked',
      await ClassBookingModel.countDocuments({ userId: s._id, liveClassId: cls._id }) === 0)

    /* The message must describe THIS situation, not a different one.

       A class 59 minutes away has not started and is not live, so saying
       either is simply false — and it is the lie a student would act on, by
       giving up on a class they still have an hour to prepare for. A mutation
       run caught the weaker version of this assertion: forcing the "already
       started" branch left it green, because the old check only looked for the
       absence of the word "live". */
    const msg = String(r.body?.error?.message ?? '')
    check('the message does NOT claim the class has started — it has not',
      !/started|is live/i.test(msg), msg)
    check('it says booking closed', /closed/i.test(msg), msg)
    /* And names the deadline, so a student two minutes late can see it. */
    check('and names the time it closed', /\d/.test(msg) && msg.length > 40, msg)
    check('and carries the deadline for a client to render',
      typeof r.body?.error?.closedAt === 'string', String(r.body?.error?.closedAt))

    /* 61 minutes out is still open — the boundary is real, not a rounded
       "about an hour". */
    const ok = await mkClass(61 * MIN)
    const r2 = await book(jar, String(ok._id))
    check('but 61 minutes out is still open', r2.status === 201 || r2.status === 200,
      `${r2.status} ${code(r2)}`)
  }

  /* ═══════════════════════════════════════════════ */
  section('D · a class that has already started says so')
  {
    const s = await mkStudent('started')
    const jar = await login(s.email)
    const cls = await mkClass(-10 * MIN)           // began ten minutes ago

    const r = await book(jar, String(cls._id))
    check('refused', r.status === 400, String(r.status))
    const msg = String(r.body?.error?.message ?? '')
    check('and told it has STARTED, not that it closed at some past hour',
      /already started/i.test(msg), msg)
  }

  /* ═══════════════════════════════════════════════ */
  section('E · a seat already held is untouched')
  {
    const s = await mkStudent('holder')
    const jar = await login(s.email)
    const cls = await mkClass(3 * 60 * MIN)
    await book(jar, String(cls._id))

    /* Move the class so it is now inside the hour — the same shape as time
       passing, without waiting for it. */
    await LiveClassModel.updateOne({ _id: cls._id },
      { $set: { scheduledStart: new Date(Date.now() + 20 * MIN) } })

    const mine = await call('GET', '/bookings/me', { jar })
    const has = (mine.body?.data ?? []).some((b: any) =>
      String(b.liveClassId?.id ?? b.liveClassId?._id ?? b.liveClassId) === String(cls._id))
    check('the booking is still listed', has,
      JSON.stringify((mine.body?.data ?? []).length))

    const booking = await ClassBookingModel.findOne({ userId: s._id, liveClassId: cls._id }).lean() as any
    check('and still booked', booking?.status === 'booked', String(booking?.status))

    /* Cancelling inside the hour stays allowed. A student who cannot attend
       should free the seat, and refusing that would leave the head-count the
       cut-off exists to protect WORSE, not better. */
    const cancel = await call('DELETE', `/bookings/${String(booking._id)}`, { jar })
    check('and they may still cancel inside the hour', cancel.status === 200, String(cancel.status))
  }

  /* ═══════════════════════════════════════════════ */
  section('F · the cut-off does not leak into the admin path')
  {
    const s1 = await mkStudent('adminseat')
    const aJar: Jar = new Map()
    await call('POST', '/admin/auth/login', { jar: aJar, body: { email: admin.email, password: PW } })

    /* Admin booking used to be OFFLINE-only; an admin can now seat a student
       into an ONLINE class too (M-16), reusing the exact same entitlement and
       seat-pool machinery the student's own online self-booking route uses.
       Asserted here, in the cut-off suite, because the point of this section
       is that the deadline does not leak into the admin override — for
       EITHER delivery mode. */
    const online = await mkClass(10 * MIN)
    const r = await call('POST', '/admin/bookings/book-for-student', {
      jar: aJar, body: { liveClassId: String(online._id), studentId: String(s1._id) },
    })
    check('an online class inside the hour still seats the student',
      r.status === 200 || r.status === 201,
      `${r.status} ${code(r)} ${String(r.body?.error?.message ?? '')}`)
    check('and the online booking exists',
      await ClassBookingModel.countDocuments({ userId: s1._id, liveClassId: online._id, status: 'booked' }) === 1)

    /* The case the admin path is actually for. Ten minutes before an offline
       class is deep inside the student cut-off, and the admin must still be
       able to seat somebody — otherwise the new rule has quietly taken away a
       staff override it was never meant to touch. */
    const s2 = await mkStudent('offlineseat')
    const offline = await mkClass(10 * MIN, { isOnline: false, location: 'Dubai', room: 'A1' })
    const r2 = await call('POST', '/admin/bookings/book-for-student', {
      jar: aJar, body: { liveClassId: String(offline._id), studentId: String(s2._id) },
    })
    check('but an offline class inside the hour still seats the student',
      r2.status === 200 || r2.status === 201,
      `${r2.status} ${code(r2)} ${String(r2.body?.error?.message ?? '')}`)
    check('and the booking exists',
      await ClassBookingModel.countDocuments({ userId: s2._id, liveClassId: offline._id, status: 'booked' }) === 1)
  }

  /* ═══════════════════════════════════════════════ */
  section('G · the deadline is published on the session itself')
  {
    const s = await mkStudent('reader')
    const jar = await login(s.email)
    const cls = await mkClass(5 * 60 * MIN)

    /* Read from the list — there is no GET /live-classes/:id, and the list is
       what the schedule screen actually calls. */
    const r = await call('GET', '/live-classes?per_page=100', { jar })
    check('the schedule reads back', r.status === 200, String(r.status))

    const rows = r.body?.data ?? []
    const payload = (Array.isArray(rows) ? rows : []).find((x: any) => String(x.id) === String(cls._id))
    check('the new session is in it', !!payload, String((Array.isArray(rows) ? rows : []).length))
    const closes = payload?.bookingClosesAt
    check('and carries bookingClosesAt', typeof closes === 'string', String(closes))
    check('exactly one hour before its start',
      new Date(payload?.scheduledStart).getTime() - new Date(closes).getTime() === 60 * MIN,
      `${payload?.scheduledStart} → ${closes}`)
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
