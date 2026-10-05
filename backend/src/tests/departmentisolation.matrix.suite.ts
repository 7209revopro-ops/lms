/* ─────────────────────────────────────────────────────────────
   Department isolation — the ID-SUBSTITUTION MATRIX (plan.md §10).

   Every route the app registers is read from the live Express router, so a
   route added tomorrow is probed tomorrow without anyone remembering to. Each
   route that takes an id is called by a department head with ANOTHER
   department's ids (and again with its own, and with a malformed id):

     reads   a 2xx whose body names any of the other department's records is a
             LEAK (an echo of the very id in the URL does not count)
     writes  the other department's data is fingerprinted before and after the
             call; any change is a LEAK, whatever status came back
     any     a 5xx is a BUG — a guard that throws, a cast that was never
             validated

   The Forex head probes DM's records, the DM head probes Forex's, and a head
   with no department probes both — they must reach nothing.

   Boots against an ISOLATED throwaway database, dropped on exit; every outside
   service is blanked. Run: bun run test:departmentisolation-matrix
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_departmentisolation_matrix_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.RATE_LIMIT_AUTH_MAX = '5000'
process.env.RATE_LIMIT_API_MAX  = '900000'
process.env.CROSS_ORG_CLASSES   = 'true'
/* Bun loads backend/.env first: blank every outside service it may configure. */
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'SMTP_BACKUP_HOST', 'SMTP_BACKUP_USER', 'SMTP_BACKUP_PASS',
  'WHATSAPP_API_KEY', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_MEET_HOST_EMAIL', 'GOOGLE_CALENDAR_ID', 'CLT_BASE_URL', 'CLT_PUBLIC_URL', 'CLT_S2S_SECRET', 'PROXY_SHARED_SECRET',
  'FINANCE_API_URL', 'FINANCE_S2S_SECRET', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET', 'COMMISSION_API_URL', 'COMMISSION_S2S_SECRET',
  'SALES_CRM_SECRET', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'TABBY_SECRET_KEY', 'TABBY_PUBLIC_KEY', 'TAMARA_API_KEY', 'ABZER_ACCESS_KEY', 'ABZER_SECRET_KEY', 'SENTRY_DSN',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']) {
  process.env[k] = ''
}
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

