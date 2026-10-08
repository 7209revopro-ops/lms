/* ─────────────────────────────────────────────────────────────
   A Digital Marketing student sees Digital Marketing's schedule only
   (GET /live-classes — what Class Bookings shows).

     A. Digital Marketing only: Digital Marketing classes, no Forex
     B. ...plus a course they are enrolled in elsewhere (a bought AI course)
     C. a Forex student, a two-programme student and one with no programme
        yet: the whole schedule, unchanged
   Run: bun --no-env-file src/tests/dmschedule.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_dmschedule'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'dmschedule-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'dmschedule-suite-refresh-secret-0123456789'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_dmschedule') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const PW = 'CorrectHorse1'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const t = await M.UserModel.create({ name: 'T', email: 't@dm.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const mkCourse = (title: string, program: string) => M.CourseModel.create({ title, slug: `${title}-${Date.now()}`.toLowerCase().replace(/\W+/g, '-'), description: 'd',
    instructorId: t._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program })
  const dm = await mkCourse('Digital Marketing', 'digital-marketing'), fx = await mkCourse('MBT', '4x-trading'), ai = await mkCourse('AI Academy', 'ai')
  const mkClass = (title: string, courseId: unknown) => M.LiveClassModel.create({ title, courseId, instructorId: t._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + 864e5), durationMins: 60, type: 'external', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 0 })
  await mkClass('SMM 1', dm._id); await mkClass('MBT 1', fx._id); await mkClass('AI 1', ai._id)

  let device: string | undefined
  const student = async (tag: string, categories: string[], enrolIn: unknown[] = []) => {
    const u = await M.UserModel.create({ name: tag, email: `${tag}@dm.local`, passwordHash: hash, role: 'student', isActive: true, isVerified: true,
      enrollmentStatus: categories.length ? 'approved' : 'pending', organizationId: org._id, categories, ...(categories[0] ? { category: categories[0] } : {}) })
    for (const c of enrolIn) await M.EnrollmentModel.create({ userId: u._id, courseId: c, status: 'active' })
    const jar: Jar = new Map(device ? [['lms_device', device]] : [])
    const r = await call('POST', '/auth/login', jar, { email: u.email, password: PW })
    if (r.status !== 200) throw new Error(`login ${tag}: ${r.status} ${JSON.stringify(r.body)}`)
    device = jar.get('lms_device') ?? device
    const list = await call('GET', '/live-classes?per_page=100', jar)
    return ((list.body?.data ?? []) as any[]).map(c => c.title).sort().join(',')
  }

  section('A · Digital Marketing only')
  const a = await student('dmonly', ['digital-marketing'], [dm._id])
  check('sees Digital Marketing, not Forex or AI', a === 'SMM 1', a)

  section('B · ...plus a course they are enrolled in elsewhere')
  const b = await student('dmai', ['digital-marketing'], [dm._id, ai._id])
  check('Digital Marketing + the AI course they bought', b === 'AI 1,SMM 1', b)

  section('C · everyone else unchanged')
  check('Forex student: the whole schedule', (await student('fx', ['4x-trading'], [fx._id])) === 'AI 1,MBT 1,SMM 1')
  check('two programmes: the whole schedule', (await student('two', ['digital-marketing', '4x-trading'])) === 'AI 1,MBT 1,SMM 1')
  check('no programme yet: the whole schedule', (await student('new', [])) === 'AI 1,MBT 1,SMM 1')
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
