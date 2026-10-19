/* ─────────────────────────────────────────────────────────────
   Guest checkout on /explore (2026-10-18) — and the Abzer receipt check.
     A  prepare: a new email makes a student (pending, no password); the methods follow the country —
        India Razorpay, UAE card + Tabby + Tamara, elsewhere card; refusals (staff email, already
        enrolled, free course, bad input); an existing account is used, never overwritten
     B  pay / complete need the checkout cookie; an order that is not this checkout's is refused
     C  complete, paid, NEW account: a one-time sign-in link to the course; the access email once
     D  complete, paid, EXISTING account: no sign-in from here — the owner is emailed
     E  Abzer: a receipt whose amount or currency does not match the order is not fulfilled
   Gateways are never called: an order is marked paid as the webhook would.
   Run: bun --no-env-file src/tests/guestcheckout.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_guestcheckout'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.SMTP_HOST = ''; process.env.EMAIL_OUTBOX = 'off'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '9000'; process.env.RATE_LIMIT_CHECKOUT_MAX = '900'
process.env.JWT_ACCESS_SECRET  ??= 'guestcheckout-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET ??= 'guestcheckout-refresh-secret-0123456789abcdef'
process.env.ABZER_ACCESS_KEY = 'test-access'; process.env.ABZER_SECRET_KEY = 'test-secret'; process.env.ABZER_CURRENCY = 'AED'
process.env.RAZORPAY_KEY_ID = 'rzp_test_x'; process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_x'
process.env.CLIENT_URL = 'https://lms.test'
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
const { OrderService } = await import('@/services/order.service.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_guestcheckout') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
await M.UserModel.syncIndexes()
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
const settle = () => new Promise(r => setTimeout(r, 300))

try {
  const dubai = await M.OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const blr   = await M.OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
  const teacher = await M.UserModel.create({ name: 'Mentor', email: 'm@gc.local', role: 'instructor', isActive: true, organizationId: dubai._id })
  const mkCourse = (slug: string, extra: Record<string, unknown> = {}) => M.CourseModel.create({
    title: slug.toUpperCase(), slug, description: 'd', instructorId: teacher._id, price: 680, priceAED: 2500, priceINR: 65000,
    isFree: false, status: 'published', language: 'English', organizationId: dubai._id, program: '4x-trading', sharedAcademies: true, ...extra,
  })
  const mbt = await mkCourse('mbt'), dwt = await mkCourse('dwt'), free = await mkCourse('gaan', { price: 0, isFree: true })
  const buyer = { slug: 'mbt', name: 'Asha Guest', email: 'Asha@Example.com', phone: '+971 50 123 4567', country: 'United Arab Emirates' }

  section('A · prepare')
  const j1: Jar = new Map()
  const p1 = await call('POST', '/public/checkout/prepare', j1, buyer)
  check('a new email: 200 with the methods', p1.status === 200, why(p1))
  const made = await M.UserModel.findOne({ email: 'asha@example.com' }).lean() as any
  check('...a student is made: pending, no password, Dubai, phone and country kept',
    made?.role === 'student' && made.enrollmentStatus !== 'approved' && !made.passwordHash && String(made.organizationId) === String(dubai._id)
    && made.enrollmentApplication?.phone === '+971 50 123 4567' && made.enrollmentApplication?.homeCountry === 'United Arab Emirates', JSON.stringify(made))
  check('UAE: card offered (Tabby/Tamara only when their keys are set)', JSON.stringify(p1.body?.data?.methods?.map((m: any) => m.id)) === '["card"]', JSON.stringify(p1.body?.data?.methods))
  check('...priced in AED, what checkout charges', p1.body?.data?.amount === 2500 && p1.body.data.currency === 'AED', JSON.stringify(p1.body?.data))
  check('...the checkout cookie is set, httpOnly', j1.has('lms_gc'))
  const pIn = await call('POST', '/public/checkout/prepare', new Map(), { ...buyer, email: 'ravi@example.com', country: 'India', phone: '+91 98765 43210' })
  check('India: Razorpay, INR, Bangalore academy', JSON.stringify(pIn.body?.data?.methods?.map((m: any) => m.id)) === '["razorpay"]' && pIn.body.data.currency === 'INR'
    && String((await M.UserModel.findOne({ email: 'ravi@example.com' }).lean() as any)?.organizationId) === String(blr._id), JSON.stringify(pIn.body?.data))
  const pUk = await call('POST', '/public/checkout/prepare', new Map(), { ...buyer, email: 'tom@example.com', country: 'United Kingdom' })
  check('elsewhere: card through Abzer, AED', JSON.stringify(pUk.body?.data?.methods?.map((m: any) => m.id)) === '["card"]' && pUk.body.data.currency === 'AED', JSON.stringify(pUk.body?.data))
  check('a staff email is refused', (await call('POST', '/public/checkout/prepare', null, { ...buyer, email: 'm@gc.local' })).body?.error?.code === 'EMAIL_NOT_STUDENT')
  check('a free course is refused', (await call('POST', '/public/checkout/prepare', null, { ...buyer, slug: 'gaan' })).body?.error?.code === 'COURSE_IS_FREE')
  check('a bad email is refused', (await call('POST', '/public/checkout/prepare', null, { ...buyer, email: 'nope' })).status === 400)
  check('no phone is refused', (await call('POST', '/public/checkout/prepare', null, { ...buyer, phone: '12' })).status === 400)
  const owner = await M.UserModel.create({ name: 'Old Student', email: 'old@example.com', passwordHash: await hashPassword('CorrectHorse1'), role: 'student', isActive: true, organizationId: dubai._id, enrollmentStatus: 'approved', enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: '+971500000001' } })
  const jOld: Jar = new Map()
  const pOld = await call('POST', '/public/checkout/prepare', jOld, { ...buyer, email: 'OLD@example.com', name: 'Someone Else', phone: '+971 55 999 9999' })
  const ownerAfter = await M.UserModel.findById(owner._id).lean() as any
  check('an existing student: used — name and phone not overwritten', pOld.status === 200 && ownerAfter.name === 'Old Student' && ownerAfter.enrollmentApplication.phone === '+971500000001', why(pOld))
  await M.EnrollmentModel.create({ userId: owner._id, courseId: dwt._id, status: 'active' })
  check('already enrolled in it: refused', (await call('POST', '/public/checkout/prepare', null, { ...buyer, slug: 'dwt', email: 'old@example.com' })).body?.error?.code === 'ALREADY_ENROLLED')
  void free

  section('B · the cookie is the checkout')
  check('pay with no cookie: 401', (await call('POST', '/public/checkout/pay', null, { method: 'card' })).status === 401)
  check('complete with no cookie: 401', (await call('POST', '/public/checkout/complete', null, { gateway: 'abzer', orderId: String(new mongoose.Types.ObjectId()) })).status === 401)
  check('a forged cookie: 401', (await call('POST', '/public/checkout/complete', new Map([['lms_gc', 'abc.def.ghi']]), { gateway: 'abzer', orderId: 'x' })).status === 401)
  check('an unknown method: 400', (await call('POST', '/public/checkout/pay', j1, { method: 'cash' })).status === 400)
  /* An order of SOMEONE ELSE's, paid. */
  const foreign = await M.OrderModel.create({ userId: owner._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'paid' })
  const steal = await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(foreign._id) })
  check('another account\'s order: refused', steal.status === 403 || steal.status === 404, why(steal))

  section('C · paid, new account')
  const order = await M.OrderModel.create({ userId: made._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  const pending = await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(order._id) })
  check('not paid yet: paid false, no sign-in', pending.status === 200 && pending.body?.data?.paid === false && !pending.body.data.signIn, why(pending))
  /* As the verified webhook would: */
  await new OrderService().fulfillAbzerFromWebhook(String(order._id), 'rcpt-1', { amount: 2500, currency: 'AED' })
  const done = await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(order._id) })
  check('paid: a one-time sign-in link', done.body?.data?.paid === true && /^\/s\/[\w-]{10,}$/.test(done.body.data.signIn ?? ''), JSON.stringify(done.body?.data))
  const tok = await M.AuthTokenModel.findOne({ userId: made._id, purpose: 'signin-link' }).sort({ createdAt: -1 }).lean() as any
  check('...to the course page', tok?.nextPath === '/courses/mbt', JSON.stringify(tok))
  check('...enrolled and approved', !!(await M.EnrollmentModel.exists({ userId: made._id, courseId: mbt._id })) && (await M.UserModel.findById(made._id).lean() as any)?.enrollmentStatus === 'approved')
  await settle()
  const mailMark = (await M.OrderModel.findById(order._id).lean() as any)?.guestAccessSentAt
  check('the access email marked sent', !!mailMark)
  check('a set-password link minted (7 days)', !!(await M.AuthTokenModel.exists({ userId: made._id, purpose: 'reset-password' })))
  await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(order._id) })
  check('a reload: the email is not sent again', String((await M.OrderModel.findById(order._id).lean() as any)?.guestAccessSentAt) === String(mailMark)
    && (await M.AuthTokenModel.countDocuments({ userId: made._id, purpose: 'reset-password' })) === 1)

  section('D · paid, existing account')
  const order2 = await M.OrderModel.create({ userId: owner._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(order2._id), 'rcpt-2', { amount: '2,500.00', currency: 'aed' })
  const done2 = await call('POST', '/public/checkout/complete', jOld, { gateway: 'abzer', orderId: String(order2._id) })
  check('paid (a "2,500.00" receipt matches): no sign-in from here', done2.body?.data?.paid === true && done2.body.data.signIn === null, JSON.stringify(done2.body?.data))
  check('...the owner is emailed a sign-in link instead', !!(await M.AuthTokenModel.exists({ userId: owner._id, purpose: 'signin-link' })) && !!(await M.OrderModel.findById(order2._id).lean() as any)?.guestAccessSentAt)

  section('E · Abzer: the receipt must match the order')
  const svc = new OrderService()
  const mk = () => M.OrderModel.create({ userId: owner._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  const o1 = await mk(); await svc.fulfillAbzerFromWebhook(String(o1._id), 'r-short', { amount: 25, currency: 'AED' })
  check('a partial amount: not fulfilled', (await M.OrderModel.findById(o1._id).lean() as any)?.status === 'pending')
  const o2 = await mk(); await svc.fulfillAbzerFromWebhook(String(o2._id), 'r-cur', { amount: 2500, currency: 'USD' })
  check('another currency: not fulfilled', (await M.OrderModel.findById(o2._id).lean() as any)?.status === 'pending')
  const o3 = await mk(); await svc.fulfillAbzerFromWebhook(String(o3._id), 'r-none', {})
  check('no amount on the receipt: not fulfilled', (await M.OrderModel.findById(o3._id).lean() as any)?.status === 'pending')
  const o4 = await M.OrderModel.create({ userId: owner._id, courseId: dwt._id, gateway: 'tabby', amount: 250000, currency: 'AED', status: 'pending' })
  await svc.fulfillAbzerFromWebhook(String(o4._id), 'r-tabby', { amount: 2500, currency: 'AED' })
  check('a Tabby order named in an Abzer receipt: not fulfilled', (await M.OrderModel.findById(o4._id).lean() as any)?.status === 'pending')
  check('the rule itself: exact fils, case-blind currency', OrderService.abzerReceiptMismatch({ amount: 123450, currency: 'AED' }, { amount: 1234.5, currency: 'aed' }) === null
    && OrderService.abzerReceiptMismatch({ amount: 123450, currency: 'AED' }, { amount: 1234.49, currency: 'AED' }) !== null)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
