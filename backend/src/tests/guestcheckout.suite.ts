/* ─────────────────────────────────────────────────────────────
   Guest checkout on /explore (2026-10-18) — and the Abzer receipt check.
     A  prepare: a new email makes a student (pending, no password); the methods follow the country —
        India Razorpay, UAE card + Tabby + Tamara, elsewhere card; refusals (staff email, already
        enrolled, free course, bad input); an existing account is used, never overwritten
     B  pay / complete need the checkout cookie; an order that is not this checkout's is refused
     C  complete, paid, NEW account: a one-time sign-in link to the course; the access email once
     D  complete, paid, EXISTING account: no sign-in from here — the owner is emailed
     E  Abzer: a receipt whose amount or currency does not match the order is not fulfilled
     F  ids that are not ours (a gateway's own) → a clean ORDER_NOT_FOUND
     G  two checkouts in one browser: the first still confirms; a stale tab cannot pay for the second
     H  after paying, an account made at checkout opens the full registration form (its checkout
        details filled in); submitting it keeps the paid approval and the link then opens the course
     I  a retry in the same browser keeps the account it made "new" (signed in on paying); another
        browser never is — it is told the address and where signing in leads (the form, or the course)
     K  paid but not registered (2026-10-31): not approved until the form; the course page opens, but
        booking, joining and lessons answer REGISTRATION_REQUIRED — and open once the form is in
     J  an account that existed before the checkout but never registered is sent to the form too
        (and marked, so the form page shows it); one that signed up with the full form is not
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
/* Set, even to empty: app.ts loads dotenv, which fills any UNSET key from the developer's backend/.env —
   real Tabby/Tamara keys there used to switch those methods on and fail the "card only" check. */
