/* ─────────────────────────────────────────────────────────────
   Admin → Orders as a payment history (2026-10-27).
     A  search: student name / email, our order id, every gateway's reference
     B  search × filters × pagination
     C  academy isolation — a search never reaches another academy's orders
     D  who may ask, and what they may send (operator injection, regex, length)
     E  refund from Admin: Tamara and Tabby through their APIs, Abzer is manual
     F  a large ledger stays fast
   Gateways are stubbed at fetch; the app, HTTP and database are real.
   Usage (from backend/): bun --no-env-file src/tests/adminorders.suite.ts
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_adminorders'
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.JWT_ACCESS_SECRET  = 'adminorders-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'adminorders-refresh-secret-0123456789abcdef'
process.env.RATE_LIMIT_AUTH_MAX = '900'; process.env.RATE_LIMIT_API_MAX = '90000'
process.env.TAMARA_API_KEY = 'test-token'; process.env.TAMARA_BASE_URL = 'https://api-sandbox.tamara.co'
process.env.TAMARA_NOTIFICATION_TOKEN = 'test-notification'; process.env.TAMARA_CURRENCY = 'AED'
process.env.TABBY_SECRET_KEY = 'sk_test_adminorders'; process.env.TABBY_PUBLIC_KEY = 'pk_test_adminorders'
process.env.TABBY_MERCHANT_CODE = 'DeltaAE'; process.env.TABBY_CURRENCY = 'AED'
process.env.ENABLE_CRON = 'false'; process.env.CLIENT_URL = 'https://lms.test'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'ABZER_ACCESS_KEY', 'ABZER_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

/* ── gateway stub: Tamara + Tabby, as their refund paths read them ── */
const realFetch = globalThis.fetch
let gw: { host: string; method: string; path: string; body: any }[] = []
let tamaraOrders = new Map<string, any>(), tabbyPayments = new Map<string, any>()
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input))
  if (!['api-sandbox.tamara.co', 'api.tabby.ai'].includes(url.host)) return realFetch(input, init)
  const method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined
  gw.push({ host: url.host, method, path: url.pathname, body })
  const json = (status: number, b: unknown) => ({ ok: status < 300, status, headers: new Headers(), json: async () => b, text: async () => JSON.stringify(b) }) as any
  if (url.host === 'api-sandbox.tamara.co') {
    const m = url.pathname.match(/^\/orders\/([0-9a-f-]{36})$/)
    if (m && method === 'GET') return tamaraOrders.has(m[1]!) ? json(200, tamaraOrders.get(m[1]!)) : json(404, { message: 'Order is not found' })
    const r = url.pathname.match(/^\/payments\/simplified-refund\/([0-9a-f-]{36})$/)
    if (r) { const o = tamaraOrders.get(r[1]!); o.refunded_amount.amount += body.total_amount.amount; return json(200, { refund_id: 'rf-1', order_id: r[1] }) }
    return json(404, {})
  }
  const p = url.pathname.match(/^\/api\/v2\/payments\/([0-9a-f-]{36})(\/refunds)?$/)
  if (p && !p[2] && method === 'GET') return tabbyPayments.has(p[1]!) ? json(200, tabbyPayments.get(p[1]!)) : json(404, {})
  if (p && p[2]) { const t = tabbyPayments.get(p[1]!); t.refunds.push({ amount: body.amount }); return json(200, t) }
  return json(404, {})
}) as any

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_adminorders') { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
type Jar = Map<string, string>
async function call(method: string, path: string, jar?: Jar, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (jar?.size) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await realFetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const i = pair!.indexOf('='); if (i > 0 && jar) jar.set(pair!.slice(0, i), pair!.slice(i + 1)) }
  let parsed: any = null; try { parsed = await res.json() } catch { /* empty */ }
  return { status: res.status, body: parsed }
}
const list = (jar: Jar, params: Record<string, string | number>) =>
  call('GET', `/admin/orders?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`, jar)
const n = (r: { body: any }) => r.body?.meta?.total_count as number | undefined

let uuidN = 0
const uuid = () => `0a2a00af-9f26-47ba-819f-${(++uuidN).toString(16).padStart(12, '0')}`