await import('./financeStandIn.ts')
const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_departmentisolation_matrix_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`

type Jar = Map<string, string>
async function call(method: string, path: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: 'manual' })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, text }
}

/* ── Routes, from the live router ─────────────────────── */
type Route = { method: string; path: string }
function mountOf(layer: any): string {
  if (layer.regexp?.fast_slash) return ''
  let src: string = layer.regexp.source
  src = src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\(\?=\\\/\|\$\)$/, '').replace(/\$$/, '')
  let k = 0
  src = src.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => ':' + (layer.keys?.[k++]?.name ?? 'p'))
  return src.replace(/\\\//g, '/').replace(/\\-/g, '-').replace(/\\\./g, '.')
}
function collect(stack: any[], prefix: string, out: Route[]) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const p of paths) {
        if (typeof p !== 'string') continue
        for (const [m, on] of Object.entries(layer.route.methods)) if (on && m !== '_all') out.push({ method: m.toUpperCase(), path: (prefix + p).replace(/\/+/g, '/') })
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collect(layer.handle.stack, prefix + mountOf(layer), out)
    }
  }
}
const all: Route[] = []
collect((app as any)._router.stack, '', all)
const SKIP = /^\/api\/v1\/(auth|service|checkout|webhooks|integrations|ai|uploads\/(image|document|video|presign|multipart))\b/
const routes = [...new Map(all.filter(r => r.path.includes('/:') && !SKIP.test(r.path)).map(r => [`${r.method} ${r.path}`, r])).values()]

/* ── Two departments' worth of records ────────────────── */
const PW = 'CorrectHorse1'
const hash = await hashPassword(PW)
const H = 3_600_000
const dubai = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const org = dubai._id
let n = 0
const mk = (name: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
  name, email: `${name.toLowerCase().replace(/\W+/g, '.')}.${++n}@mx.test`, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org, ...extra })

type World = Record<string, any>
async function department(tag: 'fx' | 'dm', dept: string, program: string): Promise<World> {
  const head = await mk(`${tag} head`, 'sub_admin', { program })
  const inst = await mk(`${tag} teacher`, 'instructor', { category: dept })
  const stu  = await mk(`${tag} student`, 'student', { category: dept, categories: [dept], enrollmentStatus: 'approved' })
  const app_ = await mk(`${tag} applicant`, 'student', { categories: [], enrollmentStatus: 'pending', enrollmentApplication: { programs: [tag === 'fx' ? 'forex-beginner' : 'dm-seo'], passportUrl: `/uploads/images/${tag}-passport.jpg` } })
  const expr = await mk(`${tag} express`, 'student', { signupType: 'express', category: dept, categories: [dept], enrollmentStatus: 'approved' })
  const course = await M.CourseModel.create({ title: `${tag} course`, slug: `${tag}-course-${Date.now()}`, description: 'd', instructorId: inst._id,
    price: 0, isFree: true, status: 'published', language: 'English', organizationId: org, program: dept })
  const sectionId = new mongoose.Types.ObjectId(), lessonId = new mongoose.Types.ObjectId()
  await M.SectionModel.collection.insertOne({ _id: sectionId, courseId: course._id, title: `${tag} module`, order: 1, organizationId: org })
  await M.LessonModel.collection.insertOne({ _id: lessonId, courseId: course._id, sectionId, title: `${tag} lesson`, type: 'video', order: 1, organizationId: org })
  const enrolment = await M.EnrollmentModel.create({ userId: stu._id, courseId: course._id, status: 'active', organizationId: org })
  await M.EnrollmentModel.create({ userId: expr._id, courseId: course._id, status: 'active', organizationId: org })
  const cls = await M.LiveClassModel.create({ title: `${tag} upcoming class`, courseId: course._id, instructorId: inst._id, organizationId: org,
    scheduledStart: new Date(Date.now() + 48 * H), durationMins: 60, type: 'external', isOnline: false, location: 'Campus', sessionCapacity: 30, language: 'English' })
  const past = await M.LiveClassModel.create({ title: `${tag} past class`, courseId: course._id, instructorId: inst._id, organizationId: org,
    scheduledStart: new Date(Date.now() - 3 * H), durationMins: 60, type: 'external', isOnline: false, location: 'Campus', sessionCapacity: 30, language: 'English',
    status: 'ended', mentorNoShowAlertSent: true })
  const booking = await M.ClassBookingModel.create({ userId: stu._id, liveClassId: past._id, status: 'booked', bookedAt: new Date(Date.now() - 4 * 24 * H) })
  await M.ClassBookingModel.create({ userId: stu._id, liveClassId: cls._id, status: 'booked', bookedAt: new Date() })
  const assignment = await M.ClassAssignmentModel.create({ studentId: stu._id, liveClassId: past._id, courseId: course._id, instructorId: inst._id, organizationId: org, title: `${tag} homework` })
  const ticket = await M.SupportTicketModel.create({ userId: stu._id, subject: `${tag} ticket`, category: 'technical', organizationId: org, program: dept,
    messages: [{ senderId: stu._id, senderRole: 'student', body: `${tag} needs help`, createdAt: new Date() }] })
  const device = await M.DeviceModel.create({ userId: stu._id, deviceId: `${tag}-device`, status: 'pending' })
  await M.MentorAvailabilityModel.create({ mentorId: inst._id, slots: [] })
  const meetingId = new mongoose.Types.ObjectId()
  await M.MentorMeetingModel.collection.insertOne({ _id: meetingId, mentorId: inst._id, title: `${tag} meeting`, kind: 'consultation',
    scheduledStart: new Date(Date.now() + 24 * H), durationMins: 30, attendees: [{ name: `${tag} client`, email: `${tag}.client@mx.test` }], cancelledAt: null, bookedByEmail: 'root@mx.test' })
  const reviewId = new mongoose.Types.ObjectId()
  await M.ReviewModel.collection.insertOne({ _id: reviewId, userId: stu._id, courseId: course._id, rating: 4, comment: `${tag} review`, createdAt: new Date() })
  await M.ClassFeedbackModel.collection.insertOne({ liveClassId: past._id, userId: stu._id, rating: 5, comment: `${tag} feedback`, createdAt: new Date() })
  const examId = new mongoose.Types.ObjectId()
  await M.ExamModel.collection.insertOne({ _id: examId, courseId: course._id, title: `${tag} exam`, organizationId: org, questions: [] })
  return { tag, dept, program, head, inst, stu, applicant: app_, express: expr, course, sectionId, lessonId, enrolment, cls, past, booking, assignment, ticket, device, meetingId, reviewId, examId }
}
const FX = await department('fx', '4x-trading', 'forex')
const DM = await department('dm', 'digital-marketing', 'digital_marketing')
const noDept = await mk('no dept head', 'sub_admin')
const admin = await mk('the admin', 'admin')

const login = async (u: any) => {
  const jar: Jar = new Map()
  const r = await call('POST', '/api/v1/admin/auth/login', { jar, body: { email: u.email, password: PW } })
  if (r.status !== 200) throw new Error(`login ${u.email}: ${r.status} ${r.text.slice(0, 200)}`)
  return jar
}

/* ── Which record an id parameter means ───────────────── */
type Kind = 'course' | 'section' | 'lesson' | 'class' | 'booking' | 'assignment' | 'ticket' | 'device' | 'enrolment'
  | 'student' | 'instructor' | 'applicant' | 'review' | 'exam' | 'meeting' | 'user'
const BY_PREV: Record<string, Kind> = {
  'courses': 'course', 'sections': 'section', 'lessons': 'lesson', 'live-classes': 'class', 'bookings': 'booking',
  'class-assignments': 'assignment', 'support': 'ticket', 'devices': 'device', 'enrollments': 'enrolment', 'users': 'user',
  'mentors': 'instructor', 'instructor': 'instructor', 'instructors': 'instructor', 'enrollment-requests': 'applicant',
  'express-members': 'student', 'documents': 'student', 'recordings': 'class', 'reviews': 'review', 'exams': 'exam',
  'feedback': 'class', 'meetings': 'meeting', 'students': 'student',
}
const BY_NAME: Record<string, Kind> = {
  courseId: 'course', sectionId: 'section', lessonId: 'lesson', liveClassId: 'class', classId: 'class', sessionId: 'class',
  bookingId: 'booking', assignmentId: 'assignment', ticketId: 'ticket', deviceId: 'device', enrollmentId: 'enrolment',
  userId: 'user', studentId: 'student', instructorId: 'instructor', mentorId: 'instructor', reviewId: 'review', examId: 'exam',
}
/* Each kind → the records it may name (a user-shaped id is tried as each). */
const idsFor = (w: World, k: Kind): string[] => {
  switch (k) {
    case 'course': return [w.course._id]; case 'section': return [w.sectionId]; case 'lesson': return [w.lessonId]
    case 'class': return [w.cls._id, w.past._id]; case 'booking': return [w.booking._id]; case 'assignment': return [w.assignment._id]
    case 'ticket': return [w.ticket._id]; case 'device': return [w.device._id]; case 'enrolment': return [w.enrolment._id]
    case 'student': return [w.stu._id, w.express._id]; case 'instructor': return [w.inst._id]; case 'applicant': return [w.applicant._id, w.stu._id]
    case 'review': return [w.reviewId]; case 'exam': return [w.examId]; case 'meeting': return [w.meetingId]
    case 'user': return [w.stu._id, w.inst._id, w.applicant._id]
  }
}
function instantiate(path: string, w: World | null): string[] {
  return instantiateMapped(path, w).map(v => v.url)
}
function instantiateMapped(path: string, w: World | null): Array<{ url: string; mapped: boolean }> {
  const segs = path.split('/')
  let variants: Array<{ parts: string[]; mapped: boolean }> = [{ parts: [], mapped: true }]
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    if (!s.startsWith(':')) { variants = variants.map(v => ({ parts: [...v.parts, s], mapped: v.mapped })); continue }
    const name = s.slice(1).replace(/\(.*\)$/, '').replace(/\?$/, '')
    let vals: string[]
    let mapped = true
    if (name === 'field') vals = ['passport']
    else if (name === 'key') vals = ['images/matrix-probe.jpg']
    else if (w === null) vals = ['not-an-id']
    else {
      const kind = name === 'id' ? BY_PREV[segs[i - 1] ?? ''] : BY_NAME[name]
      vals = kind ? idsFor(w, kind).map(String) : [String(new mongoose.Types.ObjectId())]
      mapped = !!kind
    }
    variants = variants.flatMap(v => vals.map(x => ({ parts: [...v.parts, x], mapped: v.mapped && mapped })))
  }
  const seen = new Map<string, boolean>()
  for (const v of variants) seen.set(v.parts.join('/'), v.mapped)
  return [...seen].map(([url, mapped]) => ({ url, mapped }))
}

/* Bodies that reach past validation for the writes that matter most. */
const BODIES: Array<[RegExp, (victim: World) => unknown]> = [
  [/\/enrollment-requests\/[^/]+\/(reject|cancel)$/, () => ({ reason: 'Matrix probe — reject attempt' })],
  [/\/enrollment-requests\/[^/]+\/remove-category$/, v => ({ category: v.dept })],
  [/\/enrollment-requests\/[^/]+\/docs$/, () => ({ passportUrl: '/uploads/images/matrix.jpg' })],
  [/\/support\/[^/]+\/status$/, () => ({ status: 'closed' })],
  [/\/support\/[^/]+\/messages$/, () => ({ body: 'Matrix probe message' })],
  [/\/class-assignments\/[^/]+\/review$/, () => ({ decision: 'approved', feedback: 'Matrix probe' })],
  [/\/live-classes\/[^/]+\/repeat$/, () => ({ weeks: 1 })],
  [/\/live-classes\/[^/]+\/backup-link$/, () => ({ url: 'https://meet.google.com/abc-defg-hij' })],
  [/\/mentors\/[^/]+\/availability$/, () => ({ slots: [] })],
  [/\/bookings\/[^/]+\/attendance$/, () => ({ status: 'attended' })],
  [/\/users\/[^/]+\/enrollments$/, () => ({ courseId: String(FX.course._id) })],
  [/\/enrollments\/[^/]+$/, () => ({ blockedLessons: [] })],
  [/\/live-classes\/[^/]+$/, () => ({ title: 'Matrix probe rename' })],
  [/\/users\/[^/]+$/, () => ({ name: 'Matrix probe rename' })],
]
const bodyFor = (path: string, victim: World) => BODIES.find(([re]) => re.test(path))?.[1](victim) ?? {}

/* ── The victim's data, fingerprinted ──────────────────── */
async function fingerprint(w: World): Promise<string> {
  const db = mongoose.connection.db!
  const users = [w.head._id, w.inst._id, w.stu._id, w.applicant._id, w.express._id]
  const classes = [w.cls._id, w.past._id]
  const q: Array<[string, Record<string, unknown>]> = [
    ['users', { _id: { $in: users.slice(1) } }],
    ['courses', { _id: w.course._id }],
    ['sections', { courseId: w.course._id }], ['lessons', { courseId: w.course._id }],
    ['liveclasses', { courseId: w.course._id }],
    ['classbookings', { $or: [{ liveClassId: { $in: classes } }, { userId: { $in: users } }] }],
    ['enrollments', { $or: [{ courseId: w.course._id }, { userId: { $in: users } }] }],
    ['classassignments', { courseId: w.course._id }],
    ['supporttickets', { $or: [{ _id: w.ticket._id }, { userId: { $in: users } }] }],
    ['devices', { userId: { $in: users } }],
    ['mentoravailabilities', { mentorId: w.inst._id }], ['mentormeetings', { mentorId: w.inst._id }],
    ['reviews', { courseId: w.course._id }], ['classfeedbacks', { liveClassId: { $in: classes } }],
    ['exams', { courseId: w.course._id }],
  ]
  const parts: string[] = []
  for (const [c, f] of q) {
    const docs = await db.collection(c).find(f).sort({ _id: 1 }).toArray()
    parts.push(`${c}:${JSON.stringify(docs)}`)
  }
  return parts.join('\n')
}
const markersOf = (w: World): string[] => [
  w.inst._id, w.stu._id, w.applicant._id, w.express._id, w.course._id, w.sectionId, w.lessonId, w.cls._id, w.past._id,
  w.booking._id, w.assignment._id, w.ticket._id, w.device._id, w.enrolment._id, w.meetingId, w.reviewId, w.examId,
].map(String).concat([`${w.tag} teacher`, `${w.tag} student`, `${w.tag} applicant`, `${w.tag} course`, `${w.tag} upcoming class`,
  `${w.tag} past class`, `${w.tag} homework`, `${w.tag} ticket`, `${w.tag} meeting`, `${w.tag} review`, `${w.tag} feedback`, `${w.tag} exam`])

/* ── Probe ─────────────────────────────────────────────── */
type Finding = { kind: 'LEAK' | 'WRITE' | 'BUG' | 'OVERBLOCK'; who: string; call: string; detail: string }
const findings: Finding[] = []
const publicRoutes = new Set<string>()
const stats = { calls: 0, byStatus: new Map<number, number>() }
const count = (s: number) => { stats.calls++; stats.byStatus.set(s, (stats.byStatus.get(s) ?? 0) + 1) }

async function probe(who: string, jar: Jar, victims: World[], own: World | null) {
  for (const victim of victims) {
    const marks = markersOf(victim)
    for (const r of routes) {
      for (const url of instantiate(r.path, victim)) {
        const isWrite = r.method !== 'GET' && r.method !== 'HEAD'
        const before = isWrite ? await fingerprint(victim) : ''
        const res = await call(r.method, url, { jar, body: isWrite ? bodyFor(url, victim) : undefined })
        count(res.status)
        const tag = `${r.method} ${url}`
        if (res.status >= 500) findings.push({ kind: 'BUG', who, call: tag, detail: `${res.status} ${res.text.slice(0, 120)}` })
        if (isWrite) {
          const after = await fingerprint(victim)
          if (after !== before) findings.push({ kind: 'WRITE', who, call: tag, detail: `${res.status} — the other department's data changed` })
        } else if (res.status >= 200 && res.status < 300) {
          const inUrl = new Set(url.split('/'))
          const hit = marks.filter(m => !inUrl.has(m) && res.text.includes(m))
          if (hit.length) {
            /* What a visitor with no session gets too is public, not a department's. */
            const anon = await call('GET', url)
            const publicToo = anon.status >= 200 && anon.status < 300 && hit.every(m => anon.text.includes(m))
            if (publicToo) publicRoutes.add(`GET ${r.path}`)
            else findings.push({ kind: 'LEAK', who, call: tag, detail: `${res.status} names ${hit.slice(0, 3).join(', ')}` })
          }
        }
      }
    }
  }
  /* The same reads with the caller's OWN ids must not be refused as "not found". */
  if (own) {
    for (const r of routes.filter(x => x.method === 'GET')) {
      for (const { url, mapped } of instantiateMapped(r.path, own)) {
        if (!mapped) continue
        const res = await call('GET', url, { jar })
        count(res.status)
        if (res.status >= 500) findings.push({ kind: 'BUG', who, call: `GET ${url} (own)`, detail: `${res.status} ${res.text.slice(0, 120)}` })
        if (res.status === 404 && /department|not found/i.test(res.text) && /^\/api\/v1\/admin\//.test(url)) {
          findings.push({ kind: 'OVERBLOCK', who, call: `GET ${url} (own)`, detail: res.text.slice(0, 120) })
        }
      }
    }
  }
  /* Malformed ids never crash a route. */
  for (const r of routes) {
    for (const url of instantiate(r.path, null)) {
      const res = await call(r.method, url, { jar, body: r.method === 'GET' ? undefined : {} })
      count(res.status)
      if (res.status >= 500) findings.push({ kind: 'BUG', who, call: `${r.method} ${url} (malformed id)`, detail: `${res.status} ${res.text.slice(0, 120)}` })
    }
  }
}

