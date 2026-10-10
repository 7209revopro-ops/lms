/* ─────────────────────────────────────────────────────────────
   Send message (services/broadcast.service.ts, /admin/messages/*).

     A. templates per audience;
     B. preview: who (active enrolments, academy scope, module filter), counts
        without phone / email, the message personalised for the first student;
     C. send: WhatsApp + email queued per student, each with their own
        sign-in link (join link for a join template), audited;
     D. a session's booked students;
     E. refused: missing values, wrong template for the audience, sub_admin.
   Run: bun --no-env-file src/tests/broadcast.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_broadcast'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'on'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CLIENT_URL = 'https://lms.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'broadcast-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'broadcast-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
const lines: string[] = []
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; lines.push(`  PASS  ${l}`) } else { fail++; lines.push(`  FAIL  ${l}${d ? '  — ' + d : ''}`) } }
const section = (n: string) => lines.push(`\n${n}`)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { hashSigninCode } = await import('@/services/signinLink.service.ts')
const { hashJoinCode } = await import('@/services/joinLink.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_broadcast') process.exit(1)
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let b: any = null; try { b = await res.json() } catch { /* */ }
  return { status: res.status, body: b }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const settle = (ms: number) => new Promise(r => setTimeout(r, ms))
const PW = 'CorrectHorse1'

