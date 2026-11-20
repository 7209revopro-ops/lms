/* ─────────────────────────────────────────────────────────────
   Email Logs and WhatsApp Logs for a department's sub admin (utils/logScope.ts)

     A. super admin: everything, sign-in links shown
     B. a CMA sub admin: only mail / WhatsApps to their CMA students in their
        academy — not another department's, a dropped one's, another academy's,
        or a mentor's; summary and template list the same; a link masked;
        another student's email body answers 404; Send now refused
     C. a sub admin with no department sees nothing; an academy admin is refused
   Run: bun --no-env-file src/tests/logscope.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_logscope'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'
process.env.SMTP_HOST = ''; process.env.SMTP_BACKUP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.CLIENT_URL = 'https://app.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'logscope-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'logscope-suite-refresh-secret-0123456789'

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
if (mongoose.connection.db!.databaseName !== 'lms_logscope') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, p: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (jar) for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${r.body?.error?.message ?? ''}`.trim()
const PW = 'CorrectHorse1'

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr = await M.OrganizationModel.create({ name: 'Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mentor = await M.UserModel.create({ name: 'Mentor', email: 'mentor@ls.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: dubai._id })
  await M.UserModel.create({ name: 'Root', email: 'root@ls.local', passwordHash: hash, role: 'super_admin', isActive: true })
  await M.UserModel.create({ name: 'CMA Lead', email: 'cmalead@ls.local', passwordHash: hash, role: 'sub_admin', program: 'cma', isActive: true, organizationId: dubai._id })
  await M.UserModel.create({ name: 'Nobody', email: 'nodept@ls.local', passwordHash: hash, role: 'sub_admin', isActive: true, organizationId: dubai._id })
  await M.UserModel.create({ name: 'Academy Admin', email: 'admin@ls.local', passwordHash: hash, role: 'admin', isActive: true, organizationId: dubai._id })
  const course = (title: string, program: string, org: any) => M.CourseModel.create({ title, slug: title.toLowerCase().replace(/\W+/g, '-'), description: 'd', instructorId: mentor._id, price: 0, isFree: true, status: 'published', language: 'English', organizationId: org._id, program })
  const cma = await course('CMA Part 1', 'cma', dubai), fx = await course('MBT', '4x-trading', dubai), cmaBlr = await course('CMA Bangalore', 'cma', blr)
  const st = (name: string, phone: string, org: any) => M.UserModel.create({ name, email: `${name.toLowerCase()}@ls.local`, passwordHash: hash, role: 'student', isActive: true, enrollmentStatus: 'approved', organizationId: org._id, enrollmentApplication: { phone } })
  const ana = await st('Ana', '+971 50 111 2222', dubai), fox = await st('Fox', '+971501113333', dubai), dro = await st('Dro', '0501114444', dubai), bly = await st('Bly', '+91 98765 43210', blr)
  const enrol = (u: any, c: any, status = 'active') => M.EnrollmentModel.create({ userId: u._id, courseId: c._id, status, organizationId: c.organizationId } as any)
  await enrol(ana, cma); await enrol(fox, fx); await enrol(dro, cma, 'dropped'); await enrol(bly, cmaBlr)

  const mail = (to: string, subject: string) => M.EmailOutboxModel.create({ to, subject, html: `<p>${subject}</p>`, status: 'sent', sentAt: new Date() })
  const eAna = await mail('ana@ls.local', 'Ana: class tomorrow')
  const eFox = await mail('fox@ls.local', 'Fox: class tomorrow')
  await mail('dro@ls.local', 'Dro: dropped'); await mail('bly@ls.local', 'Bly: Bangalore'); await mail('mentor@ls.local', 'Mentor: your schedule')
  const eAnaPending = await M.EmailOutboxModel.create({ to: 'ana@ls.local', subject: 'Ana: waiting', html: '<p>w</p>', status: 'pending' })
  const wa = (to: string, templateName: string, params: string[], buttonParam?: string) => M.WhatsAppOutboxModel.create({ to, templateName, languageCode: 'en_US', params, ...(buttonParam ? { buttonParam } : {}), status: 'sent', sentAt: new Date() })
  await wa('971501112222', 'class_has_started_v2', ['Ana', 'CMA 1'], 'SECRETJOINCODE123')
  await wa('971501113333', 'class_cancelled_v1', ['Fox', 'MBT 1'])
  await wa('919876543210', 'class_cancelled_v1', ['Bly', 'CMA B'])

  const jars: Record<string, Jar> = {}
  for (const who of ['root', 'cmalead', 'nodept', 'admin']) {
    jars[who] = new Map()
    const r = await call('POST', '/admin/auth/login', jars[who], { email: `${who}@ls.local`, password: PW })
    check(`(${who} signs in)`, r.status === 200, why(r))
  }
  const subjects = (r: any) => (r.body?.data ?? []).map((d: any) => d.subject).sort()
  const tos = (r: any) => (r.body?.data ?? []).map((d: any) => d.to).sort()

  section('A · super admin: everything')
  const rootMail = await call('GET', '/email-logs', jars['root'])
  check('every email', rootMail.status === 200 && rootMail.body.data.length === 6, `${why(rootMail)} ${rootMail.body?.data?.length}`)
  const rootWa = await call('GET', '/whatsapp-logs', jars['root'])
  check('every WhatsApp', rootWa.status === 200 && rootWa.body.data.length === 3, why(rootWa))
  const rootAna = rootWa.body.data.find((d: any) => d.to === '971501112222')
  check('the join link shown in full', /SECRETJOINCODE123/.test(rootAna?.button ?? '') && !!rootAna?.login, JSON.stringify(rootAna?.button))

  section('B · a CMA sub admin: their students only')
  const m = await call('GET', '/email-logs', jars['cmalead'])
  check('only Ana\'s emails (not another department\'s, a dropped one\'s, Bangalore\'s or a mentor\'s)', m.status === 200 && JSON.stringify(subjects(m)) === JSON.stringify(['Ana: class tomorrow', 'Ana: waiting']), `${why(m)} ${JSON.stringify(subjects(m))}`)
  const ms = await call('GET', '/email-logs?q=class', jars['cmalead'])
  check('search stays inside them', JSON.stringify(subjects(ms)) === JSON.stringify(['Ana: class tomorrow']), JSON.stringify(subjects(ms)))
  const sum = await call('GET', '/email-logs/summary', jars['cmalead'])
  check('summary counts only theirs', sum.status === 200 && sum.body.data.today.total === 2 && sum.body.data.today.sent === 1, JSON.stringify(sum.body?.data?.today))
  const h1 = await call('GET', `/email-logs/${eAna._id}/html`, jars['cmalead'])
  check("their student's email body opens", h1.status === 200 && /Ana: class tomorrow/.test(h1.body?.data?.html ?? ''), why(h1))
  const h2 = await call('GET', `/email-logs/${eFox._id}/html`, jars['cmalead'])
  check("another department's answers 404", h2.status === 404, why(h2))
  const sn = await call('POST', `/email-logs/${eAnaPending._id}/send-now`, jars['cmalead'])
  check('Send now refused', sn.status === 403, why(sn))
  const w = await call('GET', '/whatsapp-logs', jars['cmalead'])
  check("only Ana's WhatsApp", w.status === 200 && JSON.stringify(tos(w)) === JSON.stringify(['971501112222']), `${why(w)} ${JSON.stringify(tos(w))}`)
  const wAna = w.body?.data?.[0]
  check('its join link masked, no login details', !!wAna && !/SECRETJOINCODE123/.test(JSON.stringify(wAna)) && !wAna.login && /••••/.test(wAna.button ?? ''), JSON.stringify(wAna?.button))
  const ws = await call('GET', '/whatsapp-logs/summary', jars['cmalead'])
  check('WhatsApp summary counts only theirs', ws.body?.data?.today?.total === 1, JSON.stringify(ws.body?.data?.today))
  const wt = await call('GET', '/whatsapp-logs/templates', jars['cmalead'])
  check('template list only theirs', JSON.stringify((wt.body?.data ?? []).map((t: any) => t.name)) === JSON.stringify(['class_has_started_v2']), JSON.stringify(wt.body?.data))

  section('C · no department, and an academy admin')
  const nd = await call('GET', '/email-logs', jars['nodept'])
  check('a sub admin with no department sees nothing', nd.status === 200 && nd.body.data.length === 0 || nd.status === 403, `${why(nd)} ${nd.body?.data?.length}`)
  const ndw = await call('GET', '/whatsapp-logs', jars['nodept'])
  check('…on WhatsApp either', ndw.status === 200 && ndw.body.data.length === 0 || ndw.status === 403, why(ndw))
  const ad = await call('GET', '/email-logs', jars['admin'])
  check('an academy admin is refused, as before', ad.status === 403, why(ad))
  const adw = await call('GET', '/whatsapp-logs', jars['admin'])
  check('…WhatsApp too', adw.status === 403, why(adw))
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
