/* ─────────────────────────────────────────────────────────────
   Programs — co-mentors, and how the classes meet (services/program.service.ts).
     A. own Meet link: every class carries it (and its code); the program shows
        its co-mentors and how it meets; each class names the co-mentors
     B. a link that is not Google Meet is refused, and nothing is made
     C. in-app stream: the classes are the interactive in-app kind (LiveKit)
     D. a co-mentor sees the class in their list and may open it — and may
        not change it; another mentor sees nothing
     E. the Mentor Calendar shows it under the co-mentor too
     F. the 10-minute WhatsApp goes to the main mentor and each co-mentor
     G. language: the classes carry it; one not on the list is refused
     H. the Meet link on WhatsApp: in the "added" message (own link), and in each
        class's 5-minute message, with the LMS button still there
   Run: bun --no-env-file src/tests/programcomentors.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_programcomentors'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.EMAIL_OUTBOX = 'off'
process.env.JWT_ACCESS_SECRET  ??= 'programcomentors-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'programcomentors-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_programcomentors') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown) {
  const h: Record<string, string> = {}
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'CorrectHorse1', DAY = 864e5
const dubaiDay = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const LINK = 'https://meet.google.com/abc-defg-hij'

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string, extra: Record<string, unknown> = {}) => M.UserModel.create({
    name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id,
    ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}), ...extra })
  await mk('Admin', 'admin@pc.local', 'admin')
  const main  = await mk('MOIZ', 'moiz@pc.local', 'instructor', { phone: '+971500000101' })
  const co1   = await mk('HAFFIS', 'haf@pc.local', 'instructor', { phone: '+971500000102' })
  const co2   = await mk('ARYA', 'arya@pc.local', 'instructor', { phone: '+971500000103' })
  await mk('OTHER', 'other@pc.local', 'instructor')
  const stu   = await mk('Stu', 'stu@pc.local', 'student', { enrollmentApplication: { phone: '+971500000201' } })
  const { hashSigninCode } = await import('@/services/signinLink.service.ts')
  const login = async (email: string) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', j, { email, password: PW }); if (r.status !== 200) throw new Error(`${email} login ${why(r)}`); return j }
  const admin = await login('admin@pc.local'), coJar = await login('haf@pc.local'), otherJar = await login('other@pc.local')
  const base = { repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: dubaiDay(1), endDate: dubaiDay(2), time: '19:00', durationMins: 60,
    isOnline: true, instructorId: String(main._id), students: [String(stu._id)] }

  section('A · own Meet link, two co-mentors')
  const a = await call('POST', '/admin/programs', admin, { ...base, title: 'NY session', meetingMode: 'link', meetingUrl: LINK, language: 'Malayalam', coInstructorIds: [String(co1._id), String(co2._id)] })
  check('created', a.status === 200, why(a))
  const prog = a.body?.data
  check('shows its co-mentors', JSON.stringify((prog?.coMentors ?? []).map((m: any) => m.name).sort()) === JSON.stringify(['ARYA', 'HAFFIS']), JSON.stringify(prog?.coMentors))
  check('...and how it meets', prog?.meetingMode === 'link' && prog?.meetingUrl === LINK)
  const classes = await M.LiveClassModel.find({ programId: prog?.id }).lean() as any[]
  check('2 classes, each with the pasted link and its code', classes.length === 2 && classes.every(c => c.meetingUrl === LINK && c.googleMeetCode === 'abc-defg-hij'), JSON.stringify(classes.map(c => [c.meetingUrl, c.googleMeetCode])))
  check('...the main mentor runs them', classes.every(c => String(c.instructorId) === String(main._id)))
  check('...the co-mentors are on them', classes.every(c => (c.coInstructorIds ?? []).map(String).sort().join() === [co1, co2].map(u => String(u._id)).sort().join()))

  section('B · not a Google Meet link')
  const b = await call('POST', '/admin/programs', admin, { ...base, title: 'Bad link', meetingMode: 'link', meetingUrl: 'https://zoom.us/j/123' })
  check('refused', b.status === 400 && /Google Meet link/.test(String(b.body?.error?.message)), why(b))
  check('...nothing made', (await M.ProgramModel.countDocuments({ title: 'Bad link' })) === 0)

  section('C · in-app stream')
  const c = await call('POST', '/admin/programs', admin, { ...base, title: 'In-app review', meetingMode: 'app' })
  check('created', c.status === 200, why(c))
  const appClasses = await M.LiveClassModel.find({ programId: c.body?.data?.id }).lean() as any[]
  check('its classes are the in-app interactive kind', appClasses.length === 2 && appClasses.every(x => x.type === 'internal' && x.provider === 'livekit' && !x.meetingUrl), JSON.stringify(appClasses.map(x => [x.type, x.provider])))

  section('D · what a co-mentor may do')
  const list = await call('GET', '/admin/live-classes', coJar)
  const mine = (list.body?.data ?? []).filter((x: any) => x.title === 'NY session')
  check('the co-mentor sees both classes in their list', mine.length === 2, why(list) + ' ' + mine.length)
  const id = String(classes[0]._id)
  const open = await call('GET', `/admin/live-classes/${id}`, coJar)
  check('...may open one', open.status === 200, why(open))
  const edit = await call('PATCH', `/admin/live-classes/${id}`, coJar, { title: 'Renamed by co-mentor' })
  check('...may NOT change it', edit.status === 403, why(edit))
  const otherList = await call('GET', '/admin/live-classes', otherJar)
  check('another mentor does not see it', !(otherList.body?.data ?? []).some((x: any) => x.title === 'NY session'))
  const otherOpen = await call('GET', `/admin/live-classes/${id}`, otherJar)
  check('...nor open it', otherOpen.status === 403 || otherOpen.status === 404, why(otherOpen))

  section('E · Mentor Calendar')
  const from = new Date().toISOString(), to = new Date(Date.now() + 4 * DAY).toISOString()
  const cal = await call('GET', `/admin/mentor-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, admin)
  const row = (name: string) => (cal.body?.data?.mentors ?? []).find((m: any) => m.name === name)
  check('the classes show under the main mentor', (row('MOIZ')?.classes ?? []).filter((x: any) => x.title === 'NY session').length === 2, why(cal))
  check('...and under each co-mentor', (row('HAFFIS')?.classes ?? []).filter((x: any) => x.title === 'NY session').length === 2 && (row('ARYA')?.classes ?? []).filter((x: any) => x.title === 'NY session').length === 2)

  section('F · the 10-minute WhatsApp')
  await M.LiveClassModel.updateOne({ _id: classes[0]._id }, { $set: { scheduledStart: new Date(Date.now() + 8.5 * 60_000) } })
  const { runMentor10MinWhatsApp } = await import('@/jobs/reminders.job.ts')
  await runMentor10MinWhatsApp()
  const sent = (await M.WhatsAppOutboxModel.find({ templateName: 'mentor_class_in_10_min' }).lean() as any[]).map(r => r.to).sort()
  check('to the main mentor and both co-mentors', JSON.stringify(sent) === JSON.stringify(['971500000101', '971500000102', '971500000103'].sort()), JSON.stringify(sent))

  section('G · language')
  check('the program and its classes are in Malayalam', prog?.language === 'Malayalam' && classes.every(x => x.language === 'Malayalam'), JSON.stringify(classes.map(x => x.language)))
  const badLang = await call('POST', '/admin/programs', admin, { ...base, title: 'Klingon', language: 'Klingon', meetingMode: 'link', meetingUrl: LINK })
  check('a language not on the list is refused', badLang.status === 400 && /Pick a language/.test(String(badLang.body?.error?.message)), why(badLang))

  section('H · the Meet link on WhatsApp')
  const added = await M.NotificationModel.findOne({ userId: stu._id, title: 'New program: NY session' }).lean() as any
  check('the "added" notice gives the link, and the language', String(added?.body).includes(`Join on Google Meet: ${LINK}`) && / in Malayalam,/.test(String(added?.body)), String(added?.body))
  const addedWa = (await M.WhatsAppOutboxModel.find({ templateName: 'course_update_v1', to: '971500000201' }).lean() as any[]).find(r => r.params?.[1] === 'NY session')
  check('...so does its WhatsApp', String(addedWa?.params?.[2]).includes(LINK), JSON.stringify(addedWa?.params))
  await M.LiveClassModel.updateOne({ _id: classes[1]._id }, { $set: { scheduledStart: new Date(Date.now() + 6 * 60_000) } })
  const { runFiveMinReminders } = await import('@/jobs/reminders.job.ts')
  await runFiveMinReminders()
  const five = await M.WhatsAppOutboxModel.findOne({ templateName: 'class_update_v1', to: '971500000201' }).lean() as any
  check('5 minutes before: class_update_v1 with its Meet link', five?.params?.[1] === 'NY session' && five?.params?.[3] === `It starts in 5 minutes. Join directly on Google Meet: ${LINK}`, JSON.stringify(five?.params))
  const tok = five?.buttonParam ? await M.AuthTokenModel.findOne({ tokenHash: hashSigninCode(five.buttonParam), purpose: 'signin-link' }).lean() as any : null
  check('...and its button still signs them in to the class page', tok?.nextPath === `/live-classes/${String(classes[1]._id)}/watch`, String(tok?.nextPath))
  check('...instead of the usual 5-minute template', (await M.WhatsAppOutboxModel.countDocuments({ templateName: /class_starts_in_5_min/, to: '971500000201' })) === 0)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await new Promise(r => setTimeout(r, 500))
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
