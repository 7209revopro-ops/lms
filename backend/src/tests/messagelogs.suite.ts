/* ─────────────────────────────────────────────────────────────
   Email Logs + WhatsApp Logs (routes/emailoutbox.routes.ts,
   routes/whatsappoutbox.routes.ts).

     A. super admin only (an academy admin gets 403);
     B. WhatsApp list: the message rendered from its template, the student
        matched by phone, a one-tap login link MASKED, filters (status,
        template, search by name / phone, date range);
     C. summaries: today and last 7 days by status;
     D. Email list: search by subject, date range.
   Run: bun --no-env-file src/tests/messagelogs.suite.ts
───────────────────────────────────────────────────────────── */
export {}
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_messagelogs'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.WHATSAPP_API_KEY = ''; process.env.WHATSAPP_PHONE_NUMBER_ID = ''
process.env.CLIENT_URL = 'https://lms.example.test'
process.env.JWT_ACCESS_SECRET  ??= 'msglogs-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'msglogs-suite-refresh-secret-0123456789'

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
if (mongoose.connection.db!.databaseName !== 'lms_messagelogs') { console.error('REFUSING TO RUN'); process.exit(1) }
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
const DAY = 86_400_000

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const sa = await M.UserModel.create({ name: 'SA', email: 'sa@ml.local', passwordHash: hash, role: 'super_admin', isActive: true, isVerified: true })
  await M.UserModel.create({ name: 'Ad', email: 'ad@ml.local', passwordHash: hash, role: 'admin', isActive: true, isVerified: true, organizationId: org._id })
  await M.UserModel.create({ name: 'Reema Thomas', email: 'reema@ml.local', passwordHash: hash, role: 'student', isActive: true, organizationId: org._id, enrollmentApplication: { phone: '+971 50 402 7626' } })
  const now = new Date(), old = new Date(Date.now() - 20 * DAY)
  const wa = (o: Record<string, unknown>) => M.WhatsAppOutboxModel.create({ languageCode: 'en_US', attempts: 1, nextAttemptAt: now, category: 'utility', ...o })
  await wa({ to: '971504027626', templateName: 'new_class_scheduled_v1', params: ['Reema', 'MBT', 'MBT 4', 'Fri, 9 Oct', '05:00 PM GST'], buttonParam: 'SECRETCODE1234567890ab', status: 'sent', sentAt: now, waMessageId: 'wamid.1' })
  await wa({ to: '919000000001', templateName: 'booking_confirmed_v2', params: ['Arun', 'IM 2', 'Sat', '4 PM'], status: 'failed', lastError: '(#131026) Message undeliverable' })
  await wa({ to: '971500000000', templateName: 'todays_classes_v1', params: ['X', 'a · b'], buttonParam: 'OTHERSECRET', status: 'sent', sentAt: old })
  await M.WhatsAppOutboxModel.collection.updateOne({ templateName: 'todays_classes_v1' }, { $set: { createdAt: old } })
  await M.EmailOutboxModel.create({ to: 'reema@ml.local', subject: 'Your class is moved', html: '<p>x</p>', status: 'sent', sentAt: now, attempts: 1, nextAttemptAt: now })
  await M.EmailOutboxModel.create({ to: 'arun@ml.local', subject: 'Welcome aboard', html: '<p>y</p>', status: 'failed', lastError: 'quota', attempts: 3, nextAttemptAt: now })

  const login = async (email: string) => { const j: Jar = new Map(); const r = await call('POST', '/admin/auth/login', { jar: j, body: { email, password: PW } }); if (r.status !== 200) throw new Error('login ' + why(r)); return j }
  const SA = await login(sa.email), AD = await login('ad@ml.local')

  section('A · super admin only')
  for (const p of ['/whatsapp-logs', '/whatsapp-logs/summary', '/email-logs/summary']) {
    const r = await call('GET', p, { jar: AD })
    check(`academy admin → ${p}: 403`, r.status === 403, why(r))
  }

  section('B · WhatsApp list')
  const all = await call('GET', '/whatsapp-logs', { jar: SA })
  check('200, 3 rows, newest first', all.status === 200 && all.body?.data?.length === 3 && all.body.data[2].templateName === 'todays_classes_v1', why(all))
  const nc = all.body?.data?.find((d: any) => d.templateName === 'new_class_scheduled_v1')
  check('message rendered from the template', nc?.text?.startsWith('Hi Reema, a new class has been scheduled in *MBT*') && nc?.text?.includes('*MBT 4* — Fri, 9 Oct, 05:00 PM GST'), nc?.text)
  check('labelled values + friendly name', nc?.label === 'New class scheduled' && nc?.values?.[1]?.name === 'Course' && nc?.values?.[1]?.value === 'MBT')
  check('student matched by phone (stored "+971 50 402 7626")', nc?.person?.name === 'Reema Thomas', JSON.stringify(nc?.person))
  check('one-tap login link masked, code never sent', nc?.button?.includes('/s/••••') && !JSON.stringify(all.body).includes('SECRETCODE') && !JSON.stringify(all.body).includes('OTHERSECRET'), nc?.button)
  const bc = all.body?.data?.find((d: any) => d.templateName === 'booking_confirmed_v2')
  check('unknown wording: values only, error shown', !bc?.text && bc?.values?.[0]?.name === 'Name' && bc?.lastError?.includes('131026'))
  const f1 = await call('GET', '/whatsapp-logs?status=failed', { jar: SA })
  check('status filter', f1.body?.data?.length === 1 && f1.body.data[0].status === 'failed')
  const f2 = await call('GET', '/whatsapp-logs?template=todays_classes_v1', { jar: SA })
  check('template filter', f2.body?.data?.length === 1)
  const f3 = await call('GET', '/whatsapp-logs?q=reema', { jar: SA })
  check('search by student name', f3.body?.data?.length === 1 && f3.body.data[0].to === '971504027626', JSON.stringify(f3.body?.data?.map((d: any) => d.to)))
  const f4 = await call('GET', '/whatsapp-logs?q=9000000001', { jar: SA })
  check('search by phone digits', f4.body?.data?.length === 1 && f4.body.data[0].templateName === 'booking_confirmed_v2')
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
  const f5 = await call('GET', `/whatsapp-logs?from=${todayKey}&until=${todayKey}`, { jar: SA })
  check('date range (today) leaves out the 20-day-old one', f5.body?.data?.length === 2, String(f5.body?.data?.length))
  const tpl = await call('GET', '/whatsapp-logs/templates', { jar: SA })
  check('templates list, labelled', tpl.body?.data?.some((t: any) => t.name === 'todays_classes_v1' && t.label === "Today's classes"))

  section('C · summaries')
  const ws = await call('GET', '/whatsapp-logs/summary', { jar: SA })
  check('WhatsApp today: 1 sent, 1 failed', ws.body?.data?.today?.sent === 1 && ws.body.data.today.failed === 1 && ws.body.data.today.total === 2, JSON.stringify(ws.body?.data))
  check('WhatsApp last 7 days excludes the old one', ws.body?.data?.last7Days?.total === 2)
  const es = await call('GET', '/email-logs/summary', { jar: SA })
  check('Email today: 1 sent, 1 failed', es.body?.data?.today?.sent === 1 && es.body.data.today.failed === 1, JSON.stringify(es.body?.data))

  section('D · Email list search + dates')
  const e1 = await call('GET', '/email-logs?q=moved', { jar: SA })
  check('search by subject', e1.body?.data?.length === 1 && e1.body.data[0].subject === 'Your class is moved', why(e1))
  const e2 = await call('GET', '/email-logs?q=arun@', { jar: SA })
  check('search by recipient', e2.body?.data?.length === 1)
  const e3 = await call('GET', '/email-logs?from=2020-01-01&until=2020-01-02', { jar: SA })
  check('date range with nothing in it', e3.body?.data?.length === 0)
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
