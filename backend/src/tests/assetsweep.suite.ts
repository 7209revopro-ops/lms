/* ─────────────────────────────────────────────────────────────
   NO endpoint may hand the browser a raw pub-*.r2.dev URL.

   asseturls.suite.ts asserts this for the handful of endpoints somebody
   thought to call. That is the weakness: the bug it was written for survived
   in /admin/bookings precisely because nobody had thought to call it, and the
   structural half only knew one of the two ways to bypass the rewrite.

   So this suite does not pick endpoints. It ENUMERATES them out of the live
   Express router stack, seeds a stored `pub-*.r2.dev` avatar onto every
   relationship that can carry one, calls every GET route it can fill in, and
   fails if the string `.r2.dev` appears in ANY response body.

   A route added next month is covered the day it is mounted, without anyone
   remembering to extend a list.

   Two things keep it honest rather than merely green:
     · it reports how many routes it actually reached, and fails if that
       collapses — a sweep that silently stops calling things always passes;
     · it proves the probe works by checking the seed really is an r2.dev URL
       in the database, so "no leak" cannot mean "no data".

   Run: bun run test:assetsweep
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_assetsweep'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.EMAIL_FROM   = ''
process.env.RATE_LIMIT_AUTH_MAX = '2000'
process.env.RATE_LIMIT_API_MAX  = '20000'
process.env.RATE_LIMIT_SEARCH_MAX = '20000'
process.env.BACKEND_PUBLIC_URL  = 'http://127.0.0.1:8000'
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''

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
  UserModel, OrganizationModel, CourseModel, SectionModel, LessonModel,
  LiveClassModel, EnrollmentModel, ClassBookingModel, ClassFeedbackModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_assetsweep') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const PORT = (server.address() as { port: number }).port
const ROOT = `http://127.0.0.1:${PORT}`
const BASE = `${ROOT}/api/v1`

/* The exact shape the private bucket left behind on every stored avatar. */
const R2 = 'https://pub-141ff6250c1340699608dcd12e1c2c92.r2.dev'
const AVATAR = `${R2}/avatars/sweep-probe.png`
const THUMB  = `${R2}/images/sweep-thumb.png`
const PW = 'SweepPass1'

type Jar = Map<string, string>
async function call(method: string, url: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  return { status: res.status, text }
}