try {
  const PW = 'CorrectHorse1', hash = await hashPassword(PW)
  const dubai = await M.OrganizationModel.create({ name: 'Delta Dubai', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' } as any)
  const blr   = await M.OrganizationModel.create({ name: 'Delta Bangalore', slug: 'bangalore', currency: 'INR', paymentGateway: 'abzer' } as any)
  const mkUser = (o: Record<string, unknown>) => M.UserModel.create({ passwordHash: hash, isActive: true, isVerified: true, ...o } as any)
  const root   = await mkUser({ name: 'Root', email: 'root@ao.local', role: 'super_admin' })
  const dAdmin = await mkUser({ name: 'Dubai Admin', email: 'dadmin@ao.local', role: 'admin', organizationId: dubai._id })
  const bAdmin = await mkUser({ name: 'Bangalore Admin', email: 'badmin@ao.local', role: 'admin', organizationId: blr._id })
  const teacher = await mkUser({ name: 'Teacher', email: 'teacher@ao.local', role: 'instructor', organizationId: dubai._id })
  const student = await mkUser({ name: 'Plain Student', email: 'student@ao.local', role: 'student', organizationId: dubai._id, enrollmentStatus: 'approved' })
  const course  = await M.CourseModel.create({ title: 'UI/UX Design Mastery', slug: 'uiux', description: 'd', instructorId: teacher._id, price: 50, priceAED: 183.46, status: 'published', organizationId: dubai._id })
  const bCourse = await M.CourseModel.create({ title: 'Forex Basics', slug: 'fx', description: 'd', instructorId: teacher._id, price: 4000, status: 'published', organizationId: blr._id })

  const login = async (e: string, path = '/admin/auth/login'): Promise<Jar> => {
    const jar: Jar = new Map(); const r = await call('POST', path, jar, { email: e, password: PW })
    if (r.status !== 200) throw new Error(`login ${e}: ${r.status} ${JSON.stringify(r.body)}`)
    return jar
  }
  const rootJar = await login(root.email), dJar = await login(dAdmin.email), bJar = await login(bAdmin.email)

  /* Buyers and their orders — one of each gateway with its own reference. */
  const mkBuyer = (name: string, mail: string, org = dubai) => mkUser({ name, email: mail, role: 'student', organizationId: org._id, enrollmentStatus: 'approved' })
  const aisha  = await mkBuyer('Aisha Al Mansoori', 'aisha.mansoori@gmail.com')
  const omar   = await mkBuyer('Omar Haddad', 'omar.h@outlook.com')
  const arabic = await mkBuyer('مُحَمَّد العتيبي', 'mohammed.otaibi@ao.local')
  const priya  = await mkBuyer('Priya Nair', 'priya.nair@ao.local', blr)
  const mkOrder = (o: Record<string, unknown>) => M.OrderModel.create({ courseId: course._id, organizationId: dubai._id, currency: 'AED', amount: 18346, status: 'paid', ...o } as any)
  const tamId = uuid(), tabId = uuid(), abzReq = uuid(), abzRcpt = uuid()
  const oTamara = await mkOrder({ userId: aisha._id, gateway: 'tamara', tamaraOrderId: tamId })
  const oTabby  = await mkOrder({ userId: omar._id,  gateway: 'tabby',  tabbyPaymentId: tabId })
  const oAbzer  = await mkOrder({ userId: aisha._id, gateway: 'abzer',  abzerOrderId: abzReq, abzerPaymentId: abzRcpt })
  const oRzp    = await mkOrder({ userId: priya._id, gateway: 'razorpay', courseId: bCourse._id, organizationId: blr._id, currency: 'INR', amount: 400000, razorpayPaymentId: 'pay_ABCdef123', razorpayOrderId: 'order_XYZ789' })
  const oStripe = await mkOrder({ userId: omar._id,  gateway: 'stripe', stripePaymentIntentId: 'pi_3Q9zStripe' , currency: 'USD', amount: 4999 })
  const oArabic = await mkOrder({ userId: arabic._id, gateway: 'abzer', status: 'pending', abzerOrderId: uuid() })
  /* 25 orders for one buyer — pagination with a search. */
  const bulk = await mkBuyer('Bulk Buyer', 'bulk.buyer@ao.local')
  for (let i = 0; i < 25; i++) await mkOrder({ userId: bulk._id, gateway: 'tamara', status: i % 5 === 0 ? 'pending' : 'paid', tamaraOrderId: uuid(), createdAt: new Date(Date.now() - i * 60_000) })

  /* ─────────────────────────────────────────────────────── */
  section('A · search finds the right order — every kind of reference')
  {
    const one = async (label: string, q: string, expectId: string, jar = rootJar) => {
      const r = await list(jar, { q })
      check(`${label} → exactly that order`, r.status === 200 && n(r) === 1 && r.body.data[0]?.id === expectId, `${r.status} n=${n(r)} first=${r.body?.data?.[0]?.id}`)
    }
    await one('Tamara order id', tamId, String(oTamara._id))
    await one('Tabby payment id', tabId, String(oTabby._id))
    await one('BillXPro request id', abzReq, String(oAbzer._id))
    await one('BillXPro receipt id', abzRcpt, String(oAbzer._id))
    await one('Razorpay payment id', 'pay_ABCdef123', String(oRzp._id))
    await one('Razorpay order id', 'order_XYZ789', String(oRzp._id))
    await one('Stripe payment intent', 'pi_3Q9zStripe', String(oStripe._id))
    await one('our own order id', String(oTabby._id), String(oTabby._id))
    await one('Arabic name', 'العتيبي', String(oArabic._id))
    const ai = await list(rootJar, { q: 'aisha' })
    check('a name finds all that student’s orders (2)', n(ai) === 2 && ai.body.data.every((o: any) => o.userId?.email === 'aisha.mansoori@gmail.com'), `n=${n(ai)}`)
    check('…case does not matter (AISHA)', n(await list(rootJar, { q: 'AISHA' })) === 2)
    check('…part of an email works (mansoori@gm)', n(await list(rootJar, { q: 'mansoori@gm' })) === 2)
    check('…surrounding spaces are ignored', n(await list(rootJar, { q: '   aisha   ' })) === 2)
    check('a gateway reference must be whole — a fragment finds nothing', n(await list(rootJar, { q: tamId.slice(0, 18) })) === 0)
    check('no match → an empty page, not an error', (await list(rootJar, { q: 'nobody-by-this-name' })).status === 200 && n(await list(rootJar, { q: 'nobody-by-this-name' })) === 0)
    const all = await list(rootJar, {})
    check('an empty search lists everything (31)', n(all) === 31, `n=${n(all)}`)
    const each = all.body.data[0]
    check('each row carries the student, course and the gateway references', !!each?.userId?.email && !!each?.courseId?.title && 'createdAt' in each)
    const tRow = (await list(rootJar, { q: tamId })).body.data[0]
    check('…a Tamara row carries tamaraOrderId (the Reference column)', tRow?.tamaraOrderId === tamId)
    const aRow = (await list(rootJar, { q: abzRcpt })).body.data[0]
    check('…an Abzer row carries both the BillXPro request and receipt', aRow?.abzerOrderId === abzReq && aRow?.abzerPaymentId === abzRcpt)
  }

  /* ─────────────────────────────────────────────────────── */
  section('B · search × filters × pagination')
  {
    check('Aisha + gateway=abzer → 1', n(await list(rootJar, { q: 'aisha', gateway: 'abzer' })) === 1)
    check('Aisha + gateway=tabby → 0', n(await list(rootJar, { q: 'aisha', gateway: 'tabby' })) === 0)
    check('Bulk Buyer + status=pending → 5', n(await list(rootJar, { q: 'bulk', status: 'pending' })) === 5)
    const p1 = await list(rootJar, { q: 'bulk', page: 1, per_page: 20 }), p2 = await list(rootJar, { q: 'bulk', page: 2, per_page: 20 })
    check('25 matches: page 1 has 20, page 2 has 5', p1.body.data.length === 20 && p2.body.data.length === 5 && n(p1) === 25)
    check('…pages do not overlap', new Set([...p1.body.data, ...p2.body.data].map((o: any) => o.id)).size === 25)
    check('…newest first', new Date(p1.body.data[0].createdAt) >= new Date(p1.body.data[19].createdAt))
    check('…the meta says so (pages, has_next)', p1.body.meta.total_pages === 2 && p1.body.meta.has_next === true && p2.body.meta.has_next === false)
  }

  /* ─────────────────────────────────────────────────────── */
  section('C · academy isolation — a search never crosses academies')
  {
    check('Dubai admin, searching a Bangalore student by name → nothing', n(await list(dJar, { q: 'priya' })) === 0)
    check('…by the Razorpay reference → nothing', n(await list(dJar, { q: 'pay_ABCdef123' })) === 0)
    check('…by the Bangalore order id → nothing', n(await list(dJar, { q: String(oRzp._id) })) === 0)
    check('Bangalore admin finds their own student', n(await list(bJar, { q: 'priya' })) === 1)
    check('Bangalore admin cannot find Dubai orders by Tamara id', n(await list(bJar, { q: tamId })) === 0)
    check('Bangalore admin’s whole list holds only Bangalore orders', (await list(bJar, {})).body.data.every((o: any) => String(o.organizationId) === String(blr._id)))
    check('super admin sees both academies', n(await list(rootJar, { q: 'priya' })) === 1 && n(await list(rootJar, { q: 'aisha' })) === 2)
  }

  /* ─────────────────────────────────────────────────────── */
  section('D · who may ask, and what they may send')
  {
    check('no session → 401', (await call('GET', '/admin/orders')).status === 401)
    const sJar = await login(student.email, '/auth/login').catch(() => new Map() as Jar)
    const asStudent = await call('GET', '/admin/orders', sJar)
    check('a student session → refused', asStudent.status === 401 || asStudent.status === 403, String(asStudent.status))
    const weird = ['(', '.*', '[', '\\', '$where', '^', 'a|b', '.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+.+$', '{"$ne":null}', "'; DROP TABLE orders; --", '%00']
    const res = await Promise.all(weird.map(q => list(rootJar, { q })))
    check(`${weird.length} hostile / regex-shaped searches: no server error`, res.every(r => r.status === 200), res.map(r => r.status).join(','))
    check('…and none of them matches everything', res.every(r => (n(r) ?? 99) < 31), res.map(r => n(r)).join(','))
    const op = await call('GET', '/admin/orders?q[$ne]=x', rootJar)
    /* validate() answers 422 VALIDATION_ERROR across this API. */
    check('operator injection (q[$ne]=x) is refused (422), not run', op.status === 422 && op.body?.error?.code === 'VALIDATION_ERROR', `${op.status} n=${n(op)}`)
    const arr = await call('GET', '/admin/orders?q=a&q=b', rootJar)
    check('an array for q is refused (422)', arr.status === 422, String(arr.status))
    check('121 characters → 422', (await list(rootJar, { q: 'x'.repeat(121) })).status === 422)
    check('120 characters → fine', (await list(rootJar, { q: 'x'.repeat(120) })).status === 200)
    check('an unknown gateway → 422 (not "no orders")', (await list(rootJar, { gateway: 'paypal' })).status === 422)
  }

  /* ─────────────────────────────────────────────────────── */
  section('E · refund from Admin')
  {
    /* Tamara: captured in full → simplified-refund for the full amount. */
    tamaraOrders.set(tamId, { order_id: tamId, order_reference_id: String(oTamara._id), status: 'fully_captured',
      total_amount: { amount: 183.46, currency: 'AED' }, captured_amount: { amount: 183.46, currency: 'AED' }, refunded_amount: { amount: 0, currency: 'AED' } })
    gw = []
    const rt = await call('POST', `/admin/orders/${oTamara._id}/refund`, rootJar)
    const tCall = gw.find(c => c.path.startsWith('/payments/simplified-refund/'))
    check('Tamara: refund succeeds', rt.status === 200, `${rt.status} ${JSON.stringify(rt.body?.error)}`)
    check('…Tamara was asked to refund AED 183.46 for that order', tCall?.path.endsWith(tamId) && tCall?.body?.total_amount?.amount === 183.46, JSON.stringify(tCall?.body))
    const tAfter: any = await M.OrderModel.findById(oTamara._id).lean()
    check('…the order reads refunded, with the time', tAfter?.status === 'refunded' && !!tAfter?.refundedAt)
    const again = await call('POST', `/admin/orders/${oTamara._id}/refund`, rootJar)
    check('…a second refund is refused (not paid any more)', again.status === 400, String(again.status))

    /* Tabby: captured → refunds endpoint. */
    tabbyPayments.set(tabId, { id: tabId, status: 'CLOSED', amount: '183.46', currency: 'AED', captures: [{ id: 'c1', amount: '183.46' }], refunds: [] })
    gw = []
    const rb = await call('POST', `/admin/orders/${oTabby._id}/refund`, rootJar)
    check('Tabby: refund succeeds', rb.status === 200, `${rb.status} ${JSON.stringify(rb.body?.error)}`)
    check('…Tabby was asked to refund 183.46', gw.some(c => c.path.endsWith(`/payments/${tabId}/refunds`) && Number(c.body?.amount) === 183.46), JSON.stringify(gw.map(c => [c.method, c.path, c.body?.amount])))
    check('…the order reads refunded', (await M.OrderModel.findById(oTabby._id).lean() as any)?.status === 'refunded')

    /* Abzer: BillXPro has no refund API. */
    const ra = await call('POST', `/admin/orders/${oAbzer._id}/refund`, rootJar)
    check('Abzer: refused with MANUAL_REFUND_REQUIRED (refund in BillXPro)', ra.status === 422 && ra.body?.error?.code === 'MANUAL_REFUND_REQUIRED', `${ra.status} ${ra.body?.error?.code}`)
    check('…and the order stays paid', (await M.OrderModel.findById(oAbzer._id).lean() as any)?.status === 'paid')

    const pend = await call('POST', `/admin/orders/${oArabic._id}/refund`, rootJar)
    check('a pending order cannot be refunded', pend.status === 400, String(pend.status))
    const cross = await call('POST', `/admin/orders/${oRzp._id}/refund`, dJar)
    check('Dubai admin cannot refund a Bangalore order', cross.status === 403 || cross.status === 404, String(cross.status))
    check('…which stays paid', (await M.OrderModel.findById(oRzp._id).lean() as any)?.status === 'paid')
    const bad = await call('POST', '/admin/orders/not-an-id/refund', rootJar)
    check('a malformed id → 400', bad.status === 400)
    const missing = await call('POST', `/admin/orders/${new mongoose.Types.ObjectId()}/refund`, rootJar)
    check('an unknown order → 404', missing.status === 404, String(missing.status))
    check('the refunded Tamara order is still findable by its reference', (await list(rootJar, { q: tamId, status: 'refunded' })).body?.data?.[0]?.id === String(oTamara._id))
  }

  /* ─────────────────────────────────────────────────────── */
  section('F · a large ledger stays fast')
  {
    const big = await mkBuyer('Volume Buyer', 'volume@ao.local')
    const docs = [...Array(3000)].map((_, i) => ({ userId: i % 3 ? big._id : aisha._id, courseId: course._id, organizationId: dubai._id, gateway: 'tamara', status: 'paid', amount: 18346, currency: 'AED', tamaraOrderId: uuid(), createdAt: new Date(Date.now() - i * 1000), updatedAt: new Date() }))
    await mongoose.connection.db!.collection('orders').insertMany(docs)
    const t0 = Date.now(); const r = await list(dJar, { q: 'volume' }); const ms = Date.now() - t0
    check(`3,000 more orders: a name search answers in ${ms} ms (< 1500)`, r.status === 200 && n(r) === 2000 && ms < 1500, `n=${n(r)} ${ms}ms`)
    const t1 = Date.now(); const r2 = await list(dJar, { q: docs[1234]!.tamaraOrderId }); const ms2 = Date.now() - t1
    check(`…a reference search answers in ${ms2} ms (< 1500)`, n(r2) === 1 && ms2 < 1500)
    const burst = await Promise.all([...Array(20)].map((_, i) => list(dJar, { q: i % 2 ? 'volume' : 'aisha', page: 1 + (i % 3) })))
    check('20 searches at once: all answer', burst.every(x => x.status === 200), burst.map(x => x.status).join(','))
  }
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  globalThis.fetch = realFetch
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
