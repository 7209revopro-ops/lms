/* ─────────────────────────────────────────────────────────────
   A mentor's time off — "not available" from one moment to another, and nobody books them then
   (services/mentorTimeOff.service.ts, /admin/time-off/me, /admin/mentors/:id/time-off, /service/mentor-time-off).

     A. an instructor marks their own; bad spans refused; another instructor can't mark theirs; an admin can
     B. the Mentor Calendar shows it — the reason to the mentor and admins only, "Not available" to the rest
     C. a 1:1 meeting over it is refused, and moving one into it; one beside it is fine
     D. a programme with a date in it is refused (the mentor's, or a co-mentor's); a repeat that runs into it adds none;
        a class moved into it is refused; a class already inside it can still be renamed
     E. the CS Portal marks it by email, is told what was already booked, and takes it away again
     F. taken away — the time can be booked again
   Run: bun --no-env-file src/tests/mentortimeoff.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.MENTORTIMEOFF_DB_URL || 'mongodb://localhost:27017/lms_mentortimeoff'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.JWT_ACCESS_SECRET  ??= 'mentortimeoff-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'mentortimeoff-suite-refresh-secret-0123456789'
process.env.ROOT_ERP_SECRET = 'mentortimeoff-suite-portal-secret-0123456789'

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
if (mongoose.connection.db!.databaseName !== 'lms_mentortimeoff') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const msg = (r: { body: any }) => String(r.body?.error?.message ?? r.body?.message ?? '')
const PW = 'CorrectHorse1', DAY = 864e5, HOUR = 3600e3
const P = { 'x-portal-secret': process.env.ROOT_ERP_SECRET! }
/** A Dubai wall-clock moment `days` from today. */
const dubaiAt = (days: number, hhmm: string) => {
  const d = new Date(Date.now() + days * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
  return new Date(`${d}T${hhmm}:00+04:00`)
}
const dubaiDay = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (name: string, email: string, role: string) => M.UserModel.create({ name, email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: dubai._id, ...(role === 'student' ? { enrollmentStatus: 'approved' } : {}) })
  const moiz = await mk('MOIZ', 'moiz@to.local', 'instructor')
  const haf = await mk('HAFFIS', 'haf@to.local', 'instructor')
  await mk('Admin', 'admin@to.local', 'admin')
  await mk('Stu One', 'one@to.local', 'student')
  const login = async (email: string) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', j, { email, password: PW }); if (r.status !== 200) throw new Error(`${email} login ${r.status}`); return j }
  const moizJ = await login('moiz@to.local'), hafJ = await login('haf@to.local'), adminJ = await login('admin@to.local')

  // Haffis is off on day 3, 14:00–18:00 Dubai.
  const offFrom = dubaiAt(3, '14:00'), offTo = dubaiAt(3, '18:00')

  section('A · marking it')
  let r = await call('POST', '/admin/time-off/me', hafJ, { startsAt: offFrom.toISOString(), endsAt: offTo.toISOString(), reason: 'Doctor' })
  const offId = r.body?.data?.timeOff?.id
  check('Haffis marks his own afternoon off', r.status === 201 && !!offId && r.body?.data?.alreadyBooked?.length === 0, `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  r = await call('GET', '/admin/time-off/me', hafJ)
  check('…and sees it, with its reason', r.status === 200 && r.body?.data?.length === 1 && r.body.data[0].reason === 'Doctor', JSON.stringify(r.body).slice(0, 200))
  r = await call('POST', '/admin/time-off/me', hafJ, { startsAt: offTo.toISOString(), endsAt: offFrom.toISOString() })
  check('an end before the start is refused', r.status === 400 && /after the start/.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await call('POST', '/admin/time-off/me', hafJ, { startsAt: new Date(Date.now() - 3 * HOUR).toISOString(), endsAt: new Date(Date.now() - HOUR).toISOString() })
  check('a time already gone is refused', r.status === 400 && /passed/.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await call('POST', `/admin/mentors/${haf._id}/time-off`, moizJ, { startsAt: dubaiAt(5, '10:00').toISOString(), endsAt: dubaiAt(5, '11:00').toISOString() })
  check('Moiz cannot mark Haffis off', r.status === 403, String(r.status))
  r = await call('POST', `/admin/mentors/${moiz._id}/time-off`, adminJ, { startsAt: dubaiAt(6, '00:00').toISOString(), endsAt: dubaiAt(7, '00:00').toISOString(), allDay: true, reason: 'Leave' })
  const moizOffId = r.body?.data?.timeOff?.id
  check('an admin marks Moiz off for a whole day', r.status === 201 && r.body?.data?.timeOff?.allDay === true, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)

  section('B · on the Mentor Calendar')
  const win = `from=${new Date().toISOString()}&to=${new Date(Date.now() + 10 * DAY).toISOString()}`
  const rowOf = (res: any, email: string) => (res.body?.data?.mentors ?? []).find((m: any) => m.email === email)
  r = await call('GET', `/admin/mentor-calendar?${win}`, moizJ)
  let hafRow = rowOf(r, 'haf@to.local')
  check('Moiz sees Haffis\'s time off — without its reason', hafRow?.timeOff?.length === 1 && hafRow.timeOff[0].reason === null, JSON.stringify(hafRow?.timeOff))
  check('…and his own with its reason', rowOf(r, 'moiz@to.local')?.timeOff?.[0]?.reason === 'Leave', JSON.stringify(rowOf(r, 'moiz@to.local')?.timeOff))
  r = await call('GET', `/admin/mentor-calendar?${win}`, adminJ)
  check('an admin sees every reason', rowOf(r, 'haf@to.local')?.timeOff?.[0]?.reason === 'Doctor')
  r = await call('GET', `/service/mentors?remoteOrgId=${dubai._id}&${win}`, null, undefined, P)
  check('the CRMs\' listing: "Not available", no reason', rowOf(r, 'haf@to.local')?.timeOff?.[0]?.reason === null && !!rowOf(r, 'haf@to.local')?.timeOff?.[0]?.startsAt, JSON.stringify(rowOf(r, 'haf@to.local')?.timeOff))
  r = await call('GET', `/service/mentors?remoteOrgId=${dubai._id}&${win}&timeOffReasons=all`, null, undefined, P)
  check('the CS Portal asks for the reasons and gets them', rowOf(r, 'haf@to.local')?.timeOff?.[0]?.reason === 'Doctor')

  section('C · 1:1 meetings')
  const book = (start: Date, mins = 30) => call('POST', '/admin/mentor-calendar/meetings', moizJ, { mentorEmail: 'haf@to.local', title: 'Strategy review', kind: 'staff', scheduledStart: start.toISOString(), durationMins: mins, attendees: [{ name: 'Moiz', email: 'moiz@to.local' }], inPerson: true, location: 'Room 2' })
  r = await book(dubaiAt(3, '15:00'))
  check('a meeting inside it is refused', r.status === 409 && /HAFFIS is not available/.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await book(dubaiAt(3, '13:45'), 30)
  check('…one running into it too', r.status === 409, `${r.status} ${msg(r)}`)
  r = await call('POST', '/service/mentor-meetings', null, { remoteOrgId: String(dubai._id), mentorEmail: 'haf@to.local', title: 'From a CRM', kind: 'client', scheduledStart: dubaiAt(3, '16:00').toISOString(), durationMins: 30, attendees: [{ name: 'Client' }], bookedByEmail: 'sales@crm.test', inPerson: true, location: 'Room 1' }, P)
  check('…from a portal or a CRM as well', r.status === 409 && /not available/.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await book(dubaiAt(3, '13:00'), 60)
  const beforeId = r.body?.data?.meeting?.id
  check('one ending as it starts is fine', r.status === 200 && !!beforeId, `${r.status} ${msg(r)}`)
  r = await call('PATCH', `/admin/mentor-calendar/meetings/${beforeId}`, moizJ, { scheduledStart: dubaiAt(3, '17:00').toISOString() })
  check('moving it into the time off is refused', r.status === 409 && /not available/.test(msg(r)), `${r.status} ${msg(r)}`)

  section('D · classes and programmes')
  const prog = (body: Record<string, unknown>) => call('POST', '/admin/programs', adminJ, { title: 'Weekly review', repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], time: '15:00', durationMins: 60, isOnline: false, location: 'Room 2', students: ['one@to.local'], ...body })
  r = await prog({ mentorEmail: 'haf@to.local', startDate: dubaiDay(2), endDate: dubaiDay(4) })
  check('a programme with a date in his time off is refused', r.status === 409 && /HAFFIS is not available on/.test(msg(r)), `${r.status} ${msg(r)}`)
  check('…and nothing of it was made', (await M.ProgramModel.countDocuments({})) === 0 && (await M.LiveClassModel.countDocuments({})) === 0)
  r = await prog({ mentorEmail: 'moiz@to.local', coMentorEmails: ['haf@to.local'], startDate: dubaiDay(3), endDate: dubaiDay(3) })
  check('…so is one where he is the co-mentor', r.status === 409 && /HAFFIS/.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await prog({ mentorEmail: 'haf@to.local', startDate: dubaiDay(1), endDate: dubaiDay(2), time: '15:00' })
  const pClasses = r.body?.data?.classes ?? []
  check('days 1–2 are fine: made', r.status === 200 && pClasses.length === 2, `${r.status} ${msg(r)}`)
  const progId = r.body?.data?.id
  r = await call('PATCH', `/admin/programs/${progId}`, adminJ, { endDate: dubaiDay(3) })
  check('rescheduling it into day 3 is refused, the classes left as they were', r.status === 409 && (await M.LiveClassModel.countDocuments({ programId: progId, status: 'scheduled' })) === 2, `${r.status} ${msg(r)}`)
  const day2 = pClasses.find((c: any) => new Date(c.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }) === dubaiDay(2))
  r = await call('POST', `/admin/live-classes/${day2.id}/repeat`, adminJ, { weeks: 2 })
  check('a repeat whose weeks are clear is fine', r.status === 201 && r.body?.data?.length === 2, `${r.status} ${msg(r)}`)
  const day1 = pClasses.find((c: any) => new Date(c.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }) === dubaiDay(1))
  // Haffis off on day 8 too — the first repeat of the day-1 class.
  await call('POST', '/admin/time-off/me', hafJ, { startsAt: dubaiAt(8, '00:00').toISOString(), endsAt: dubaiAt(9, '00:00').toISOString(), allDay: true })
  const before = await M.LiveClassModel.countDocuments({})
  r = await call('POST', `/admin/live-classes/${day1.id}/repeat`, adminJ, { weeks: 3 })
  check('a repeat that runs into it adds no week at all', r.status === 409 && /no weeks were added/.test(msg(r)) && (await M.LiveClassModel.countDocuments({})) === before, `${r.status} ${msg(r)}`)
  r = await call('PATCH', `/admin/live-classes/${day2.id}`, adminJ, { scheduledStart: dubaiAt(3, '15:00').toISOString() })
  check('a class moved into it is refused', r.status === 409 && /not available/.test(msg(r)), `${r.status} ${msg(r)}`)
  // Time off marked over a class already there: the class stays, can be renamed.
  r = await call('POST', '/admin/time-off/me', hafJ, { startsAt: dubaiAt(2, '14:00').toISOString(), endsAt: dubaiAt(2, '17:00').toISOString() })
  check('time off over a class already booked: allowed, the class told back', r.status === 201 && r.body?.data?.alreadyBooked?.some((b: any) => b.kind === 'class' && b.id === day2.id), JSON.stringify(r.body?.data?.alreadyBooked))
  check('…and the class is not cancelled', (await M.LiveClassModel.findById(day2.id).lean<any>())?.status === 'scheduled')
  r = await call('PATCH', `/admin/live-classes/${day2.id}`, adminJ, { title: 'Weekly review (renamed)' })
  check('…it can still be renamed', r.status === 200, `${r.status} ${msg(r)}`)

  section('E · the CS Portal')
  r = await call('POST', '/service/mentor-time-off', null, { mentorEmail: 'HAF@to.local', startsAt: dubaiAt(3, '12:00').toISOString(), endsAt: dubaiAt(3, '14:30').toISOString(), reason: 'Training', byEmail: 'chief@portal.test', byName: 'Chief' }, P)
  const portalOffId = r.body?.data?.timeOff?.id
  check('marked by email, whatever its case', r.status === 200 && !!portalOffId && r.body?.data?.timeOff?.createdByName === 'Chief', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  check('…told the 13:00 meeting was already booked inside it', r.body?.data?.alreadyBooked?.some((b: any) => b.kind === 'meeting' && b.id === beforeId), JSON.stringify(r.body?.data?.alreadyBooked))
  check('…and that meeting is not cancelled', !(await M.MentorMeetingModel.findById(beforeId).lean<any>())?.cancelledAt)
  r = await call('POST', '/service/mentor-time-off', null, { mentorEmail: 'nobody@to.local', startsAt: dubaiAt(4, '12:00').toISOString(), endsAt: dubaiAt(4, '13:00').toISOString() }, P)
  check('an unknown mentor: 404', r.status === 404, String(r.status))
  r = await call('POST', `/service/mentor-time-off/${portalOffId}/remove`, null, { mentorEmail: 'moiz@to.local' }, P)
  check('another mentor\'s email cannot take it away', r.status === 404 && (await M.MentorTimeOffModel.countDocuments({ _id: portalOffId })) === 1, String(r.status))
  r = await call('POST', `/service/mentor-time-off/${portalOffId}/remove`, null, { mentorEmail: 'haf@to.local' }, P)
  check('its own mentor\'s can', r.status === 200 && (await M.MentorTimeOffModel.countDocuments({ _id: portalOffId })) === 0, String(r.status))
  r = await call('POST', '/service/mentor-time-off', null, { mentorEmail: 'haf@to.local', startsAt: dubaiAt(4, '12:00').toISOString(), endsAt: dubaiAt(4, '13:00').toISOString() }, { 'x-portal-secret': 'wrong' })
  check('a wrong secret gets nothing', r.status === 401)

  section('F · taken away')
  r = await call('DELETE', `/admin/time-off/me/${moizOffId}`, hafJ)
  check('Haffis cannot take Moiz\'s away', r.status === 404, String(r.status))
  r = await call('DELETE', `/admin/time-off/me/${offId}`, hafJ)
  check('Haffis takes his own away', r.status === 200, String(r.status))
  r = await book(dubaiAt(3, '15:00'))
  check('…and the afternoon can be booked again', r.status === 200, `${r.status} ${msg(r)}`)
  r = await call('DELETE', `/admin/mentors/${moiz._id}/time-off/${moizOffId}`, adminJ)
  check('an admin takes Moiz\'s away', r.status === 200 && (await M.MentorTimeOffModel.countDocuments({ mentorId: moiz._id })) === 0, String(r.status))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
