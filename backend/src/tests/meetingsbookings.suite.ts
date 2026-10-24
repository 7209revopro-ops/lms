/* ─────────────────────────────────────────────────────────────
   Mentor meetings on the Bookings page (2026-10-24) — GET /admin/meetings.
     A  a mentor sees only their own; an admin their academy's, or one mentor's
     B  the cards: upcoming, today, from the portal, completed, cancelled — counts match the list
     C  participants, who booked and from where (recorded, or inferred for older meetings)
     D  search; a meeting booked in LMS admin is recorded as such
   Run: bun --no-env-file src/tests/meetingsbookings.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_meetingsbookings'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.JWT_ACCESS_SECRET  ??= 'meetings-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'meetings-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_meetingsbookings') { console.error('REFUSING TO RUN'); process.exit(1) }
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

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword('CorrectHorse1')
  const mk = (email: string, role: string, org = dubai._id) => M.UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org })
  const mia = await mk('mia@mt.local', 'instructor'), raj = await mk('raj@mt.local', 'instructor'), bo = await mk('bo@mt.local', 'instructor', blr._id)
  await mk('admin@mt.local', 'admin')
  await mk('staffbooker@mt.local', 'admin')    // an LMS staff account that booked one by hand, long ago
  const login = async (email: string) => { const j: Jar = new Map(); const x = await call('POST', '/admin/auth/login', j, { email, password: 'CorrectHorse1' }); if (x.status !== 200) throw new Error(`${email} ${why(x)}`); return j }
  const now = Date.now(), H = 3600_000
  const meet = (mentor: any, startH: number, extra: Record<string, unknown> = {}) => M.MentorMeetingModel.create({
    mentorId: mentor._id, organizationId: mentor.organizationId, title: 'Session', kind: 'student',
    scheduledStart: new Date(now + startH * H), durationMins: 30, attendees: [{ name: 'Asha Student', email: 'asha@x.com' }],
    bookedByEmail: 'cs.athira@portal.local', ...extra,
  } as any)
  await meet(mia, 2, { title: 'Upcoming with Asha', bookedVia: 'portal' })                      // upcoming, portal
  await meet(mia, 50, { title: 'Next week', attendees: [{ name: 'Client Co', email: 'c@c.com' }, { name: 'Partner' }], kind: 'client' })  // upcoming, older → inferred portal
  await meet(mia, -5, { title: 'Done earlier', bookedByEmail: 'staffbooker@mt.local' })         // completed, older → inferred LMS
  await meet(mia, 3, { title: 'Called off', cancelledAt: new Date() })                           // cancelled
  await meet(raj, 4, { title: 'Raj meeting' })
  await meet(bo, 4, { title: 'Bangalore meeting' })

  const mj = await login('mia@mt.local'), aj = await login('admin@mt.local')

  section('A · who sees what')
  const mine = await call('GET', '/admin/meetings', mj)
  check('a mentor: only their own', mine.status === 200 && mine.body.data.items.every((m: any) => m.mentor?.email === 'mia@mt.local') && mine.body.data.items.length === 4, why(mine))
  const all = await call('GET', '/admin/meetings', aj)
  const titles = all.body?.data?.items?.map((m: any) => m.title) ?? []
  check("an admin: the academy's — not Bangalore's", titles.length === 5 && !titles.includes('Bangalore meeting'), JSON.stringify(titles))
  const one = await call('GET', `/admin/meetings?instructorId=${raj._id}`, aj)
  check('an admin, one mentor', one.body?.data?.items?.length === 1 && one.body.data.items[0].title === 'Raj meeting')
  const sneaky = await call('GET', `/admin/meetings?instructorId=${raj._id}`, mj)
  check("a mentor cannot ask for another mentor's", sneaky.body?.data?.items?.every((m: any) => m.mentor?.email === 'mia@mt.local'))

  section('B · the cards')
  const st = mine.body.data.stats
  check('counts: 4 in all, 2 upcoming, 1 completed, 1 cancelled', st.all === 4 && st.upcoming === 2 && st.completed === 1 && st.cancelled === 1, JSON.stringify(st))
  check('from the portal: 3 (one recorded, two inferred)', st.portal === 3, JSON.stringify(st))
  check('today: the ones on today, not cancelled', st.today >= 1 && st.today <= 2, JSON.stringify(st))
  for (const b of ['upcoming', 'portal', 'completed', 'cancelled'] as const) {
    const r = await call('GET', `/admin/meetings?bucket=${b}`, mj)
    check(`clicking "${b}": the list is exactly that card's count`, r.body?.data?.items?.length === st[b], `${r.body?.data?.items?.length} vs ${st[b]}`)
  }

  section('C · the rows')
  const next = mine.body.data.items.find((m: any) => m.title === 'Next week')
  check('participants: every name and email', next?.attendees?.length === 2 && next.attendees[0].email === 'c@c.com' && next.attendees[1].email === null, JSON.stringify(next?.attendees))
  check('booked by, from the portal (inferred)', next?.bookedByEmail === 'cs.athira@portal.local' && next.bookedVia === 'portal')
  const done = mine.body.data.items.find((m: any) => m.title === 'Done earlier')
  check('booked by an LMS staff account: from LMS (inferred), completed', done?.bookedVia === 'lms' && done.status === 'completed', JSON.stringify(done))
  check('a cancelled one says so', mine.body.data.items.find((m: any) => m.title === 'Called off')?.status === 'cancelled')

  section('D · search; recorded from now on')
  const s1 = await call('GET', '/admin/meetings?search=client%20co', mj)
  check('search by participant', s1.body?.data?.items?.length === 1 && s1.body.data.items[0].title === 'Next week')
  const s2 = await call('GET', '/admin/meetings?search=athira', mj)
  check('search by who booked', s2.body?.data?.items?.length === 3, String(s2.body?.data?.items?.length))
  const { createMentorMeetingForPortal } = await import('@/services/portal.service.ts')
  await createMentorMeetingForPortal({ mentorEmail: 'mia@mt.local', title: 'From the portal', kind: 'student', scheduledStart: new Date(now + 24 * H).toISOString(), durationMins: 30, attendees: [{ name: 'A B', email: 'ab@x.com' }], bookedByEmail: 'cs@portal.local', meetingUrl: 'https://meet.google.com/abc-defg-hij', remoteOrgId: String(dubai._id) } as any).catch(e => lines.push(`  note: ${e.message}`))
  await createMentorMeetingForPortal({ mentorEmail: 'mia@mt.local', title: 'From LMS admin', kind: 'staff', scheduledStart: new Date(now + 25 * H).toISOString(), durationMins: 30, attendees: [{ name: 'C D', email: 'cd@x.com' }], bookedByEmail: 'admin@mt.local', bookedVia: 'lms', meetingUrl: 'https://meet.google.com/abc-defg-hik', remoteOrgId: String(dubai._id) } as any).catch(e => lines.push(`  note: ${e.message}`))
  const rec = await M.MentorMeetingModel.find({ title: { $in: ['From the portal', 'From LMS admin'] } }).lean() as any[]
  check('a new meeting records where it was booked', rec.length === 2 && rec.find(m => m.title === 'From the portal')?.bookedVia === 'portal' && rec.find(m => m.title === 'From LMS admin')?.bookedVia === 'lms', JSON.stringify(rec.map(m => [m.title, m.bookedVia])))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
