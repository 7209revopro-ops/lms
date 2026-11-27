/* ─────────────────────────────────────────────────────────
   The Recordings page's filters (2026-11-27): course, module, language,
   instructor, date range — GET /admin/recordings and /admin/recordings/filters.
     A. no filter: every recorded class, the total in meta, never one without
     B. each filter alone narrows to the right classes
     C. filters combine; the date range is Dubai days, 'to' included whole
     D. a class with no language counts as English
     E. the choices offer only what has a recording; modules only for the
        course asked about
     F. a junk id or date is ignored, never a 500
     G. an academy admin sees only their academy's, in list and choices
   Run: bun --no-env-file src/tests/recordingfilters.suite.ts
───────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_recordingfilters'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; process.env.EMAIL_FROM = ''
process.env.SMTP_BACKUP_HOST = ''; process.env.SMTP_BACKUP_USER = ''; process.env.SMTP_BACKUP_PASS = ''
process.env.JWT_ACCESS_SECRET  ??= 'recordingfilters-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'recordingfilters-refresh-secret-0123456789abcdef'
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
if (mongoose.connection.db!.databaseName !== 'lms_recordingfilters') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

/* A browser's cookie jar: a cookie set with an empty value / Max-Age=0 / a past Expires is REMOVED. */
type Jar = Map<string, string>
async function call(method: string, p: string, jar: Jar | null, opts: { body?: unknown; bearer?: string; mode?: boolean } = {}) {
  const h: Record<string, string> = {}
  if (opts.body !== undefined) h['content-type'] = 'application/json'
  if (opts.mode) h['x-auth-mode'] = 'bearer'
  if (opts.bearer) h['authorization'] = `Bearer ${opts.bearer}`
  if (jar?.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = c.split(';'); const i = pair!.indexOf('='); if (i <= 0 || !jar) continue
    const name = pair!.slice(0, i), value = pair!.slice(i + 1)
    const gone = value === '' || attrs.some(a => /^\s*max-age=0\s*$/i.test(a)) ||
      attrs.some(a => { const m = /^\s*expires=(.+)$/i.exec(a); return !!m && Date.parse(m[1]!) <= Date.now() })
    if (gone) jar.delete(name); else jar.set(name, value)
  }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: any) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`
const PW = 'Password-2026'
const ME = '/admin/auth/me'

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const hash = await hashPassword(PW)
  const mkUser = (email: string, role: string, org = dubai._id) => M.UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role, isActive: true, isVerified: true, organizationId: org })
  await mkUser('super@rf.local', 'super_admin')
  await mkUser('blradmin@rf.local', 'admin', blr._id)
  const kiran = await mkUser('kiran@rf.local', 'instructor'), libin = await mkUser('libin@rf.local', 'instructor'), noRec = await mkUser('norec@rf.local', 'instructor')
  const mkCourse = (title: string, slug: string, org = dubai._id) => M.CourseModel.create({ title, slug, instructorId: kiran._id, organizationId: org, status: 'published' } as any)
  const dfd = await mkCourse('DFD', 'dfd'), dwt = await mkCourse('DWT', 'dwt'), empty = await mkCourse('Nothing recorded', 'empty'), blrC = await mkCourse('BLR course', 'blr', blr._id)
  const s1 = await M.SectionModel.create({ courseId: dfd._id, title: 'Module 1', order: 1 }), s2 = await M.SectionModel.create({ courseId: dfd._id, title: 'Module 2', order: 2 })
  const s3 = await M.SectionModel.create({ courseId: dwt._id, title: 'DWT Module', order: 1 })
  const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+04:00`)
  const mk = (title: string, o: { course: any; section?: any; lang?: string | null; who: any; when: Date; rec?: boolean; org?: any }) => M.LiveClassModel.create({
    title, courseId: o.course._id, instructorId: o.who._id, organizationId: o.org ?? dubai._id, scheduledStart: o.when, durationMins: 60, status: 'ended', type: 'external',
    ...(o.section ? { sectionId: o.section._id } : {}), ...(o.lang === null ? {} : { language: o.lang ?? 'English' }),
    ...(o.rec === false ? {} : { recordingUrl: `https://drive.google.com/file/d/${title.replace(/\W/g, '')}/view` }) } as any)
  await mk('R1 DFD m1 Malayalam Kiran 20th', { course: dfd, section: s1, lang: 'Malayalam', who: kiran, when: at('2026-11-20', '10:00') })
  await mk('R2 DFD m2 English Libin 22nd',   { course: dfd, section: s2, lang: 'English',   who: libin, when: at('2026-11-22', '23:30') })
  await mk('R3 DWT Malayalam Libin 25th',    { course: dwt, section: s3, lang: 'Malayalam', who: libin, when: at('2026-11-25', '00:30') })
  await mk('R4 DFD no-language Kiran 25th',  { course: dfd, lang: null, who: kiran, when: at('2026-11-25', '18:00') })
  await mk('X1 not recorded',                { course: empty, lang: 'Hindi', who: noRec, when: at('2026-11-21', '10:00'), rec: false })
  await mk('B1 Bangalore Hindi',             { course: blrC, lang: 'Hindi', who: kiran, when: at('2026-11-23', '10:00'), org: blr._id })

  const jar: Jar = new Map()
  const login = await call('POST', '/admin/auth/login', jar, { body: { email: 'super@rf.local', password: PW }, mode: true })
  const tok: string = login.body?.data?.access_token ?? ''
  check('super admin signs in', login.status === 200 && tok.length > 20, why(login))
  const list = async (qs: string, t = tok) => {
    const r = await call('GET', `/admin/recordings?per_page=50${qs}`, null, { bearer: t })
    return { r, titles: ((r.body?.data ?? []) as any[]).map(x => String(x.title).split(' ')[0]).sort().join(','), total: r.body?.meta?.total_count }
  }

  section('A. no filter')
  const all = await list('')
  check('every recorded class, none without a recording', all.titles === 'B1,R1,R2,R3,R4', `${why(all.r)} ${all.titles}`)
  check('the total is in meta', all.total === 5, String(all.total))
  const r1 = (all.r.body?.data as any[] ?? []).find(x => String(x.title).startsWith('R1'))
  check('a row carries its module and language', r1?.section?.title === 'Module 1' && r1?.language === 'Malayalam', JSON.stringify(r1?.section) + r1?.language)

  section('B. each filter alone')
  check('course', (await list(`&courseId=${dfd._id}`)).titles === 'R1,R2,R4')
  check('module', (await list(`&sectionId=${s2._id}`)).titles === 'R2')
  check('language', (await list('&language=Malayalam')).titles === 'R1,R3')
  check('instructor', (await list(`&instructorId=${libin._id}`)).titles === 'R2,R3')
  check('from', (await list('&from=2026-11-23')).titles === 'B1,R3,R4')
  check('to, its whole Dubai day (23:30 on the 22nd is in)', (await list('&to=2026-11-22')).titles === 'R1,R2', (await list('&to=2026-11-22')).titles)

  section('C. combined')
  check('course + language', (await list(`&courseId=${dfd._id}&language=Malayalam`)).titles === 'R1')
  check('instructor + date range (00:30 Dubai on the 25th is the 25th)', (await list(`&instructorId=${libin._id}&from=2026-11-25&to=2026-11-25`)).titles === 'R3', (await list(`&instructorId=${libin._id}&from=2026-11-25&to=2026-11-25`)).titles)
  const combo = await list(`&courseId=${dfd._id}&from=2026-11-21&to=2026-11-24`)
  check('course + range, and the total follows', combo.titles === 'R2' && combo.total === 1, `${combo.titles} ${combo.total}`)

  section('D. no language = English')
  check('English includes the class with none set', (await list('&language=English')).titles === 'R2,R4', (await list('&language=English')).titles)

  section('E. the choices')
  const ch = await call('GET', '/admin/recordings/filters', null, { bearer: tok })
  const d = ch.body?.data ?? {}
  check('answered', ch.status === 200, why(ch))
  check('courses: only those with a recording', (d.courses ?? []).map((c: any) => c.title).join(',') === 'BLR course,DFD,DWT', JSON.stringify(d.courses))
  check('instructors: only those with a recording', (d.instructors ?? []).map((u: any) => u.name).join(',') === 'kiran,libin', JSON.stringify(d.instructors))
  check('languages, a missing one shown as English', (d.languages ?? []).join(',') === 'English,Hindi,Malayalam', JSON.stringify(d.languages))
  check('no modules until a course is asked about', (d.sections ?? []).length === 0)
  const chC = await call('GET', `/admin/recordings/filters?courseId=${dfd._id}`, null, { bearer: tok })
  check('modules of that course, in order', (chC.body?.data?.sections ?? []).map((x: any) => x.title).join(',') === 'Module 1,Module 2', JSON.stringify(chC.body?.data?.sections))

  section('F. junk is ignored')
  const junk = await list('&courseId=nope&sectionId=%24ne&instructorId=123&from=yesterday&to=2026-13-99')
  check('no 500, the filter just does not apply', junk.r.status === 200 && junk.titles === 'B1,R1,R2,R3,R4', `${why(junk.r)} ${junk.titles}`)
  const inj = await list('&language[$ne]=x')
  check('an object for language is not a query', inj.r.status === 200, why(inj.r))

  section('G. an academy admin')
  const bj: Jar = new Map()
  const bl = await call('POST', '/admin/auth/login', bj, { body: { email: 'blradmin@rf.local', password: PW }, mode: true })
  const btok: string = bl.body?.data?.access_token ?? ''
  const bList = await list('', btok)
  check('sees only their academy\'s recordings', bList.titles === 'B1', `${why(bList.r)} ${bList.titles}`)
  const bCh = await call('GET', '/admin/recordings/filters', null, { bearer: btok })
  check('and only their academy\'s choices', (bCh.body?.data?.courses ?? []).map((c: any) => c.title).join(',') === 'BLR course', JSON.stringify(bCh.body?.data?.courses))
  const peek = await list(`&courseId=${dfd._id}`, btok)
  check('a Dubai course id gets them nothing', peek.titles === '', peek.titles)
} catch (err) {
  fail++; lines.push(`  FAIL  the suite threw: ${(err as Error).stack ?? err}`)
} finally {
  await mongoose.connection.db!.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
