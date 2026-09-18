/* ─────────────────────────────────────────────────────────────
   A cancelled seat comes back. Every time, on every route.

   WHY THIS SUITE EXISTS. The student cancel route loads its booking with
   .populate('liveClassId', ...).lean(), so `booking.liveClassId` is a plain
   object rather than an ObjectId. releaseSeat guarded with
   Types.ObjectId.isValid(String(id)); String({...}) is "[object Object]", so the
   guard said no and the helper returned HAVING DONE NOTHING — while the route
   answered 200 and the row flipped to cancelled.

   Every student self-cancel burned a seat, permanently, on every class, with
   the feature switched off. One student clicking Book then Cancel could fill a
   room nobody was sitting in.

   IT SURVIVED EVERYTHING. A green suite, a green 79-suite chain, and a lint
   that greps for raw $inc outside the helper. Three cancel assertions already
   existed and all three asserted only the HTTP status. Nothing read the counter
   afterwards, and a seat helper that silently does nothing looks exactly like a
   seat helper that worked.

   So this suite asserts the COUNTER, never the status code alone.

   Run: bun run test:seatrelease
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_seatrelease_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
/* Pinned OFF: this is a regression guard for the state the product ships in. */
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

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, LiveClassModel, EnrollmentModel, ClassBookingModel } =
  await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_seatrelease_suite') {
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
  `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 50)}`
const PW = 'TestPass123'

try {
  const hash = await hashPassword(PW)
  const org = await OrganizationModel.create({ name: 'DXB', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const teacher = await UserModel.create({
    name: 't', email: 't@t.local', passwordHash: hash, role: 'instructor',
    isActive: true, isVerified: true, organizationId: org._id,
  })
  const course = await CourseModel.create({
    title: 'c', slug: `c-${Date.now()}`, description: 'x', price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: org._id,
    instructorId: teacher._id, category: 'ai', program: 'ai',
  })

  const mkClass = (cap: number, allocated: boolean) => LiveClassModel.create({
    courseId: course._id, instructorId: teacher._id, title: 'class', type: 'external',
    meetingUrl: 'https://meet.example/x',
    scheduledStart: new Date(Date.now() + 86_400_000), durationMins: 60,
    organizationId: org._id, sessionCapacity: cap, bookedCount: 0,
    ...(allocated ? { hostSeatsLeft: cap, overflowSeatsLeft: 0 } : {}),
  })

  const student = async (email: string) => {
    const u = await UserModel.create({
      name: email, email, passwordHash: hash, role: 'student',
      isActive: true, isVerified: true, organizationId: org._id, enrollmentStatus: 'approved',
    })
    await EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active' })
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return { u, jar }
  }

  const counted = async (id: unknown) => {
    const d = await LiveClassModel.findById(id).select('bookedCount hostSeatsLeft').lean() as any
    return { booked: d.bookedCount as number, host: d.hostSeatsLeft as number | undefined }
  }
  const seatIdOf = async (u: unknown, c: unknown) =>
    String((await ClassBookingModel.findOne({ userId: u, liveClassId: c }).lean() as any)._id)

  /* ═══════════════════════════════════════════════════════ */
  section('A student cancelling their own seat gives it back')
  {
    const cls = await mkClass(2, false)
    const s = await student('s1@t.local')

    const booked = await call('POST', '/bookings', { jar: s.jar, body: { liveClassId: String(cls._id) } })
    check('the booking succeeds', booked.status === 201, why(booked))
    check('and the counter went up', (await counted(cls._id)).booked === 1)

    const id = await seatIdOf(s.u._id, cls._id)
    const cancelled = await call('DELETE', `/bookings/${id}`, { jar: s.jar })
    check('the cancel succeeds', cancelled.status === 200, why(cancelled))

    /* THE ASSERTION THAT WAS MISSING EVERYWHERE. Three cancel tests already
       existed in this repo and all three stopped at the line above. */
    check('AND THE SEAT CAME BACK', (await counted(cls._id)).booked === 0,
      `bookedCount is ${(await counted(cls._id)).booked}, expected 0`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('Book and cancel repeatedly cannot fill an empty room')
  {
    const cls = await mkClass(10, false)
    const s = await student('s2@t.local')

    for (let i = 0; i < 5; i++) {
      await call('POST', '/bookings', { jar: s.jar, body: { liveClassId: String(cls._id) } })
      const id = await seatIdOf(s.u._id, cls._id)
      await call('DELETE', `/bookings/${id}`, { jar: s.jar })
    }
    const after = await counted(cls._id)
    const live = await ClassBookingModel.countDocuments({ liveClassId: cls._id, status: { $in: ['booked', 'attended'] } })

    check('five book/cancel cycles leave the room empty', after.booked === 0,
      `bookedCount ${after.booked}, real seats held ${live}`)
    check('and the counter matches reality', after.booked === live, `${after.booked} vs ${live}`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('The same holds on an allocated class, per pool')
  {
    const cls = await mkClass(3, true)
    const s = await student('s3@t.local')

    await call('POST', '/bookings', { jar: s.jar, body: { liveClassId: String(cls._id) } })
    const mid = await counted(cls._id)
    check('booking draws from the host floor', mid.booked === 1 && mid.host === 2,
      `booked ${mid.booked}, host ${mid.host}`)

    const id = await seatIdOf(s.u._id, cls._id)
    await call('DELETE', `/bookings/${id}`, { jar: s.jar })
    const end = await counted(cls._id)
    check('cancelling returns it TO THAT FLOOR', end.booked === 0 && end.host === 3,
      `booked ${end.booked}, host ${end.host}`)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('A real student is never refused a seat nobody is sitting in')
  {
    const cls = await mkClass(2, false)
    const a = await student('s4@t.local')
    const b = await student('s5@t.local')
    const c = await student('s6@t.local')

    await call('POST', '/bookings', { jar: a.jar, body: { liveClassId: String(cls._id) } })
    const id = await seatIdOf(a.u._id, cls._id)
    await call('DELETE', `/bookings/${id}`, { jar: a.jar })

    const r1 = await call('POST', '/bookings', { jar: b.jar, body: { liveClassId: String(cls._id) } })
    const r2 = await call('POST', '/bookings', { jar: c.jar, body: { liveClassId: String(cls._id) } })
    check('both remaining students get in', r1.status === 201 && r2.status === 201,
      `${why(r1)} / ${why(r2)}`)
    check('the room holds exactly its capacity', (await counted(cls._id)).booked === 2)
  }

  /* ═══════════════════════════════════════════════════════ */
  section('And re-booking after a cancel still works')
  {
    const cls = await mkClass(1, false)
    const s = await student('s7@t.local')
    await call('POST', '/bookings', { jar: s.jar, body: { liveClassId: String(cls._id) } })
    const id = await seatIdOf(s.u._id, cls._id)
    await call('DELETE', `/bookings/${id}`, { jar: s.jar })
    const again = await call('POST', '/bookings', { jar: s.jar, body: { liveClassId: String(cls._id) } })
    check('the student can take the seat back', again.status === 201, why(again))
    check('and the counter is 1, not 2', (await counted(cls._id)).booked === 1)
  }

  console.log(lines.join('\n'))
  console.log(`\nseatrelease.suite — ${pass} passed, ${failures.length} failed`)
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