try {

/* ═════════════ Seed: an r2.dev URL on everything that can hold one ═════════════ */
section('A · the fixtures')
const org = await OrganizationModel.create({
  name: 'Sweep Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword(PW)

const teacher = await UserModel.create({
  name: 'Sweep Instructor', email: 'sweep.teacher@sw.local', passwordHash: hash,
  role: 'instructor', isActive: true, isVerified: true,
  organizationId: org._id, avatarUrl: AVATAR,
})
const admin = await UserModel.create({
  name: 'Sweep Admin', email: 'sweep.admin@sw.local', passwordHash: hash,
  role: 'admin', isActive: true, isVerified: true,
  organizationId: org._id, avatarUrl: AVATAR,
})
const student = await UserModel.create({
  name: 'Sweep Student', email: 'sweep.student@sw.local', passwordHash: hash,
  role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved',
  organizationId: org._id, avatarUrl: AVATAR,
})

const course = await CourseModel.create({
  title: 'Sweep Course', slug: 'sweep-course', description: 'A course.',
  instructorId: teacher._id, price: 0, isFree: true, status: 'published',
  language: 'English', organizationId: org._id, thumbnailUrl: THUMB,
})
const sec    = await SectionModel.create({ courseId: course._id, title: 'Module 1', order: 1 })
const lesson = await LessonModel.create({
  courseId: course._id, sectionId: sec._id, title: 'Lesson 1', type: 'article', order: 1,
})
const live = await LiveClassModel.create({
  title: 'Sweep Session', courseId: course._id, sectionId: sec._id, instructorId: teacher._id,
  organizationId: org._id, scheduledStart: new Date(Date.now() + 6 * 36e5),
  durationMins: 60, type: 'external', isOnline: true, status: 'scheduled',
  sessionCapacity: 30, bookedCount: 1, language: 'English',
})
await EnrollmentModel.create({ userId: student._id, courseId: course._id, status: 'active' })
const booking = await ClassBookingModel.create({
  userId: student._id, liveClassId: live._id, status: 'booked', bookedAt: new Date(),
})
await ClassFeedbackModel.create({
  userId: student._id, liveClassId: live._id, rating: 5, comment: 'Great.',
})

/* The probe is only meaningful if the seed really is an r2.dev value. */
const seeded = await UserModel.findById(teacher._id).lean() as any
check('A1 the seeded avatar really is a pub-*.r2.dev URL',
  String(seeded?.avatarUrl).includes('.r2.dev'), String(seeded?.avatarUrl))
check('A2 the seeded course thumbnail is too',
  String((await CourseModel.findById(course._id).lean() as any)?.thumbnailUrl).includes('.r2.dev'))

/* ═════════════ Enumerate every GET route from the router stack ═════════════ */
section('B · enumerating the routes')

function collectGets(): string[] {
  const out = new Set<string>()
  const stack = (app as any)._router?.stack ?? (app as any).router?.stack ?? []

  const walk = (layers: any[], prefix: string) => {
    for (const l of layers) {
      if (l.route) {
        if (l.route.methods?.get) out.add(prefix + (l.route.path === '/' ? '' : l.route.path))
        continue
      }
      if (l.name === 'router' && l.handle?.stack) {
        /* Recover the mount path from the layer's regexp — Express does not
           keep it anywhere friendlier. */
        const src: string = l.regexp?.source ?? ''
        let mount = src
          .replace('^\\/', '/')
          .replace('\\/?(?=\\/|$)', '')
          .replace(/\\\//g, '/')
          .replace(/\$$/, '')
          .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, '')
        if (mount === '/^' || mount.includes('(?')) mount = ''
        walk(l.handle.stack, prefix + (mount === '/' ? '' : mount))
      }
    }
  }
  walk(stack, '')
  return [...out]
}

const routes = collectGets()
check('B1 the router stack was readable', routes.length > 20, `${routes.length} GET routes`)

/* Fill :params from the seeded fixtures. A route whose params we cannot fill
   is skipped and counted, never silently dropped. */
const PARAM: Record<string, string> = {
  id:            String(live._id),
  slug:          'sweep-course',
  courseId:      String(course._id),
  sectionId:     String(sec._id),
  lessonId:      String(lesson._id),
  liveClassId:   String(live._id),
  userId:        String(student._id),
  bookingId:     String(booking._id),
  instructorId:  String(teacher._id),
  organizationId: String(org._id),
}

function fill(path: string): string | null {
  if (path.includes('*')) return null
  const parts = path.split('/')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (!p.startsWith(':')) continue
    const name = p.slice(1).replace(/\?$/, '')
    const v = PARAM[name]
    if (!v) return null
    parts[i] = v
  }
  return parts.join('/')
}

/* ═════════════ The sweep ═════════════ */
section('C · calling every reachable GET route as three different callers')

const adminJar: Jar = new Map()
await call('POST', `${BASE}/admin/auth/login`, adminJar, { email: admin.email, password: PW })
check('C1 the admin session is live', adminJar.size > 0, `${adminJar.size} cookies`)

const teacherJar: Jar = new Map()
await call('POST', `${BASE}/admin/auth/login`, teacherJar, { email: teacher.email, password: PW })
check('C2 the instructor session is live', teacherJar.size > 0, `${teacherJar.size} cookies`)

const studentJar: Jar = new Map()
await call('POST', `${BASE}/auth/login`, studentJar, { email: student.email, password: PW })
check('C3 the student session is live', studentJar.size > 0, `${studentJar.size} cookies`)

const callers: [string, Jar][] = [
  ['admin', adminJar], ['instructor', teacherJar], ['student', studentJar],
]

let called = 0, skipped = 0, errored = 0
const leaks: string[] = []

for (const path of routes.sort()) {
  const filled = fill(path)
  if (filled === null) { skipped++; continue }
  /* The asset proxy streams bytes from a bucket; it is not a JSON envelope
     and has no URLs to rewrite. */
  if (filled.startsWith('/assets')) { skipped++; continue }

  const url = filled.startsWith('/api/') ? `${ROOT}${filled}` : `${BASE}${filled}`
  for (const [who, jar] of callers) {
    try {
      const r = await call('GET', url, jar)
      called++
      if (r.text.includes('.r2.dev')) {
        const sample = r.text.split('"').find(x => x.includes('.r2.dev')) ?? ''
        leaks.push(`${who} GET ${filled} → ${r.status}  ${sample.slice(0, 90)}`)
      }
    } catch { errored++ }
  }
}

lines.push(`  ..  ${routes.length} GET routes discovered, ${called} calls made, ` +
           `${skipped} unfillable, ${errored} threw`)

/* A sweep that stops reaching things passes for the wrong reason. */
check('C4 the sweep actually reached a meaningful number of endpoints',
  called >= 90, `${called} calls`)

check('C5 NO endpoint leaked a raw r2.dev URL to any caller',
  leaks.length === 0,
  leaks.slice(0, 6).join('  ||  '))

/* ═════════════ The probe proves itself ═════════════ */
section('D · the probe can actually detect a leak')
{
  /* If nothing in the app ever emitted this avatar, C5 would pass whatever
     the rewrite did. Prove at least one swept endpoint really did carry the
     seeded image — as a PROXIED url. */
  const r = await call('GET', `${BASE}/live-classes`, studentJar)
  check('D1 a swept endpoint really did serve the seeded avatar',
    r.text.includes('/assets/avatars/sweep-probe.png'), String(r.status))
  check('D2 ...and not the stored r2.dev form', !r.text.includes('.r2.dev'))

  const b = await call('GET', `${BASE}/admin/bookings?per_page=50`, adminJar)
  check('D3 the bookings table serves it proxied too',
    b.text.includes('/assets/avatars/sweep-probe.png'), String(b.status))
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
console.log(`\nassetsweep.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