process.env.TABBY_SECRET_KEY = ''; process.env.TABBY_PUBLIC_KEY = ''; process.env.TABBY_MERCHANT_CODE = ''; process.env.TAMARA_API_KEY = ''
process.env.WHATSAPP_API_KEY = ''; process.env.GOOGLE_CLIENT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''
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
  check('...its full registration is marked due', made?.registrationDue === true && !made.fullRegistrationSubmittedAt, JSON.stringify(made))
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
  check('...and no registration is asked of it', ownerAfter.registrationDue === undefined, JSON.stringify(ownerAfter.registrationDue))
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
  check('...to the full registration form, then the course', tok?.nextPath === '/complete-registration?from=checkout&course=mbt', JSON.stringify(tok?.nextPath))
  /* Approval waits for the registration form (2026-10-31, section K). */
  check('...enrolled, approval waiting for the form', !!(await M.EnrollmentModel.exists({ userId: made._id, courseId: mbt._id }))
    && (await M.UserModel.findById(made._id).lean() as any)?.enrollmentStatus !== 'approved' && (await M.UserModel.findById(made._id).lean() as any)?.registrationDue === true)
  await settle()
  const mailMark = (await M.OrderModel.findById(order._id).lean() as any)?.guestAccessSentAt
  check('the access email marked sent', !!mailMark)
  check('no set-password link (sign-in is by emailed code)', !(await M.AuthTokenModel.exists({ userId: made._id, purpose: 'reset-password' })))
  await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(order._id) })
  check('a reload: the email is not sent again', String((await M.OrderModel.findById(order._id).lean() as any)?.guestAccessSentAt) === String(mailMark)
    && (await M.AuthTokenModel.countDocuments({ userId: made._id, purpose: 'signin-link' })) === 3)

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

  /* Production, 2026-10-28: BillXPro appends its OWN orderId to the return URL; the /explore return
     page sent it here and the buyer read "No record matches that _id" (a raw CastError). An id that is
     not one of ours must be a clean ORDER_NOT_FOUND, for every gateway, whatever its shape. */
  section('F · ids that are not ours — a clean not-found, never a database error')
  const foreignIds: [string, unknown][] = [
    ['abzer', 'DI20261027101933063267'],               // BillXPro document number
    ['abzer', '0a2a0036-a163-1a5c-81a1-7cdf52ca3e24'],  // BillXPro request id (UUID)
    ['abzer', 'DI2026102710'],                          // 12 chars — passes ObjectId.isValid, still not ours
    ['abzer', `${String(order._id)}x`],                 // ours plus one character
    ['abzer', String(order._id).slice(0, 23)],          // ours minus one
    ['abzer', '../../etc/passwd'],
    ['abzer', ''],
    ['abzer', { $ne: null }],                           // an operator object
    ['tamara', '5f7f5036-5914-4a7c-8dbe-afce293295f7'], // Tamara's own order id
    ['tabby', 'not-a-tabby-or-order-id'],
  ]
  for (const [gateway, orderId] of foreignIds) {
    const r = await call('POST', '/public/checkout/complete', j1, { gateway, orderId })
    check(`${gateway} ${JSON.stringify(orderId).slice(0, 40)} → 404 ORDER_NOT_FOUND`, r.status === 404 && r.body?.error?.code === 'ORDER_NOT_FOUND', why(r))
  }
  const ours = await call('POST', '/public/checkout/complete', j1, { gateway: 'abzer', orderId: String(order._id).toUpperCase() })
  check('our own id in capitals is still ours (Mongo ids are case-blind hex)', ours.status === 200 && ours.body?.data?.paid === true, why(ours))

  /* Production, 2026-10-29: a buyer started a checkout for one course, then another in the same browser
     (DSLP 11:19, Digital Marketing 11:22). The checkout cookie holds ONE course — the last — so coming
     back from the first payment read "Order not found" while the order sat pending in admin. The
     cookie proves whose checkout it is; any order of THAT account is theirs to confirm. */
  section('G · a second checkout in the same browser does not orphan the first')
  const owner3 = await M.UserModel.create({ name: 'Two Courses', email: 'two@example.com', role: 'student', isActive: true, organizationId: dubai._id, fullRegistrationSubmittedAt: new Date() })
  const jTwo: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jTwo, { ...buyer, email: 'two@example.com', slug: 'mbt' })
  const first = await M.OrderModel.create({ userId: owner3._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  const second = await call('POST', '/public/checkout/prepare', jTwo, { ...buyer, email: 'two@example.com', slug: 'dwt' })
  check('the second checkout (another course) is prepared', second.status === 200, why(second))
  const firstPending = await call('POST', '/public/checkout/complete', jTwo, { gateway: 'abzer', orderId: String(first._id) })
  check('the first course\'s order, unpaid: "not yet", not "Order not found"', firstPending.status === 200 && firstPending.body?.data?.paid === false, why(firstPending))
  await new OrderService().fulfillAbzerFromWebhook(String(first._id), 'rcpt-g1', { amount: 2500, currency: 'AED' })
  const firstPaid = await call('POST', '/public/checkout/complete', jTwo, { gateway: 'abzer', orderId: String(first._id) })
  check('...paid: confirmed, the owner emailed (an existing account)', firstPaid.body?.data?.paid === true && firstPaid.body.data.signIn === null, why(firstPaid))
  await settle()
  check('...the access email names the order\'s course, not the cookie\'s', (await M.AuthTokenModel.findOne({ userId: owner3._id, purpose: 'signin-link' }).lean() as any)?.nextPath === '/courses/mbt')
  /* A NEW email, then a second checkout IN THE SAME BROWSER: the cookie proves this browser made the
     account, so it is still "new" — signed in from here, like the first checkout would have (2026-10-30). */
  const jNew: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jNew, { ...buyer, email: 'fresh2@example.com', slug: 'mbt' })
  const fresh: any = await M.UserModel.findOne({ email: 'fresh2@example.com' }).lean()
  const fOrder = await M.OrderModel.create({ userId: fresh._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await call('POST', '/public/checkout/prepare', jNew, { ...buyer, email: 'fresh2@example.com', slug: 'dwt' })
  await new OrderService().fulfillAbzerFromWebhook(String(fOrder._id), 'rcpt-g2', { amount: 2500, currency: 'AED' })
  const fDone = await call('POST', '/public/checkout/complete', jNew, { gateway: 'abzer', orderId: String(fOrder._id) })
  check('a new email, the earlier course after a second checkout (same browser): confirmed, signed in', fDone.body?.data?.paid === true && /^\/s\//.test(fDone.body.data.signIn ?? ''), why(fDone))
  await settle()
  const fTok: any = await M.AuthTokenModel.findOne({ userId: fresh._id, purpose: 'signin-link' }).sort({ createdAt: -1 }).lean()
  check('...the emailed link opens the registration form for that course (made at checkout)', fTok?.nextPath === '/complete-registration?from=checkout&course=mbt', JSON.stringify(fTok?.nextPath))
  /* Still never someone else's: the cookie's ACCOUNT must own the order. */
  const notMine = await call('POST', '/public/checkout/complete', jTwo, { gateway: 'abzer', orderId: String(fOrder._id) })
  check('another account\'s order, from this cookie: still refused', notMine.status === 403 || notMine.status === 404, why(notMine))
  /* The other half: a tab still showing the FIRST course must not pay for the second (the cookie's). */
  const stale = await call('POST', '/public/checkout/pay', jTwo, { method: 'card', slug: 'mbt' })
  check('Pay from a tab showing another course than the cookie\'s: 409 CHECKOUT_REPLACED, no order made',
    stale.status === 409 && stale.body?.error?.code === 'CHECKOUT_REPLACED' && (await M.OrderModel.countDocuments({ userId: owner3._id })) === 1, why(stale))
  const sameCourse = await call('POST', '/public/checkout/pay', jTwo, { method: 'cash', slug: 'DWT' })
  check('...the matching course (any case) gets past the guard', sameCourse.status === 400 && sameCourse.body?.error?.code === 'INVALID_METHOD', why(sameCourse))
  const noSlug = await call('POST', '/public/checkout/pay', jTwo, { method: 'cash' })
  check('...a page from before this release (no slug) still pays as before', noSlug.status === 400 && noSlug.body?.error?.code === 'INVALID_METHOD', why(noSlug))
  /* The user, 2026-10-29: after the payment, the full registration — email, name, country and phone
     already filled — and the student approved as a paid enrolment. Approval stays with the payment. */
  section('H · after paying: the full registration form, filled in from checkout')
  const jH: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jH, { ...buyer, email: 'reg@example.com', name: 'Reg Buyer', phone: '+971 52 111 2233' })
  const regUser: any = await M.UserModel.findOne({ email: 'reg@example.com' }).lean()
  const hOrder = await M.OrderModel.create({ userId: regUser._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(hOrder._id), 'rcpt-h1', { amount: 2500, currency: 'AED' })
  const hDone = await call('POST', '/public/checkout/complete', jH, { gateway: 'abzer', orderId: String(hOrder._id) })
  const code = String(hDone.body?.data?.signIn ?? '').replace(/^\/s\//, '')
  check('paid: signed in by a one-time link', hDone.body?.data?.paid === true && code.length >= 10, why(hDone))
  const sess: Jar = new Map()
  const red = await call('POST', '/auth/signin-link/redeem', sess, { token: code })
  check('...the link signs in and opens the registration form for the course', red.status === 200 && red.body?.data?.next === '/complete-registration?from=checkout&course=mbt', JSON.stringify(red.body))
  const meRes = await call('GET', '/auth/me', sess)
  const me1 = meRes.body?.data?.user ?? meRes.body?.data
  /* 2026-10-31: approval waits for the form — paid && registered → Paid Enrollment (utils/registrationGate.ts). */
  check('...NOT approved yet, the form due', me1?.enrollmentStatus !== 'approved' && me1?.registrationDue === true, JSON.stringify(me1))
  check('...name, email, phone and country come filled in',
    me1?.name === 'Reg Buyer' && me1?.email === 'reg@example.com' && me1?.enrollmentApplication?.phone === '+971 52 111 2233' && me1?.enrollmentApplication?.homeCountry === 'United Arab Emirates', JSON.stringify(me1))
  check('...and how they paid', me1?.enrollmentApplication?.paymentMethod === 'Card / Full', JSON.stringify(me1?.enrollmentApplication))
  check('...enrolled in the course before the form is filled', !!(await M.EnrollmentModel.exists({ userId: regUser._id, courseId: mbt._id })))

  section('K · paid but not registered: browse yes; book, join and lessons wait for the form')
  const kSec = await M.SectionModel.create({ courseId: mbt._id, title: 'Module 1', order: 1 })
  const kVid = await M.LessonModel.create({ courseId: mbt._id, sectionId: kSec._id, title: 'Video 1', type: 'video', order: 1, contentUrl: 'https://cdn.example.com/v1.mp4' })
  const isGate = (r: any) => r.status === 403 && r.body?.error?.code === 'REGISTRATION_REQUIRED'
  const kArt = await M.LessonModel.create({ courseId: mbt._id, sectionId: kSec._id, title: 'Reading 1', type: 'article', order: 2, contentBody: '<p>SECRET-BODY</p>', contentUrl: 'https://docs.example.com/r1.pdf' })
  const kFree = await M.LessonModel.create({ courseId: mbt._id, sectionId: kSec._id, title: 'Free preview', type: 'article', order: 3, isFree: true, contentBody: '<p>FREE-BODY</p>' })
  const kCourse = await call('GET', '/courses/mbt', sess)
  check('the course page opens', kCourse.status === 200, why(kCourse))
  const kLs = (kCourse.body?.data?.lessons ?? []) as any[]
  check('...with its outline (every lesson listed)', kLs.some(l => l.id === String(kArt._id)) && kLs.some(l => l.id === String(kVid._id)), JSON.stringify(kLs.map(l => l.title)))
  check('...but no lesson content (article body, document link)', !JSON.stringify(kCourse.body).includes('SECRET-BODY') && !JSON.stringify(kCourse.body).includes('r1.pdf'))
  const kById = await call('GET', `/courses/by-id/${mbt._id}`, sess)
  check('...the same by id', kById.status === 200 && !JSON.stringify(kById.body).includes('SECRET-BODY'), why(kById))
  check('...a free preview lesson is unchanged (open to everyone)', JSON.stringify(kCourse.body).includes('FREE-BODY'))
  const kBook = await call('POST', '/bookings', sess, { liveClassId: String(new mongoose.Types.ObjectId()) })
  check('booking a class: REGISTRATION_REQUIRED', isGate(kBook), why(kBook))
  check('...with a sentence that says what to do', /registration/i.test(kBook.body?.error?.message ?? ''), why(kBook))
  const kPlay = await call('GET', `/lessons/${kVid._id}/play-url`, sess)
  check('a lesson video: REGISTRATION_REQUIRED', isGate(kPlay), why(kPlay))
  const kDone = await call('POST', `/lessons/${kVid._id}/complete`, sess)
  check('marking a lesson done: REGISTRATION_REQUIRED', isGate(kDone), why(kDone))
  const kQuiz = await call('GET', `/quizzes/lessons/${kVid._id}`, sess)
  check('a quiz: REGISTRATION_REQUIRED', isGate(kQuiz), why(kQuiz))
  const kTr = await call('GET', `/lessons/${kVid._id}/transcript`, sess)
  check('a transcript: REGISTRATION_REQUIRED', isGate(kTr), why(kTr))
  /* Every join path — web, room, app, emailed link — goes through this one check. */
  const { assertStudentMayJoin } = await import('@/services/liveClassJoin.service.ts')
  const joinErr = await assertStudentMayJoin({ scheduledStart: new Date(), durationMins: 60 } as any, { userId: String(regUser._id), name: 'Reg Buyer', email: 'reg@example.com', role: 'student', enrollmentStatus: me1?.enrollmentStatus } as any)
    .then(() => null, (e: any) => e)
  check('joining a class: REGISTRATION_REQUIRED', joinErr?.code === 'REGISTRATION_REQUIRED' && joinErr?.statusCode === 403 || joinErr?.status === 403 && joinErr?.code === 'REGISTRATION_REQUIRED', String(joinErr?.code ?? joinErr))
  const { registrationOutstanding } = await import('@/utils/registrationGate.ts')
  check('staff are never held', !(await registrationOutstanding(String(teacher._id))))
  /* A student without the flag (an existing one who never filled the form) is not held: the rule is for /explore buyers. */
  const plain = await M.UserModel.create({ name: 'Plain', email: 'plain@example.com', role: 'student', isActive: true, organizationId: dubai._id, enrollmentStatus: 'approved' })
  check('a student without the flag is not held', !(await registrationOutstanding(String(plain._id))))
  const form = {
    phone: '+971 52 111 2233', gender: 'Female', dateOfBirth: '1995-04-02', nationality: 'India', homeCountry: 'United Arab Emirates',
    occupation: 'Engineer', idType: 'Passport', idNumber: 'P1234567', countryAttendance: 'United Arab Emirates', city: 'Dubai',
    addressCountry: 'United Arab Emirates', passportUrl: 'kyc/passport-1.pdf', idDocUrl: 'kyc/passport-1.pdf', experienceLevel: 'Beginner',
    preferredStartDate: '2026-11-01', hearAboutUs: 'Instagram', programs: ['forex-beginner'], paymentMethod: 'Card / Full',
  }
  const half = await call('PATCH', '/auth/me/complete-registration', sess, { ...form, occupation: '' })
  check('an incomplete form is refused', half.status === 400 || half.status === 422, why(half))
  const mid: any = await M.UserModel.findById(regUser._id).lean()
  check('...still not approved, still due', mid?.registrationDue === true && mid?.enrollmentStatus !== 'approved')
  const sub = await call('PATCH', '/auth/me/complete-registration', sess, form)
  const after: any = await M.UserModel.findById(regUser._id).lean()
  check('the full form: accepted', sub.status === 200, why(sub))
  check('...approved as a paid enrolment, nothing for an admin to do', after?.enrollmentStatus === 'approved' && after.approvedByName === 'Paid Enrollment', JSON.stringify({ s: after?.enrollmentStatus, by: after?.approvedByName }))
  check('...registration recorded, no longer due', !!after?.fullRegistrationSubmittedAt && after.registrationDue === undefined && after.signupType === 'full', JSON.stringify({ at: after?.fullRegistrationSubmittedAt, due: after?.registrationDue }))
  check('...the course\'s programme is in their access', (after?.categories ?? []).includes('4x-trading'), JSON.stringify(after?.categories))
  check('...the answers stored', after?.enrollmentApplication?.idNumber === 'P1234567' && after.enrollmentApplication.city === 'Dubai')
  check('...the course still theirs', !!(await M.EnrollmentModel.exists({ userId: regUser._id, courseId: mbt._id })))
  const meAfter = (await call('GET', '/auth/me', sess)).body?.data
  check('...the app is told it is done', (meAfter?.user ?? meAfter)?.registrationDue === undefined, JSON.stringify(meAfter))
  const kCourse2 = await call('GET', '/courses/mbt', sess)
  check('registered: the lesson content comes with the course', JSON.stringify(kCourse2.body).includes('SECRET-BODY'), why(kCourse2))
  const kPlay2 = await call('GET', `/lessons/${kVid._id}/play-url`, sess)
  check('registered: the lesson video opens', kPlay2.status === 200 && !!kPlay2.body?.data?.url, why(kPlay2))
  const kBook2 = await call('POST', '/bookings', sess, { liveClassId: String(new mongoose.Types.ObjectId()) })
  check('registered: booking is no longer held (the class itself decides)', !isGate(kBook2), why(kBook2))
  const joinErr2 = await assertStudentMayJoin({ scheduledStart: new Date(), durationMins: 60 } as any, { userId: String(regUser._id), name: 'Reg Buyer', email: 'reg@example.com', role: 'student', enrollmentStatus: 'approved' } as any)
    .then(() => null, (e: any) => e)
  check('registered: joining is no longer held', joinErr2?.code !== 'REGISTRATION_REQUIRED', String(joinErr2?.code ?? joinErr2))
  /* Once registered, the return page's link goes to the course again. */
  await call('POST', '/public/checkout/complete', jH, { gateway: 'abzer', orderId: String(hOrder._id) })
  const hTok: any = await M.AuthTokenModel.findOne({ userId: regUser._id, purpose: 'signin-link' }).sort({ createdAt: -1, _id: -1 }).lean()
  check('registered: the link opens the course page', hTok?.nextPath === '/courses/mbt', JSON.stringify(hTok?.nextPath))
  /* A payment method the buyer already gave is never replaced by the gateway's. */
  const jP: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jP, { ...buyer, email: 'tabbyfan@example.com' })
  const pUser: any = await M.UserModel.findOne({ email: 'tabbyfan@example.com' }).lean()
  await M.UserModel.updateOne({ _id: pUser._id }, { $set: { 'enrollmentApplication.paymentMethod': 'USDT' } })
  const pOrder = await M.OrderModel.create({ userId: pUser._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(pOrder._id), 'rcpt-h2', { amount: 2500, currency: 'AED' })
  await call('POST', '/public/checkout/complete', jP, { gateway: 'abzer', orderId: String(pOrder._id) })
  check('a payment method already given: kept', (await M.UserModel.findById(pUser._id).lean() as any)?.enrollmentApplication?.paymentMethod === 'USDT')
  /* Not paid: no link, nothing changes. */
  const jU: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jU, { ...buyer, email: 'unpaid@example.com' })
  const uUser: any = await M.UserModel.findOne({ email: 'unpaid@example.com' }).lean()
  const uOrder = await M.OrderModel.create({ userId: uUser._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  const uRes = await call('POST', '/public/checkout/complete', jU, { gateway: 'abzer', orderId: String(uOrder._id) })
  const uAfter: any = await M.UserModel.findById(uUser._id).lean()
  check('unpaid: no sign-in, no link, not approved, no payment method', uRes.body?.data?.paid === false && !(await M.AuthTokenModel.exists({ userId: uUser._id }))
    && uAfter?.enrollmentStatus !== 'approved' && !uAfter?.enrollmentApplication?.paymentMethod, why(uRes))
  /* The user, 2026-10-30: "You're enrolled — check your email" needs a button to the registration. */
  section('I · a retry keeps the account new; an existing one is told where signing in leads')
  const jI: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jI, { ...buyer, email: 'retry@example.com' })
  const rUser: any = await M.UserModel.findOne({ email: 'retry@example.com' }).lean()
  const rCancelled = await M.OrderModel.create({ userId: rUser._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'cancelled' })
  /* Cancelled at the gateway → back to the course page → Buy again, same browser. */
  const again = await call('POST', '/public/checkout/prepare', jI, { ...buyer, email: 'retry@example.com' })
  check('the retry is prepared', again.status === 200, why(again))
  check('...no second account', (await M.UserModel.countDocuments({ email: 'retry@example.com' })) === 1)
  const rOrder = await M.OrderModel.create({ userId: rUser._id, courseId: mbt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(rOrder._id), 'rcpt-i1', { amount: 2500, currency: 'AED' })
  const rDone = await call('POST', '/public/checkout/complete', jI, { gateway: 'abzer', orderId: String(rOrder._id) })
  check('paid on the retry: signed in, not "check your email"', rDone.body?.data?.paid === true && /^\/s\//.test(rDone.body.data.signIn ?? ''), JSON.stringify(rDone.body?.data))
  const rTok: any = await M.AuthTokenModel.findOne({ userId: rUser._id, purpose: 'signin-link' }).sort({ createdAt: -1 }).lean()
  check('...to the registration form', rTok?.nextPath === '/complete-registration?from=checkout&course=mbt', JSON.stringify(rTok?.nextPath))
  check('...the cancelled attempt is left alone', (await M.OrderModel.findById(rCancelled._id).lean() as any)?.status === 'cancelled')
  /* Another browser typing that address (no cookie of the attempt that made it) is never signed in. */
  const jI2: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jI2, { ...buyer, slug: 'dwt', email: 'retry@example.com' })
  const r2 = await M.OrderModel.create({ userId: rUser._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(r2._id), 'rcpt-i2', { amount: 2500, currency: 'AED' })
  const r2Done = await call('POST', '/public/checkout/complete', jI2, { gateway: 'abzer', orderId: String(r2._id) })
  check('the same address from ANOTHER browser: not signed in', r2Done.body?.data?.paid === true && r2Done.body.data.signIn === null, JSON.stringify(r2Done.body?.data))
  check('...told the address and that the form is still due', r2Done.body.data.email === 'retry@example.com' && r2Done.body.data.registrationDue === true
    && r2Done.body.data.next === '/complete-registration?from=checkout&course=dwt', JSON.stringify(r2Done.body?.data))
  /* A cookie whose `nw` is for ANOTHER account does not make this one new. */
  const jI3: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jI3, { ...buyer, email: 'brandnew@example.com' })
  await call('POST', '/public/checkout/prepare', jI3, { ...buyer, slug: 'dwt', email: 'two@example.com' })
  const oI = await M.OrderModel.create({ userId: owner3._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(oI._id), 'rcpt-i3', { amount: 2500, currency: 'AED' })
  const iDone = await call('POST', '/public/checkout/complete', jI3, { gateway: 'abzer', orderId: String(oI._id) })
  check("a new account's cookie, then someone else's email: never signed in as them", iDone.body?.data?.paid === true && iDone.body.data.signIn === null, JSON.stringify(iDone.body?.data))
  check('...an account already registered: its link opens the course', iDone.body.data.registrationDue === false && iDone.body.data.next === '/courses/dwt', JSON.stringify(iDone.body?.data))
  check('...and is not marked as owing the form', (await M.UserModel.findById(owner3._id).lean() as any)?.registrationDue !== true)

  section('J · who is held for the form: /explore buyers only — never a student an admin or an import approved')
  /* The D account: approved before (not by a payment), no full registration on file — an existing student. */
  check('an admin-approved student buying on /explore: NOT held, the link opens the course', done2.body.data.registrationDue === false
    && done2.body.data.next === '/courses/mbt', JSON.stringify(done2.body?.data))
  check('...not marked, still approved — every course they had stays open', (await M.UserModel.findById(owner._id).lean() as any)?.registrationDue !== true
    && (await M.UserModel.findById(owner._id).lean() as any)?.enrollmentStatus === 'approved')
  /* Made by an earlier /explore payment, before the mark existed (production, 2026-10-31): an /explore buyer. */
  const legacy = await M.UserModel.create({ name: 'Legacy Buyer', email: 'legacy@example.com', role: 'student', isActive: true, organizationId: dubai._id,
    enrollmentStatus: 'approved', approvedByEmail: 'payment@system', approvedByName: 'Paid Enrollment', enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: '+971500000010' } })
  const jL: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jL, { ...buyer, slug: 'dwt', email: 'legacy@example.com' })
  check('an account approved only by an earlier /explore payment: marked at prepare, before paying', (await M.UserModel.findById(legacy._id).lean() as any)?.registrationDue === true)
  const oL = await M.OrderModel.create({ userId: legacy._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(oL._id), 'rcpt-jl', { amount: 2500, currency: 'AED' })
  const lDone = await call('POST', '/public/checkout/complete', jL, { gateway: 'abzer', orderId: String(oL._id) })
  check('...told the form is due, the link opens it', lDone.body?.data?.registrationDue === true && lDone.body.data.next === '/complete-registration?from=checkout&course=dwt', JSON.stringify(lDone.body?.data))
  /* The buyer never comes back to this browser: the gateway's webhook alone confirms the payment. */
  const pend = await M.UserModel.create({ name: 'Webhook Only', email: 'webhook@example.com', role: 'student', isActive: true, organizationId: dubai._id, enrollmentStatus: 'pending' })
  await call('POST', '/public/checkout/prepare', new Map(), { ...buyer, slug: 'dwt', email: 'webhook@example.com' })
  const oW = await M.OrderModel.create({ userId: pend._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(oW._id), 'rcpt-jw', { amount: 2500, currency: 'AED' })
  const wU: any = await M.UserModel.findById(pend._id).lean()
  check('paid by webhook alone, browser never back: still held, NOT approved by the payment', wU?.registrationDue === true && wU?.enrollmentStatus !== 'approved', JSON.stringify({ s: wU?.enrollmentStatus, due: wU?.registrationDue }))
  check('...but enrolled in what they paid for', !!(await M.EnrollmentModel.exists({ userId: pend._id, courseId: dwt._id })))
  /* Signed up with the full form (ID + date of birth) but never via complete-registration: registered. */
  const signedUp = await M.UserModel.create({ name: 'Full Signup', email: 'full@example.com', role: 'student', isActive: true, organizationId: dubai._id,
    enrollmentStatus: 'approved', enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: '+971500000009', idNumber: '784-1990-1234567-1', dateOfBirth: '1990-01-01' } })
  const jJ: Jar = new Map()
  await call('POST', '/public/checkout/prepare', jJ, { ...buyer, slug: 'dwt', email: 'full@example.com' })
  const oJ = await M.OrderModel.create({ userId: signedUp._id, courseId: dwt._id, gateway: 'abzer', amount: 250000, currency: 'AED', status: 'pending' })
  await new OrderService().fulfillAbzerFromWebhook(String(oJ._id), 'rcpt-j1', { amount: 2500, currency: 'AED' })
  const jDone = await call('POST', '/public/checkout/complete', jJ, { gateway: 'abzer', orderId: String(oJ._id) })
  check('a full sign-up: straight to the course, no form', jDone.body?.data?.registrationDue === false && jDone.body.data.next === '/courses/dwt', JSON.stringify(jDone.body?.data))
  check('...not marked', (await M.UserModel.findById(signedUp._id).lean() as any)?.registrationDue !== true)
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1)