try {
  const jarFx = await login(FX.head), jarDm = await login(DM.head), jarNone = await login(noDept)
  void admin
  section(`Routes — ${all.length} registered, ${routes.length} take an id and are probed`)
  check('the router walk found the admin surface', routes.some(r => r.path === '/api/v1/admin/live-classes/:id') && routes.some(r => r.path === '/api/v1/support/:id'),
    `sample: ${routes.slice(0, 5).map(r => `${r.method} ${r.path}`).join(' | ')}`)

  await probe('Forex head', jarFx, [DM], FX)
  await probe('DM head', jarDm, [FX], DM)
  await probe('no-department head', jarNone, [FX, DM], null)

  section(`Results — ${stats.calls} calls; statuses ${[...stats.byStatus].sort((a, b) => a[0] - b[0]).map(([s, c]) => `${s}×${c}`).join(' ')}`)
  if (publicRoutes.size) lines.push(`  INFO  public to anonymous visitors too (not a department leak): ${[...publicRoutes].join(', ')}`)
  for (const kind of ['LEAK', 'WRITE', 'BUG', 'OVERBLOCK'] as const) {
    const f = findings.filter(x => x.kind === kind)
    check(`${kind}: none`, f.length === 0, f.slice(0, 12).map(x => `\n        ${x.who}: ${x.call} → ${x.detail}`).join(''))
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  server.close()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ndepartmentisolation.matrix.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
