/* ─────────────────────────────────────────────────────────────
   Hybrid classes (plan.md §12) — an in-person class and, in the same request,
   its online twin: POST /admin/live-classes with isOnline:false + alsoOnline.

     A  both are made, linked by hybridPairId, the twin copying the class
     B  every enrolled student is told ONCE (one notice, not two)
     C  alsoOnline on anything but an in-person class: 422
     D  Google Meet failing for the twin creates NOTHING — never half a class
     E  a student holds a seat in one twin, never both; cancel → the other
     F  a plain create (no alsoOnline) is unchanged: one class, no link

   --no-env-file: nothing here may reach Google, SMTP or WhatsApp for real.
   Run: bun run test:hybridclass
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_hybridclass_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_FROM = ''
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
/* app.ts loads .env itself (dotenv/config), which fills any variable that is
   NOT already set — so every Google one is set here, blank, first. With
   GOOGLE_CALENDAR_ID left unset, .env's host mailbox plus the service-account
   key on disk made a REAL Meet room on the live account. */
process.env.GOOGLE_CLIENT_ID = ''; process.env.GOOGLE_CLIENT_SECRET = ''; process.env.GOOGLE_REFRESH_TOKEN = ''
process.env.GOOGLE_MEET_HOST_EMAIL = ''; process.env.GOOGLE_CALENDAR_ID = ''
process.env.GOOGLE_MEET_STAFF_COHOSTS = 'off'; process.env.GOOGLE_WORKSPACE_DOMAIN = 'workspace.invalid'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'hybrid-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'hybrid-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
await import('dotenv/config')
if (['GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_MEET_HOST_EMAIL', 'GOOGLE_CALENDAR_ID'].some(k => process.env[k])) {
  console.error('REFUSING TO RUN — a Google credential reached the suite; it would create real meetings'); process.exit(1)
}
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_hybridclass_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()
await M.MutexModel.syncIndexes()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash  = await hashPassword(PW)
  let seq = 0
  const mk = (name: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email: `u${seq++}@hy.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    organizationId: dubai._id, ...extra,
  })
  const staffLogin = async (u: any) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/admin/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`staff login ${u.name}: ${why(r)}`)
    return jar
  }
  const studentJars = new Map<string, Jar>()
  const studentLogin = async (u: any) => {
    const known = studentJars.get(String(u._id))
    if (known) return known
    const jar: Jar = new Map()
    studentJars.set(String(u._id), jar)
    const r = await call('POST', '/auth/login', { jar, body: { email: u.email, password: PW } })
    if (r.status !== 200) throw new Error(`student login ${u.name}: ${why(r)}`)
    return jar
  }

  const teacher = await mk('Fx Teacher', 'instructor', { category: '4x-trading' })
  const admin   = await mk('Admin', 'admin')
  const ADMIN   = await staffLogin(admin)
  const course  = await M.CourseModel.create({
    title: 'Forex Course', slug: `fx-${Date.now()}`, description: 'd', instructorId: teacher._id, price: 0, isFree: true,
    status: 'published', language: 'English', organizationId: dubai._id, program: '4x-trading',
  })
  const section1 = await M.SectionModel.create({ courseId: course._id, title: 'MBT 1', order: 1 })
  const students = await Promise.all(['Amal', 'Basil', 'Chitra'].map(n => mk(n, 'student', {
    enrollmentStatus: 'approved', category: '4x-trading', categories: ['4x-trading'],
  })))
  for (const s of students) await M.EnrollmentModel.create({ userId: s._id, courseId: course._id, status: 'active' })

  const start = new Date(Date.now() + 2 * 86_400_000)
  const inPerson = {
    courseId: String(course._id), sectionId: String(section1._id), title: 'MBT 1 · Classroom',
    description: 'Bring a laptop', scheduledStart: start.toISOString(), durationMins: 90,
    sessionCapacity: 25, instructorId: String(teacher._id), language: 'English',
    type: 'external', isOnline: false, location: 'Main Campus, Dubai', room: 'Room 204',
  }

  /* ═══ A ═══ */
  section('A. One request, two linked classes')
  const r = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, alsoOnline: { type: 'internal', provider: 'livekit', sessionCapacity: 30 } } })
  const room = r.body?.data, twin = r.body?.data?.twin
  check('A1 201, the in-person class with its twin', r.status === 201 && !!room?.id && !!twin?.id, why(r))
  check('A2 both carry the same hybridPairId', !!room?.hybridPairId && room?.hybridPairId === twin?.hybridPairId, `${room?.hybridPairId} / ${twin?.hybridPairId}`)
  check('A3 the class stays in person (venue and room kept)', room?.isOnline === false && room?.location === 'Main Campus, Dubai' && room?.room === 'Room 204')
  check('A4 the twin is online, in-app interactive, no venue', twin?.isOnline === true && twin?.type === 'internal' && !twin?.location && !twin?.room, JSON.stringify({ o: twin?.isOnline, t: twin?.type, l: twin?.location }))
  const dbTwin = await M.LiveClassModel.findById(twin?.id).lean() as any
  check('A5 the twin copies course, module, title, description, start, length, instructor, language',
    String(dbTwin?.courseId) === inPerson.courseId && String(dbTwin?.sectionId) === inPerson.sectionId
      && dbTwin?.title === inPerson.title && dbTwin?.description === inPerson.description
      && new Date(dbTwin?.scheduledStart).getTime() === start.getTime() && dbTwin?.durationMins === 90
      && String(dbTwin?.instructorId) === inPerson.instructorId && dbTwin?.language === 'English',
    JSON.stringify({ c: dbTwin?.courseId, s: dbTwin?.sectionId, t: dbTwin?.title }))
  check('A6 seats are separate: 25 in the room, 30 online', room?.sessionCapacity === 25 && twin?.sessionCapacity === 30, `${room?.sessionCapacity} / ${twin?.sessionCapacity}`)
  check('A7 the twin keeps the engine asked for (livekit)', dbTwin?.provider === 'livekit', dbTwin?.provider)

  /* ═══ B ═══ */
  section('B. Every enrolled student is told once')
  await sleep(800)
  const perStudent = await Promise.all(students.map(s => M.NotificationModel.countDocuments({ userId: s._id })))
  check('B1 one notification per student for the hybrid class, not two', perStudent.every(n => n === 1), JSON.stringify(perStudent))

  /* ═══ C ═══ */
  section('C. alsoOnline only belongs on an in-person class')
  const onOnline = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, isOnline: true, location: undefined, room: undefined, type: 'internal', provider: 'livekit', alsoOnline: { type: 'internal', provider: 'livekit' } } })
  check('C1 on an online class: 422 HYBRID_NEEDS_IN_PERSON', onOnline.status === 422 && onOnline.body?.error?.code === 'HYBRID_NEEDS_IN_PERSON', why(onOnline))
  const noFlag = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, isOnline: undefined, alsoOnline: { type: 'internal', provider: 'livekit' } } })
  check('C2 without isOnline:false: 422', noFlag.status === 422, why(noFlag))
  const junk = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, alsoOnline: { type: 'zoom' } } })
  check('C3 an unknown online type: refused by validation', junk.status === 422 || junk.status === 400, why(junk))
  const extraKey = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, alsoOnline: { type: 'internal', location: 'x' } } })
  check('C4 unexpected keys inside alsoOnline: refused', extraKey.status === 422 || extraKey.status === 400, why(extraKey))

  /* ═══ D ═══ */
  section('D. Google Meet failing for the twin creates nothing')
  const before = await M.LiveClassModel.countDocuments({})
  const meet = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, title: 'Meet twin attempt', alsoOnline: { type: 'external' } } })
  check('D1 the request fails with the Meet error (503)', meet.status === 503 && meet.body?.error?.code === 'MEET_LINK_UNAVAILABLE', why(meet))
  check('D2 and no class was created — not even the in-person one', await M.LiveClassModel.countDocuments({}) === before)

  /* ═══ E ═══ */
  section('E. One seat per student: in person or online, never both')
  const S = await studentLogin(students[0])
  const b1 = await call('POST', '/bookings', { jar: S, body: { liveClassId: room?.id } })
  check('E1 books the in-person seat', b1.status === 201, why(b1))
  const b2 = await call('POST', '/bookings', { jar: S, body: { liveClassId: twin?.id } })
  check('E2 the online twin is refused: 409 TWIN_BOOKED', b2.status === 409 && b2.body?.error?.code === 'TWIN_BOOKED', why(b2))
  check('E3 and the message says which seat they hold and what to do', /in-person seat/.test(b2.body?.error?.message ?? '') && /join online/.test(b2.body?.error?.message ?? ''), b2.body?.error?.message)
  const bookingId = b1.body?.data?._id ?? b1.body?.data?.id
  const cancel = await call('DELETE', `/bookings/${bookingId}`, { jar: S })
  check('(cancels the in-person seat)', cancel.status === 200, why(cancel))
  const b3 = await call('POST', '/bookings', { jar: S, body: { liveClassId: twin?.id } })
  check('E4 now the online seat books', b3.status === 201, why(b3))
  const b4 = await call('POST', '/bookings', { jar: S, body: { liveClassId: room?.id } })
  check('E5 and the reverse is refused too', b4.status === 409 && b4.body?.error?.code === 'TWIN_BOOKED' && /online seat/.test(b4.body?.error?.message ?? ''), why(b4))
  const S2 = await studentLogin(students[1])
  const other = await call('POST', '/bookings', { jar: S2, body: { liveClassId: room?.id } })
  check('E6 another student is unaffected', other.status === 201, why(other))

  /* ═══ F ═══ */
  section('F. A plain in-person create is unchanged')
  const plain = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, title: 'Plain classroom' } })
  check('F1 201, one class', plain.status === 201 && !plain.body?.data?.twin, why(plain))
  check('F2 with no hybrid link', !plain.body?.data?.hybridPairId)
  check('F3 exactly one class with that title', await M.LiveClassModel.countDocuments({ title: 'Plain classroom' }) === 1)

  /* ═══════════ QA round: the cases a tester would try ═══════════ */
  const { LiveClassService } = await import('@/services/liveClass.service.ts')
  const titled = (t: string) => M.LiveClassModel.countDocuments({ title: t })
  const hybridBody = (title: string, extra: Record<string, unknown> = {}) =>
    ({ ...inPerson, title, alsoOnline: { type: 'internal', provider: 'livekit', sessionCapacity: 30 }, ...extra })

  section('G. The in-person half is refused AFTER the twin exists: the twin is removed')
  {
    const proto = LiveClassService.prototype as any
    const realCreate = proto.create
    proto.create = function (input: any) {
      if (input?.title === 'Rollback me' && input?.isOnline === false) {
        return Promise.reject(Object.assign(new Error('simulated refusal of the in-person class'), { statusCode: 409, code: 'SIMULATED' }))
      }
      return realCreate.apply(this, arguments as any)
    }
    try {
      const rb = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Rollback me') })
      check('G1 the request fails with the in-person refusal', rb.status === 409 && rb.body?.error?.code === 'SIMULATED', why(rb))
      check('G2 and the online twin made before it is gone — no half class', await titled('Rollback me') === 0, String(await titled('Rollback me')))
    } finally { proto.create = realCreate }
  }

  section('H. Two taps at once on both twins: one seat, not two')
  {
    const pair = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Race pair') })
    const a = pair.body?.data?.id, b = pair.body?.data?.twin?.id
    const racer = students[2]!
    const R = await studentLogin(racer)
    const [x, y] = await Promise.all([
      call('POST', '/bookings', { jar: R, body: { liveClassId: a } }),
      call('POST', '/bookings', { jar: R, body: { liveClassId: b } }),
    ])
    const active = await M.ClassBookingModel.countDocuments({ userId: racer._id, liveClassId: { $in: [a, b] }, status: { $in: ['booked', 'attended'] } })
    check('H1 at most one of the two racing bookings succeeds', [x.status, y.status].filter(s => s === 201).length === 1, `${x.status} ${x.body?.error?.code ?? ''} / ${y.status} ${y.body?.error?.code ?? ''}`)
    check('H2 and the student holds exactly one active seat', active === 1, String(active))
    const seats = await M.LiveClassModel.find({ _id: { $in: [a, b] } }).select('bookedCount').lean() as any[]
    check('H3 the seat counts add up to that one booking', seats.reduce((n, c) => n + (c.bookedCount ?? 0), 0) === 1, JSON.stringify(seats.map(c => c.bookedCount)))
  }

  section('I. Deleting one twin leaves the other an ordinary class')
  {
    const pair = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Delete one') })
    const del = await call('DELETE', `/admin/live-classes/${pair.body?.data?.twin?.id}`, { jar: ADMIN })
    check('(the online twin is deleted)', del.status === 200, why(del))
    const left = await M.LiveClassModel.findById(pair.body?.data?.id).lean() as any
    check('I1 the remaining class no longer claims to be hybrid', !left?.hybridPairId, String(left?.hybridPairId))
  }

  section('J. An instructor creates a hybrid class for their own course only')
  {
    const T = await staffLogin(teacher)
    const own = await call('POST', '/admin/live-classes', { jar: T, body: hybridBody('Instructor pair', { instructorId: String(admin._id) }) })
    check('J1 201 for their own course', own.status === 201, why(own))
    const both = await M.LiveClassModel.find({ title: 'Instructor pair' }).lean() as any[]
    check('J2 both halves are theirs, whoever the body named', both.length === 2 && both.every(c => String(c.instructorId) === String(teacher._id)), JSON.stringify(both.map(c => c.instructorId)))
    const stranger = await mk('Other Teacher', 'instructor', { category: '4x-trading' })
    const S3 = await staffLogin(stranger)
    const foreign = await call('POST', '/admin/live-classes', { jar: S3, body: hybridBody('Foreign pair') })
    check('J3 another instructor\'s course: refused', foreign.status === 403 || foreign.status === 404, why(foreign))
    check('J4 and nothing was created', await titled('Foreign pair') === 0)
  }

  section('K. A sub-admin of another department creates nothing')
  {
    const dmSub = await mk('Dm Sub', 'sub_admin', { program: 'digital_marketing' })
    const D = await staffLogin(dmSub)
    const r = await call('POST', '/admin/live-classes', { jar: D, body: hybridBody('Dm pair') })
    check('K1 refused', r.status === 403 || r.status === 404, why(r))
    check('K2 and no twin was left behind', await titled('Dm pair') === 0)
  }

  section('L. Online seats are bounded like any class')
  for (const [label, seats] of [['0', 0], ['501', 501], ['-5', -5]] as const) {
    const r = await call('POST', '/admin/live-classes', { jar: ADMIN, body: { ...inPerson, title: `Seats ${label}`, alsoOnline: { type: 'internal', provider: 'livekit', sessionCapacity: seats } } })
    check(`L online seats ${label}: refused, nothing created`, (r.status === 422 || r.status === 400) && await titled(`Seats ${label}`) === 0, why(r))
  }

  section('M. Repeating a hybrid class weekly copies it as ordinary classes')
  {
    const pair = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Repeat me') })
    const rep = await call('POST', `/admin/live-classes/${pair.body?.data?.id}/repeat`, { jar: ADMIN, body: { weeks: 2 } })
    check('(repeat accepted)', rep.status === 200 || rep.status === 201, why(rep))
    const all = await M.LiveClassModel.find({ title: 'Repeat me' }).lean() as any[]
    const linked = all.filter(c => c.hybridPairId)
    check('M1 only the original pair is linked; the weekly copies are not', linked.length === 2 && all.length === 4, `${linked.length} linked of ${all.length}`)
  }

  section('N. Cancelling one twin frees the student to book the other')
  {
    const pair = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Cancel one') })
    const C = await studentLogin(students[1]!)
    const b1 = await call('POST', '/bookings', { jar: C, body: { liveClassId: pair.body?.data?.id } })
    check('(booked in person)', b1.status === 201, why(b1))
    const cx = await call('PATCH', `/admin/live-classes/${pair.body?.data?.id}`, { jar: ADMIN, body: { status: 'cancelled' } })
    check('(the in-person class is cancelled)', cx.status === 200, why(cx))
    const b2 = await call('POST', '/bookings', { jar: C, body: { liveClassId: pair.body?.data?.twin?.id } })
    check('N1 the online twin can now be booked', b2.status === 201, why(b2))
  }

  section('O. An admin may still seat a student in the other twin on purpose')
  {
    const pair = await call('POST', '/admin/live-classes', { jar: ADMIN, body: hybridBody('Admin override') })
    const S1 = await studentLogin(students[0]!)
    const b = await call('POST', '/bookings', { jar: S1, body: { liveClassId: pair.body?.data?.id } })
    check('(student books in person)', b.status === 201, why(b))
    const ab = await call('POST', '/admin/bookings/book-for-student', { jar: ADMIN, body: { liveClassId: pair.body?.data?.twin?.id, studentId: String(students[0]!._id) } })
    check('O1 the admin booking is not blocked by the student rule', ab.status === 201 || ab.status === 200, why(ab))
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  server.close()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