try {
  const dxb = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mk = (tag: string, role: string, org?: any, extra: Record<string, unknown> = {}) => M.UserModel.create({ name: tag, email: `${tag.toLowerCase().replace(/\s+/g, '')}@bc.local`, passwordHash: hash, role, isActive: true, isVerified: true,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...(org ? { organizationId: org._id } : {}), ...extra })
  const sa = await mk('SA', 'super_admin'), dAdmin = await mk('DAdmin', 'admin', dxb)
  const sub = await mk('Sub', 'sub_admin', dxb, { categoryScope: '4x-trading', program: 'forex' })
  const teacher = await mk('Teacher', 'instructor', dxb)
  const course = await M.CourseModel.create({ title: 'MBT Course', slug: 'mbt-course', description: 'A course description long enough.', instructorId: teacher._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: dxb._id, sharedAcademies: true })
  const sec1 = await M.SectionModel.create({ courseId: course._id, title: 'MBT 1', order: 1 })
  const sec2 = await M.SectionModel.create({ courseId: course._id, title: 'MBT 2', order: 2 })
  const stu = async (name: string, org: any, phone?: string, enrol: Record<string, unknown> = {}) => {
    const u = await mk(name, 'student', org, phone ? { enrollmentApplication: { phone } } : {})
    await M.EnrollmentModel.create({ userId: u._id, courseId: course._id, status: 'active', source: 'admin', ...enrol })
    return u
  }
  const anna = await stu('Anna Joseph', dxb, '+971501111111')
  await stu('Bilal Khan', dxb)                                                   // no phone
  await stu('Chitra Nair', dxb, '+971502222222', { blockedLessons: [sec2._id] }) // MBT 2 blocked
  const dev = await stu('Dev Rao', blr, '+919000000001')                        // Bangalore
  await stu('Gone Student', dxb, '+971503333333', { status: 'dropped' })
  void sec1

  const login = async (u: any) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', j, { email: u.email, password: PW }); if (r.status !== 200) throw new Error('login ' + why(r)); return j }
  const SA = await login(sa), DA = await login(dAdmin), SUB = await login(sub)
  const courseBody = (over: object = {}) => ({ audience: 'course', courseId: String(course._id),
    whatsapp: { template: 'course_update_v1', values: ['{name}', '{course}', 'New notes are up, {name}.'] },
    email: { subject: 'Update for {course}', body: 'Hi {name},\n\nNew notes are up.' }, ...over })

  section('A · templates per audience')
  const tc = await call('GET', '/admin/messages/templates?audience=course', SA)
  check('course: course_update_v1 only', tc.status === 200 && tc.body?.data?.map((t: any) => t.name).join() === 'course_update_v1', JSON.stringify(tc.body?.data?.map((t: any) => t.name)))
  const ts = await call('GET', '/admin/messages/templates?audience=session', SA)
  check('session: class templates incl. join + update', ['class_update_v1', 'class_starts_in_5_min_v2', 'class_cancelled_v1'].every(n => ts.body?.data?.some((t: any) => t.name === n)))

  section('B · preview')
  const p1 = await call('POST', '/admin/messages/preview', SA, courseBody())
  check('super admin: 4 active students (dropped left out)', p1.status === 200 && p1.body?.data?.total === 4, why(p1) + JSON.stringify(p1.body?.data?.names))
  check('WhatsApp 3 / no phone 1; email 4', p1.body?.data?.whatsapp?.willSend === 3 && p1.body.data.whatsapp.noPhone === 1 && p1.body.data.email.willSend === 4)
  check('sample personalised', p1.body?.data?.sample?.whatsapp?.text?.includes('Hi Anna, an update about your course MBT Course') && p1.body.data.sample.email.subject === 'Update for MBT Course', JSON.stringify(p1.body?.data?.sample))
  const p2 = await call('POST', '/admin/messages/preview', DA, courseBody())
  check('Dubai admin: only Dubai students (3)', p2.body?.data?.total === 3, String(p2.body?.data?.total))
  const p3 = await call('POST', '/admin/messages/preview', SA, courseBody({ sectionId: String(sec2._id) }))
  check('module MBT 2 open only: Chitra left out (3)', p3.body?.data?.total === 3 && !p3.body.data.names.includes('Chitra Nair'))
  const p4 = await call('POST', '/admin/messages/preview', SA, courseBody({ organizationId: String(blr._id) }))
  check('super admin, Bangalore only: Dev', p4.body?.data?.total === 1 && p4.body.data.names[0] === 'Dev Rao')

  section('C · send')
  const s1 = await call('POST', '/admin/messages/send', SA, courseBody())
  check('answers at once with the counts', s1.status === 200 && s1.body?.data?.whatsapp === 3 && s1.body.data.email === 4, why(s1))
  let wa: any[] = []
  for (let i = 0; i < 40 && wa.length < 3; i++) { await settle(150); wa = await M.WhatsAppOutboxModel.find({ templateName: 'course_update_v1' }).lean() as any[] }
  await settle(400)
  wa = await M.WhatsAppOutboxModel.find({ templateName: 'course_update_v1' }).lean() as any[]
  check('3 WhatsApps queued', wa.length === 3, String(wa.length))
  const annaWa = wa.find(w => w.to.endsWith('501111111'))
  check("Anna's values personalised", JSON.stringify(annaWa?.params) === JSON.stringify(['Anna', 'MBT Course', 'New notes are up, Anna.']), JSON.stringify(annaWa?.params))
  const tok = await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(annaWa?.buttonParam ?? ''), purpose: 'signin-link' }).lean() as any
  check("…button = Anna's own sign-in link to the course page", String(tok?.userId) === String(anna._id) && tok?.nextPath === '/courses/mbt-course')
  const em = await M.EmailOutboxModel.find({ subject: 'Update for MBT Course' }).lean() as any[]
  check('4 emails queued, personalised, with a sign-in button', em.length === 4 && em.some(e => e.html.includes('Hi Anna,') && e.html.includes('https://lms.example.test/s/')), String(em.length))
  await settle(300)
  const au = await M.AuditLogModel.findOne({ action: 'message.send' }).lean() as any
  check('audited', !!au && au.entityId === String(course._id))

  section("D · a session's booked students")
  const live = await M.LiveClassModel.create({ title: 'MBT 2 · Live', courseId: course._id, instructorId: teacher._id, organizationId: dxb._id,
    scheduledStart: new Date('2099-10-09T13:00:00Z'), durationMins: 60, type: 'external', meetingUrl: 'https://meet.google.com/abc-defg-hij', isOnline: true, status: 'scheduled', sessionCapacity: 30, bookedCount: 2 })
  await M.ClassBookingModel.create({ userId: anna._id, liveClassId: live._id, status: 'booked' })
  await M.ClassBookingModel.create({ userId: dev._id, liveClassId: live._id, status: 'booked' })
  const sb = { audience: 'session', liveClassId: String(live._id), whatsapp: { template: 'class_starts_in_5_min_v2', values: ['{name}', '{class}', '{day}', '{time}'] } }
  const ps = await call('POST', '/admin/messages/preview', SA, sb)
  check('2 booked students; day/time filled', ps.body?.data?.total === 2 && /Fri, 9 Oct/.test(ps.body?.data?.sample?.whatsapp?.text ?? ''), JSON.stringify(ps.body?.data?.sample?.whatsapp?.text))
  await call('POST', '/admin/messages/send', SA, sb)
  let j: any[] = []
  for (let i = 0; i < 40 && j.length < 2; i++) { await settle(150); j = await M.WhatsAppOutboxModel.find({ templateName: 'class_starts_in_5_min_v2' }).lean() as any[] }
  const devRow = j.find(w => w.to.endsWith('9000000001'))
  check("Dev's time in IST (his academy)", devRow?.params?.[3]?.endsWith('IST'), JSON.stringify(devRow?.params))
  const jt = await M.AuthTokenModel.findOne({ tokenHash: hashJoinCode(devRow?.buttonParam ?? ''), purpose: 'join-link' }).lean() as any
  check('join template: button is his own join link for this class', String(jt?.liveClassId) === String(live._id) && String(jt?.userId) === String(dev._id))

  section('E · refused')
  const r1 = await call('POST', '/admin/messages/preview', SA, courseBody({ whatsapp: { template: 'course_update_v1', values: ['{name}', '{course}', ''] } }))
  check('empty value → 400 MISSING_VALUES', r1.status === 400 && r1.body?.error?.code === 'MISSING_VALUES', why(r1))
  const r2 = await call('POST', '/admin/messages/preview', SA, { ...sb, whatsapp: { template: 'course_update_v1', values: ['a', 'b', 'c'] } })
  check('course template on a session → INVALID_TEMPLATE', r2.status === 400 && r2.body?.error?.code === 'INVALID_TEMPLATE', why(r2))
  const r3 = await call('POST', '/admin/messages/preview', SUB, courseBody())
  check('sub_admin → 403', r3.status === 403, why(r3))
} catch (err) { fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`) }
finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close() }
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
