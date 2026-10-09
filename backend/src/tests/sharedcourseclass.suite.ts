/* ─────────────────────────────────────────────────────────────
   Live classes of a course shared by both academies (part 2), with
   CROSS_ORG_CLASSES on.

     A. the other academy schedules its own class from the shared course;
     B. "Both academies": the other academy becomes a guest through the SAME
        course, with no floor — the whole room is the common overflow;
     C. both academies' students on the course can book it; a student of
        either academy NOT on the course cannot;
     D. refused: a course that is not shared (COURSE_NOT_SHARED), a sub_admin
        (CROSS_ACADEMY_FORBIDDEN), an in-person class;
     E. the edit switch turns it on and off;
     F. an academy admin cannot read the other academy's (unshared) roster.
   Run: bun --no-env-file src/tests/sharedcourseclass.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_sharedcourseclass'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CROSS_ORG_CLASSES = 'true'
process.env.JWT_ACCESS_SECRET  ??= 'sharedclass-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'sharedclass-suite-refresh-secret-0123456789'
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_sharedcourseclass') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair!.indexOf('=')
    if (i > 0 && opts.jar) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  let body: any = null; try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'
const idOf = (r: any) => String(r.body?.data?.id ?? r.body?.data?._id ?? '')

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mk = (tag: string, role: string, org?: any, extra: Record<string, unknown> = {}) => M.UserModel.create({ name: tag, email: `${tag}@scc.local`, passwordHash: hash, role,
    isActive: true, isVerified: true, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...(org ? { organizationId: org._id } : {}), ...extra })
  const sa = await mk('sa', 'super_admin')
  const dAdmin = await mk('dadmin', 'admin', dxb), bAdmin = await mk('badmin', 'admin', blr)
  const bSub = await mk('bsub', 'sub_admin', blr, { categoryScope: '4x-trading', program: 'forex' })
  const dTeach = await mk('dteach', 'instructor', dxb), bTeach = await mk('bteach', 'instructor', blr, { category: '4x-trading', categories: ['4x-trading'] })
  const dStu = await mk('dstu', 'student', dxb), bStu = await mk('bstu', 'student', blr)
  const bOut = await mk('bout', 'student', blr), dOut = await mk('dout', 'student', dxb)
  const course = (title: string, org: any, extra: Record<string, unknown> = {}) => M.CourseModel.create({ title, slug: `${title}-${org.slug}`.toLowerCase().replace(/\W+/g, '-'),
    description: 'A course description long enough.', instructorId: sa._id, price: 0, isFree: true, status: 'published', language: 'English',
    organizationId: org._id, program: '4x-trading', ...extra })
  const mbt   = await course('MARKET BREAK-OUT TRADING PROGRAM', dxb, { sharedAcademies: true })
  const dOnly = await course('Dubai Only Course', dxb)
  const sec = await M.SectionModel.create({ courseId: mbt._id, title: 'MBT 1', order: 1 })
  for (const u of [dStu, bStu]) await M.EnrollmentModel.create({ userId: u._id, courseId: mbt._id, status: 'active', source: 'admin' })

  const login = async (u: any, path = '/admin/auth/login') => { const j: Jar = new Map(); const r = await call('POST', path, { jar: j, body: { email: u.email, password: PW } }); if (r.status !== 200) throw new Error('login ' + u.email + ' ' + why(r)); return j }
  const DA = await login(dAdmin), BA = await login(bAdmin)
  const soon = (h = 30) => new Date(Date.now() + h * 3600_000).toISOString()
  const body = (over: object = {}) => ({ courseId: String(mbt._id), title: 'MBT 1 · Session', scheduledStart: soon(), durationMins: 60,
    type: 'internal', provider: 'livekit', sessionCapacity: 30, language: 'English', ...over })

  section('A · the other academy schedules from the shared course')
  const a = await call('POST', '/admin/live-classes', { jar: BA, body: body({ instructorId: String(bTeach._id) }) })
  check('Bangalore admin creates a class from the Dubai-owned shared course (201)', a.status === 201, why(a))
  const aDoc = await M.LiveClassModel.findById(idOf(a)).lean() as any
  check('…it belongs to Bangalore, no guests', String(aDoc?.organizationId) === String(blr._id) && !(aDoc?.guestCohorts ?? []).length)

  const aEdit = await call('PATCH', `/admin/live-classes/${idOf(a)}`, { jar: BA, body: { title: 'MBT 1 · Bangalore evening' } })
  check('…and the Bangalore admin can edit it', aEdit.status === 200, why(aEdit))
  const aDubai = await call('PATCH', `/admin/live-classes/${idOf(a)}`, { jar: DA, body: { title: 'Dubai takeover' } })
  check("…the Dubai admin cannot edit Bangalore's class", aDubai.status === 403 || aDubai.status === 404, why(aDubai))

  section('B · "Both academies"')
  const b = await call('POST', '/admin/live-classes', { jar: DA, body: body({ instructorId: String(dTeach._id), sectionId: String(sec._id), bothAcademies: true }) })
  check('201', b.status === 201, why(b))
  const bId = idOf(b)
  const bDoc = await M.LiveClassModel.findById(bId).lean() as any
  const g = bDoc?.guestCohorts?.[0]
  check('Bangalore is the guest, through the same course and module, floor 0',
    bDoc?.guestCohorts?.length === 1 && String(g.organizationId) === String(blr._id) && String(g.courseId) === String(mbt._id)
      && String(g.sectionId) === String(sec._id) && g.seatFloor === 0, JSON.stringify(bDoc?.guestCohorts))
  check('the whole room is the shared overflow', bDoc?.hostSeatsLeft === 0 && bDoc?.overflowSeatsLeft === 30, `${bDoc?.hostSeatsLeft}/${bDoc?.overflowSeatsLeft}`)

  section('C · booking')
  /* One sign-in per student — each new one is a new device (2-device limit). */
  const jars = new Map<string, Jar>()
  const stuJar = async (u: any) => { const k = String(u._id); if (!jars.has(k)) jars.set(k, await login(u, '/auth/login')); return jars.get(k)! }
  const book = async (u: any) => call('POST', '/bookings', { jar: await stuJar(u), body: { liveClassId: bId } })
  const rb = await book(bStu)
  check('Bangalore student on the course books it', rb.status === 201 || rb.status === 200, why(rb))
  const rd = await book(dStu)
  check('Dubai student on the course books it', rd.status === 201 || rd.status === 200, why(rd))
  const after = await M.LiveClassModel.findById(bId).lean() as any
  check('two seats out of the shared pool', after.bookedCount === 2 && after.overflowSeatsLeft === 28, `${after.bookedCount}/${after.overflowSeatsLeft}`)
  const ro = await book(bOut)
  check('Bangalore student NOT on the course cannot', ro.status >= 400, why(ro))
  const rdo = await book(dOut)
  check('Dubai student NOT on the course cannot', rdo.status >= 400, why(rdo))
  const feed = await call('GET', '/live-classes?per_page=50', { jar: await stuJar(bStu) })
  check("it is on the Bangalore student's class list", JSON.stringify(feed.body?.data ?? '').includes(bId), why(feed))

  section('D · refused')
  const d1 = await call('POST', '/admin/live-classes', { jar: DA, body: body({ courseId: String(dOnly._id), instructorId: String(dTeach._id), bothAcademies: true }) })
  check('a course not shared → 400 COURSE_NOT_SHARED', d1.status === 400 && d1.body?.error?.code === 'COURSE_NOT_SHARED', why(d1))
  const d2 = await call('POST', '/admin/live-classes', { jar: await login(bSub), body: body({ instructorId: String(bTeach._id), bothAcademies: true }) })
  check('a sub_admin → 403 CROSS_ACADEMY_FORBIDDEN', d2.status === 403 && d2.body?.error?.code === 'CROSS_ACADEMY_FORBIDDEN', why(d2))
  const d3 = await call('POST', '/admin/live-classes', { jar: DA, body: body({ instructorId: String(dTeach._id), bothAcademies: true, type: 'external', isOnline: false, location: 'Villa', room: '1' }) })
  check('an in-person class → refused', d3.status >= 400 && d3.status < 500, why(d3))

  section('E · the edit switch')
  const c = await call('POST', '/admin/live-classes', { jar: DA, body: body({ instructorId: String(dTeach._id), title: 'MBT 1 · Later' }) })
  const cId = idOf(c)
  const on = await call('PATCH', `/admin/live-classes/${cId}`, { jar: DA, body: { bothAcademies: true } })
  const cOn = await M.LiveClassModel.findById(cId).lean() as any
  check('switched on: Bangalore guest + shared overflow', on.status === 200 && cOn.guestCohorts?.length === 1 && cOn.overflowSeatsLeft === 30, why(on) + ' ' + JSON.stringify(cOn?.guestCohorts))
  const off = await call('PATCH', `/admin/live-classes/${cId}`, { jar: DA, body: { bothAcademies: false } })
  const cOff = await M.LiveClassModel.findById(cId).lean() as any
  check('switched off: no guests', off.status === 200 && (cOff.guestCohorts ?? []).length === 0, why(off))

  section("F · the other academy's roster")
  const r1 = await call('GET', `/admin/courses/${dOnly._id}/students`, { jar: BA })
  check("Bangalore admin → Dubai-only course roster: 403", r1.status === 403, why(r1))
  const r2 = await call('GET', `/admin/courses/${dOnly._id}/students`, { jar: DA })
  check('Dubai admin → own roster: 200', r2.status === 200, why(r2))
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
