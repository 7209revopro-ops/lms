/* ─────────────────────────────────────────────────────────────
   Instructor Reviews — All reviews and the filters (2026-11-10,
   services/reviewFeed.service.ts, routes/instructorReviews.routes.ts,
   portal.routes.ts /service/instructor-reviews[/feed]):
     A  who: an admin their academy; an instructor their academy — their own
        reviews and the others'; support and students refused; the CS Portal
        every academy, or only the mentors it names by address
     B  what: mentor ratings and class feedback (not where the same student
        rated the mentor on that class — the rating stands for it, its words
        kept beside it), newest first, paged
     C  the filters: one mentor, stars, low, kind, with words, days, programme,
        a search over student, class and words — and the totals of what matches
     D  the leaderboard follows the days
   The app, HTTP and database are real.
   Usage (from backend/): REVIEWFEED_DB_URL=mongodb://127.0.0.1:<port>/lms_reviewfeed bun --no-env-file src/tests/reviewfeed.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.REVIEWFEED_DB_URL || 'mongodb://localhost:27017/lms_reviewfeed'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.JWT_ACCESS_SECRET  = 'reviewfeed-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'reviewfeed-refresh-secret-0123456789abcdef'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '90000'
process.env.ENABLE_CRON = 'false'; process.env.CLIENT_URL = 'https://lms.test'
process.env.SALES_CRM_SECRET = 'reviewfeed-portal-secret'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'ROOT_ERP_API_URL', 'ROOT_ERP_SECRET', 'COMMISSION_API_URL', 'COMMISSION_S2S_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const check = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  ${d}`) } }
const section = (n: string) => console.log(`\n${n}`)
const j = (v: unknown) => JSON.stringify(v).slice(0, 500)

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_reviewfeed') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, path: string, jar?: Jar, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const qs = (o: Record<string, string | number | boolean>) => `?${new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]))}`

try {
  const PW = 'CorrectHorse1', hash = await hashPassword(PW)
  const dubai = await M.OrganizationModel.create({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' } as any)
  const blr = await M.OrganizationModel.create({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' } as any)
  const mk = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, isVerified: true, ...o } as any)
  const ann = await mk({ name: 'Ann Mentor', email: 'ann@rf.local', role: 'instructor', organizationId: dubai._id })
  const bob = await mk({ name: 'Bob Mentor', email: 'bob@rf.local', role: 'instructor', organizationId: dubai._id })
  const raj = await mk({ name: 'Raj Mentor', email: 'raj@rf.local', role: 'instructor', organizationId: blr._id })
  await mk({ name: 'Dubai Admin', email: 'admin@rf.local', role: 'admin', organizationId: dubai._id })
  await mk({ name: 'Help Desk', email: 'support@rf.local', role: 'support', organizationId: dubai._id })
  const s1 = await mk({ name: 'Sara Student', email: 's1@rf.local', role: 'student', organizationId: dubai._id })
  const s2 = await mk({ name: 'Tom Student', email: 's2@rf.local', role: 'student', organizationId: dubai._id })
  const fx = await M.CourseModel.collection.insertOne({ title: 'Forex', slug: 'fx', program: '4x-trading', organizationId: dubai._id } as any)
  const ai = await M.CourseModel.collection.insertOne({ title: 'AI', slug: 'ai', program: 'ai', organizationId: dubai._id } as any)
  const cls = async (title: string, who: any, course: any, org: any) => (await M.LiveClassModel.collection.insertOne({ title, instructorId: who._id, courseId: course, organizationId: org, scheduledStart: new Date('2026-11-01T10:00:00Z') } as any)).insertedId
  const cA = await cls('Candles one', ann, fx.insertedId, dubai._id)
  const cA2 = await cls('Risk two', ann, fx.insertedId, dubai._id)
  const cB = await cls('Prompting', bob, ai.insertedId, dubai._id)
  const cR = await cls('Bangalore class', raj, fx.insertedId, blr._id)
  const at = (d: string) => new Date(`${d}T09:00:00Z`)
  const rev = (who: any, s: any, c: any, rating: number, d: string, comment?: string, program = '4x-trading', org = dubai._id) =>
    ({ instructorId: who._id, studentId: s._id, liveClassId: c, courseId: fx.insertedId, organizationId: org, program, rating, ...(comment ? { comment } : {}), createdAt: at(d), updatedAt: at(d) })
  await M.InstructorReviewModel.collection.insertMany([
    rev(ann, s1, cA, 5, '2026-11-02', 'Clear and patient'),
    rev(ann, s2, cA2, 2, '2026-11-05', 'Started late'),
    rev(ann, s1, cA2, 4, '2026-11-08'),
    rev(bob, s1, cB, 3, '2026-11-06', '', 'ai'),
    rev(raj, s2, cR, 1, '2026-11-07', 'No sound', '4x-trading', blr._id),
  ] as any)
  await M.ClassFeedbackModel.collection.insertMany([
    { liveClassId: cA, userId: s1._id, rating: 4, comment: 'Slides were small', createdAt: at('2026-11-02'), updatedAt: at('2026-11-02') }, // rated Ann on cA → stands beside it
    { liveClassId: cA, userId: s2._id, rating: 1, comment: 'Audio dropped', createdAt: at('2026-11-03'), updatedAt: at('2026-11-03') },   // no rating → its own row
  ] as any)

  const login = async (e: string) => { const jar: Jar = new Map(); const r = await call('POST', '/admin/auth/login', jar, { email: e, password: PW }); if (r.status !== 200) throw new Error(`login ${e}: ${r.status}`); return jar }
  const admin = await login('admin@rf.local'), annJar = await login('ann@rf.local'), support = await login('support@rf.local')
  const feed = (jar: Jar, o: Record<string, string | number | boolean> = {}) => call('GET', `/instructor-reviews/admin/feed${qs(o)}`, jar)
  const names = (b: any) => (b?.data?.reviews ?? []).map((r: any) => `${r.instructor?.name.split(' ')[0]}:${r.rating}${r.kind === 'class_feedback' ? 'cf' : ''}`)

  section('A  who')
  let r = await feed(admin)
  check("an admin: their academy's — mentor ratings and class feedback, newest first", r.status === 200 && JSON.stringify(names(r.body)) === JSON.stringify(['Ann:4', 'Bob:3', 'Ann:2', 'Ann:1cf', 'Ann:5']), j(names(r.body)))
  r = await feed(annJar)
  check("an instructor: the same — their own and the other mentors' of their academy", r.status === 200 && names(r.body).length === 5 && names(r.body).includes('Bob:3'), j(names(r.body)))
  check('…never another academy', !names(r.body).some((n: string) => n.startsWith('Raj')))
  r = await feed(support)
  check('support: refused', r.status === 403, j(r.body))
  r = await call('GET', '/instructor-reviews/admin/feed')
  check('signed out: refused', r.status === 401)
  r = await call('GET', '/instructor-reviews/admin/leaderboard', annJar)
  check("an instructor reads the leaderboard too", r.status === 200 && r.body.data.map((x: any) => x.name).join() === 'Ann Mentor,Bob Mentor', j(r.body))
  r = await call('GET', `/instructor-reviews/admin/instructor/${bob._id}`, annJar)
  check("…and opens another mentor's reviews", r.status === 200 && r.body.data.length === 1, j(r.body))

  section('B  what each says')
  r = await feed(admin)
  const rated = r.body.data.reviews.find((x: any) => x.rating === 5)
  check('a rating: the student, the class, the mentor, the programme, the words — and their words on the class beside it',
    rated.student.name === 'Sara Student' && rated.class.title === 'Candles one' && rated.instructor.email === 'ann@rf.local' && rated.program === '4x-trading'
    && rated.comment === 'Clear and patient' && rated.classComment === 'Slides were small' && rated.kind === 'mentor_rating', j(rated))
  const cf = r.body.data.reviews.find((x: any) => x.kind === 'class_feedback')
  check("class feedback with no rating of the mentor: its own row, the class's mentor", cf.id.startsWith('cf:') && cf.instructor.name === 'Ann Mentor' && cf.comment === 'Audio dropped' && cf.program === '4x-trading', j(cf))
  r = await feed(admin, { per_page: 2, page: 2 })
  check('paged: 2 a page, the second page', JSON.stringify(names(r.body)) === JSON.stringify(['Ann:2', 'Ann:1cf']) && r.body.data.total === 5 && r.body.data.page === 2, j(r.body.data))

  section('C  the filters, and the totals of what matches')
  r = await feed(admin)
  const st = r.body.data.stats
  check('totals: count, average, each star, low, with words', st.count === 5 && st.average === 3 && st.counts['1'] === 1 && st.counts['5'] === 1 && st.low === 2 && st.withComment === 3, j(st))
  r = await feed(admin, { instructor: String(bob._id) })
  check('one mentor', JSON.stringify(names(r.body)) === '["Bob:3"]')
  r = await feed(annJar, { instructor: String(ann._id) })
  check('an instructor\'s own ("My reviews")', names(r.body).length === 4 && names(r.body).every((n: string) => n.startsWith('Ann')), j(names(r.body)))
  r = await feed(admin, { instructor: String(raj._id) })
  check("another academy's mentor asked for: nothing", r.status === 200 && r.body.data.total === 0)
  r = await feed(admin, { rating: 'low' })
  check('low (1–2★)', JSON.stringify(names(r.body)) === '["Ann:2","Ann:1cf"]', j(names(r.body)))
  r = await feed(admin, { rating: 4 })
  check('one star count', JSON.stringify(names(r.body)) === '["Ann:4"]')
  r = await feed(admin, { kind: 'class_feedback' })
  check('class feedback only', JSON.stringify(names(r.body)) === '["Ann:1cf"]')
  r = await feed(admin, { kind: 'mentor_rating' })
  check('mentor ratings only', names(r.body).length === 4 && !names(r.body).some((n: string) => n.endsWith('cf')))
  r = await feed(admin, { withComment: true })
  check('with words only (blank words are none)', JSON.stringify(names(r.body)) === '["Ann:2","Ann:1cf","Ann:5"]', j(names(r.body)))
  r = await feed(admin, { from: '2026-11-03', to: '2026-11-06' })
  check('the days (Dubai), the last one included', JSON.stringify(names(r.body)) === '["Bob:3","Ann:2","Ann:1cf"]', j(names(r.body)))
  r = await feed(admin, { program: 'ai' })
  check('a programme', JSON.stringify(names(r.body)) === '["Bob:3"]')
  r = await feed(admin, { q: 'tom' })
  check("search: a student's name", JSON.stringify(names(r.body)) === '["Ann:2","Ann:1cf"]', j(names(r.body)))
  r = await feed(admin, { q: 'prompt' })
  check("…a class's title", JSON.stringify(names(r.body)) === '["Bob:3"]')
  r = await feed(admin, { q: 'patient' })
  check('…the words', JSON.stringify(names(r.body)) === '["Ann:5"]')
  r = await feed(admin, { q: '.*' })
  check('…typed text, never a pattern', r.status === 200 && r.body.data.total === 0)
  r = await feed(admin, { rating: 9, kind: 'x', program: '../', from: 'soon' })
  check('nonsense filters: ignored, not refused', r.status === 200 && r.body.data.total === 5)

  section('D  the leaderboard follows the days')
  r = await call('GET', `/instructor-reviews/admin/leaderboard${qs({ from: '2026-11-06', to: '2026-11-08' })}`, admin)
  const ann2 = r.body.data.find((x: any) => x.name === 'Ann Mentor')
  check("only the ratings in those days", ann2?.totalReviews === 1 && ann2.avgRating === 4 && r.body.data.length === 2, j(r.body.data))

  section('E  the CS Portal (its own secret)')
  const portal = (o: Record<string, string> = {}) => call('GET', `/service/instructor-reviews/feed${qs(o)}`, undefined, undefined, { 'x-portal-secret': 'reviewfeed-portal-secret' })
  r = await portal()
  check('every academy', r.status === 200 && r.body.data.total === 6 && names(r.body).includes('Raj:1'), j(names(r.body)))
  r = await portal({ emails: 'BOB@rf.local, raj@rf.local' })
  check('only the mentors it names (any letter case)', JSON.stringify(names(r.body).sort()) === '["Bob:3","Raj:1"]', j(names(r.body)))
  r = await portal({ emails: 'nobody@rf.local' })
  check('none of them known here: nothing', r.body.data.total === 0)
  r = await portal({ emails: 'ann@rf.local', rating: 'low', withComment: '1' })
  check('…with the same filters', JSON.stringify(names(r.body)) === '["Ann:2","Ann:1cf"]', j(names(r.body)))
  r = await call('GET', '/service/instructor-reviews/feed', undefined, undefined, { 'x-portal-secret': 'wrong' })
  check('a wrong secret: refused', r.status === 401)
  r = await call('GET', `/service/instructor-reviews${qs({ from: '2026-11-07', to: '2026-11-07' })}`, undefined, undefined, { 'x-portal-secret': 'reviewfeed-portal-secret' })
  check('its leaderboard follows the days', r.status === 200 && r.body.data.length === 1 && r.body.data[0].name === 'Raj Mentor', j(r.body.data))
  r = await call('GET', `/service/instructor-reviews/${ann._id}`, undefined, undefined, { 'x-portal-secret': 'reviewfeed-portal-secret' })
  check('one mentor\'s reviews still open by id (the Mentor Report)', r.status === 200 && r.body.data.total === 4, j(r.body.data))
} catch (err) {
  fail++
  console.log('  FAIL  suite threw', err)
} finally {
  server.close()
  await mongoose.connection.db!.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
