/* ─────────────────────────────────────────────────────────────
   Class Schedule journey (GET /live-classes/journey) and ?mine=1.

     A. levels in programOrder: completed / current / up next / locked;
        only the student's programme (no Digital Marketing for a Forex student);
     B. a held course's modules: open / locked, and why (payment);
     C. the advisor from Tetra Commission;
     D. ?mine=1 lists only classes of courses the student holds.
   Run: bun --no-env-file src/tests/journey.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_journey'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.JWT_ACCESS_SECRET  ??= 'journey-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'journey-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; lines.push(`  PASS  ${l}`) } else { fail++; lines.push(`  FAIL  ${l}${d ? '  — ' + d : ''}`) } }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_journey') process.exit(1)
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
const jar = new Map<string, string>()
async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let b: any = null; try { b = await res.json() } catch { /* */ }
  return { status: res.status, body: b }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword('CorrectHorse1')
  const t = await M.UserModel.create({ name: 'T', email: 't@jy.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const course = (title: string, program: string, programOrder?: number) => M.CourseModel.create({ title, slug: title.toLowerCase().replace(/\W+/g, '-'),
    description: 'A course description long enough.', instructorId: t._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program, ...(programOrder ? { programOrder } : {}) })
  const dslp = await course('DSLP Programme', '4x-trading', 5)
  const mbt  = await course('MARKET BREAK-OUT TRADING PROGRAM', '4x-trading', 1)
  const dwt  = await course('DELTA WAVE THEORY', '4x-trading', 2)
  const mmc  = await course('MMC Cycle', '4x-trading', 3)
  const dm   = await course('DIGITAL MARKETING', 'digital-marketing', 1)
  const s1 = await M.SectionModel.create({ courseId: dwt._id, title: 'DWT 1', order: 1 })
  const s2 = await M.SectionModel.create({ courseId: dwt._id, title: 'DWT 2', order: 2 })
  const me = await M.UserModel.create({ name: 'Sooraj', email: 's@jy.local', passwordHash: hash, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'approved',
    organizationId: org._id, categories: ['4x-trading'], tetraCs: { name: 'Alice Antony', team: 'Team Expandables' } })
  await M.EnrollmentModel.create({ userId: me._id, courseId: mbt._id, status: 'completed', progressPercent: 100, source: 'purchase' })
  await M.EnrollmentModel.create({ userId: me._id, courseId: dwt._id, status: 'active', progressPercent: 40, source: 'admin', blockedLessons: [s2._id], paymentAccess: { status: 'partial' } })
  const mkClass = (c: any, title: string) => M.LiveClassModel.create({ title, courseId: c._id, instructorId: t._id, organizationId: org._id,
    scheduledStart: new Date(Date.now() + 2 * 86_400_000), durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30 })
  await mkClass(dwt, 'DWT 1 · Live'); await mkClass(mmc, 'MMC 1 · Live'); await mkClass(dm, 'DM 1 · Live')
  void s1; void dslp

  const l = await call('POST', '/auth/login', { email: 's@jy.local', password: 'CorrectHorse1' })
  if (l.status !== 200) throw new Error('login ' + why(l))

  const j = await call('GET', '/live-classes/journey')
  check('200', j.status === 200, why(j))
  const progs = j.body?.data?.programmes ?? []
  check('only Forex (no Digital Marketing)', progs.length === 1 && progs[0].label === 'Forex', JSON.stringify(progs.map((p: any) => p.label)))
  const lv = progs[0]?.levels ?? []
  check('levels in programOrder', lv.map((x: any) => x.title).join(' > ') === 'MARKET BREAK-OUT TRADING PROGRAM > DELTA WAVE THEORY > MMC Cycle > DSLP Programme', lv.map((x: any) => x.title).join(' > '))
  check('states: completed, current, locked, locked', lv.map((x: any) => x.state).join() === 'completed,current,locked,locked', lv.map((x: any) => x.state).join())
  const dwtL = lv[1]
  check('DWT: 40%, 1 of 2 modules open, locked for payment', dwtL?.progressPercent === 40 && dwtL.modulesOpen === 1 && dwtL.modulesTotal === 2 && dwtL.lockReason === 'payment' && dwtL.modules[1].locked === true, JSON.stringify(dwtL))
  check('advisor', j.body?.data?.advisor?.name === 'Alice Antony' && j.body.data.advisor.team === 'Team Expandables')

  /* DWT completed too → MMC becomes "Up next". */
  await M.EnrollmentModel.updateOne({ userId: me._id, courseId: dwt._id }, { $set: { status: 'completed', progressPercent: 100 } })
  const j2 = await call('GET', '/live-classes/journey')
  check('after finishing DWT: MMC is up next', j2.body?.data?.programmes?.[0]?.levels?.[2]?.state === 'next', JSON.stringify(j2.body?.data?.programmes?.[0]?.levels?.map((x: any) => x.state)))

  const all = await call('GET', '/live-classes')
  const mine = await call('GET', '/live-classes?mine=1')
  const titles = (r: any) => (r.body?.data ?? []).map((c: any) => c.title).sort().join(', ')
  check('without mine: every Forex class (incl. MMC not held)', titles(all).includes('MMC 1 · Live'), titles(all))
  check('mine=1: only the held course (DWT)', titles(mine) === 'DWT 1 · Live', titles(mine))
} catch (err) { fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`) }
finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close() }
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
