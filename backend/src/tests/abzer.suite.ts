/* ─────────────────────────────────────────────────────────────
   Abzer (BillXPro) — client, verified fulfilment, webhook, sweep.
   Abzer's API is stubbed at fetch; the database and the HTTP app are real.
     A  client: token cache, refresh on a rejected token, create body, lookup
     B  webhook bodies: object, array, string, form fields, junk
     C  verified fulfilment against Abzer's own record (and every way it refuses)
     D  the webhook route: secret header, batch, forged receipt, Abzer unreachable
     E  WH_REFUND keeps the order in step — and a refund is never undone
     F  the return check reports failed; the sweep window
   Usage (from backend/): bun --no-env-file src/tests/abzer.suite.ts
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'; process.env.PORT = '0'
process.env.DATABASE_URL = process.env.ABZER_SUITE_DB_URL || 'mongodb://localhost:27017/lms_abzer_suite'
process.env.JWT_ACCESS_SECRET  = 'abzer-suite-access-secret-0123456789abcdef'
process.env.JWT_REFRESH_SECRET = 'abzer-suite-refresh-secret-0123456789abcdef'
process.env.ABZER_ACCESS_KEY = 'test-access'; process.env.ABZER_SECRET_KEY = 'test-secret'; process.env.ABZER_CURRENCY = 'AED'
process.env.ABZER_BASE_URL = 'https://abzer.test/as/api/v100'
process.env.ABZER_WEBHOOK_SECRET = 'abzer-webhook-secret-test'
process.env.ABZER_TEMPLATE_CODE = 'paymentlink-mail-template'
process.env.CLIENT_URL = 'https://lms.test'; process.env.ENABLE_CRON = 'false'
process.env.RATE_LIMIT_API_MAX = '9000'; process.env.EMAIL_OUTBOX = 'off'
/* Set, even to empty: app.ts loads dotenv, which fills any UNSET key from backend/.env. */
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_BACKUP_HOST', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID',
  'VAPID_PUBLIC_KEY', 'TABBY_SECRET_KEY', 'TABBY_PUBLIC_KEY', 'TABBY_MERCHANT_CODE', 'TAMARA_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

/* ── Abzer stub: only abzer.test is intercepted; our own app is called for real ── */
interface Call { path: string; method: string; body: any; auth?: string; signal: boolean }
const realFetch = globalThis.fetch
let calls: Call[] = []
let route: (path: string, method: string, body: any, auth?: string) => { status: number; body: any } = () => ({ status: 200, body: {} })
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input)
  if (!url.startsWith('https://abzer.test')) return realFetch(input, init)
  const path = url.replace('https://abzer.test/as/api/v100', '')
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(init.body) : undefined
  const auth = init.headers?.Authorization
  calls.push({ path, method, body, auth, signal: init.signal instanceof AbortSignal })
  const r = route(path, method, body, auth)
  if (r.status === -1) throw new TypeError('fetch failed')
  const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, json: async () => JSON.parse(text) } as any
}) as any

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const M = await import('@/models/schema.ts')
const { OrderService } = await import('@/services/order.service.ts')
const { AbzerService, resetAbzerTokenCache, setAbzerConflictDelay } = await import('@/services/abzer.service.ts')
setAbzerConflictDelay(() => 0)
const { runAbzerSweep } = await import('@/jobs/abzerSweep.job.ts')
await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_abzer_suite' && !process.env.ABZER_SUITE_DB_URL) { console.error('REFUSING TO RUN'); process.exit(1) }
await mongoose.connection.db!.dropDatabase()
const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const HOOK = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/webhooks/abzer`
const hook = (body: unknown, secret: string | null = process.env.ABZER_WEBHOOK_SECRET!, form = false) => realFetch(HOOK, {
  method: 'POST',
  headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...(secret !== null && { 'x-abzer-secret': secret }) },
  body: form ? new URLSearchParams(body as Record<string, string>).toString() : typeof body === 'string' ? body : JSON.stringify(body),
})
const settle = () => new Promise(r => setTimeout(r, 300))

/* Abzer ids are UUIDs */
let n = 0
const uuid = () => `0a2a00af-9f26-17ba-819f-${(++n).toString(16).padStart(12, '0')}`
/* Abzer's record of a request, shaped as the sandbox returns it (2026-10-26). */
const record = (id: string, ref: string, status: 'CR_REQUESTED' | 'CR_PAID' | 'CR_FAILED', amount = 2500, currency = 'AED', receipt = true) => ({
  id, referenceNumber: ref, amount, currency: { code: currency, name: 'x' }, status: { code: status, name: status },
  ...(status === 'CR_PAID' && receipt && { receiptId: `rc-${id.slice(-4)}`, receiptNumber: 'DI2026', authCode: 'AB0012', payReferenceNo: 'p-1' }),
})
/* Abzer as a table: request id → record (or a status code to answer with). */
let remote = new Map<string, any>()
const AUTH_OK = { status: 200, body: { accessKey: 'test-access', token: 'tok-1' } }
const defaultRoute = (path: string, method: string) => {
  if (path === '/authenticate') return AUTH_OK
  const m = path.match(/^\/direct-payment-request\/([^/]+)$/)
  if (m && method === 'GET') {
    const r = remote.get(m[1]!)
    if (r === undefined) return { status: 404, body: { title: 'Not Found' } }
    if (typeof r === 'number') return { status: r, body: { title: 'x' } }
    return { status: 200, body: r }
  }
  return { status: 404, body: {} }
}

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', paymentGateway: 'abzer', currency: 'AED' } as any)
  const teacher = await M.UserModel.create({ name: 'Teacher', email: 'teacher@abz.local', role: 'instructor', isActive: true, isVerified: true, organizationId: org._id } as any)
  const course = await M.CourseModel.create({ instructorId: teacher._id, title: 'Forex Foundations', slug: 'ff-abzer', description: 'x', price: 2500, priceAED: 2500, status: 'published', organizationId: org._id })
  let s = 0
  const mkStudent = () => M.UserModel.create({ name: `Student ${++s}`, email: `s${s}@abz.local`, role: 'student', isActive: true, isVerified: true, enrollmentStatus: 'pending', organizationId: org._id } as any)
  const mkOrder = async (opts: { requestId?: string | null; status?: string; ageMs?: number; gateway?: string; amount?: number } = {}) => {
    const u = await mkStudent()
    const at = new Date(Date.now() - (opts.ageMs ?? 10 * 60_000))
    const { insertedId } = await mongoose.connection.db!.collection('orders').insertOne({
      userId: u._id, courseId: course._id, organizationId: org._id, gateway: opts.gateway ?? 'abzer', status: opts.status ?? 'pending',
      amount: opts.amount ?? 250_000, currency: 'AED', ...(opts.requestId !== null && { abzerOrderId: opts.requestId ?? uuid() }), createdAt: at, updatedAt: at,
    })
    const o: any = await M.OrderModel.findById(insertedId).lean()
    return { id: String(insertedId), requestId: o.abzerOrderId as string, userId: u._id }
  }
  const statusOf = async (id: string) => ((await M.OrderModel.findById(id).lean()) as any)?.status
  const enrolled = async (userId: unknown) => !!(await M.EnrollmentModel.exists({ userId, courseId: course._id }))
  const svc = new OrderService()

  /* ─────────────────────────────────────────────────────── */
  section('A · client — token, create, lookup')
  {
    resetAbzerTokenCache(); calls = []
    route = (path, method) => {
      if (path === '/direct-payment-request/extended') return { status: 201, body: { id: '0a2a0036-a163-1a5c-81a1-776675551891', referenceNumber: 'x' } }
      if (path.endsWith('/link-generate')) return { status: 200, body: { mailLink: 'https://sandbox.billxpro.com/pay/pu/abc', isLinkExpired: false } }
      return defaultRoute(path, method)
    }
    const abz = new AbzerService()
    const r1 = await abz.createOrder({ amountAED: 2268.0049, orderId: 'ord-1', courseTitle: 'C', buyerEmail: 'b@x.ae', buyerName: '  Mary  Ann  Lee ', buyerPhone: '+971501234567', returnUrl: 'https://lms.test/explore/checkout/return?gateway=abzer&orderId=ord-1' })
    const create = calls.find(c => c.path === '/direct-payment-request/extended')
    check('a payment link comes back', r1.checkoutUrl === 'https://sandbox.billxpro.com/pay/pu/abc' && r1.abzerRequestId === '0a2a0036-a163-1a5c-81a1-776675551891')
    check('referenceNumber is our order id', create?.body?.referenceNumber === 'ord-1')
    check('amount is a 2-decimal double', create?.body?.amount === 2268, String(create?.body?.amount))
    check('first / last name split', create?.body?.firstName === 'Mary' && create?.body?.lastName === 'Ann Lee')
    check('template code from the env', create?.body?.templateConfiguration?.code === 'paymentlink-mail-template')
    check('Bearer token on API calls', create?.auth === 'Bearer tok-1')
    check('every call carries a timeout signal', calls.every(c => c.signal))
    await abz.createOrder({ amountAED: 10, orderId: 'ord-2', courseTitle: 'C', buyerEmail: 'b@x.ae', buyerName: 'Solo' })
    check('the token is cached — one login for two checkouts', calls.filter(c => c.path === '/authenticate').length === 1)
    check('a one-word name is used for both names', calls.filter(c => c.path === '/direct-payment-request/extended')[1]?.body?.lastName === 'Solo')

    /* The sandbox answers an expired token with 403 "Token expired" (the docs say 401). */
    resetAbzerTokenCache(); calls = []
    let logins = 0
    route = (path, method, _b, auth) => {
      if (path === '/authenticate') return { status: 200, body: { accessKey: 'a', token: `tok-${++logins}` } }
      if (auth === 'Bearer tok-1') return { status: 403, body: { title: 'Forbidden', detail: 'Authentication failed. Token expired.' } }
      remote.set('0a2a0036-a163-1a5c-81a1-000000000001', record('0a2a0036-a163-1a5c-81a1-000000000001', 'ord-3', 'CR_PAID'))
      return defaultRoute(path, method)
    }
    const got = await abz.getPaymentRequest('0a2a0036-a163-1a5c-81a1-000000000001')
    check('an expired token is refreshed and the call made again', got.status === 'CR_PAID' && logins === 2, `logins=${logins}`)
    check('lookup normalised: amount, currency, reference, receipt', got.amount === 2500 && got.currency === 'AED' && got.referenceNumber === 'ord-3' && !!got.receiptId)

    resetAbzerTokenCache(); logins = 0
    route = (path) => path === '/authenticate' ? { status: 200, body: { token: `t${++logins}` } } : { status: 403, body: { detail: 'Token expired' } }
    let threw = false; try { await abz.getPaymentRequest('0a2a0036-a163-1a5c-81a1-000000000001') } catch { threw = true }
    check('a token rejected twice is an error, not a loop', threw && logins === 2, `logins=${logins}`)

    resetAbzerTokenCache(); calls = []
    route = defaultRoute
    threw = false; try { await abz.getPaymentRequest('../receipts') } catch { threw = true }
    check('a non-UUID id never reaches a URL', threw && calls.length === 0)
    route = (path) => path === '/authenticate' ? { status: 401, body: { title: 'bad creds' } } : { status: 200, body: {} }
    resetAbzerTokenCache(); threw = false; try { await abz.getPaymentRequest('0a2a0036-a163-1a5c-81a1-000000000001') } catch { threw = true }
    check('wrong credentials: an error', threw)

    resetAbzerTokenCache()
    route = (path, method) => path === '/direct-payment-request/extended' ? { status: 201, body: { id: 'not-a-uuid' } } : defaultRoute(path, method)
    threw = false; try { await abz.createOrder({ amountAED: 1, orderId: 'o', courseTitle: 'C', buyerEmail: 'e', buyerName: 'n' }) } catch { threw = true }
    check('a create answer without a UUID is refused', threw)
    route = (path, method) => path === '/direct-payment-request/extended' ? { status: 201, body: { id: '0a2a0036-a163-1a5c-81a1-776675551891' } }
      : path.endsWith('/link-generate') ? { status: 200, body: { mailLink: 'https://x', isLinkExpired: true } } : defaultRoute(path, method)
    threw = false; try { await abz.createOrder({ amountAED: 1, orderId: 'o', courseTitle: 'C', buyerEmail: 'e', buyerName: 'n' }) } catch { threw = true }
    check('an expired link is refused', threw)

    /* Abzer's customer-code collision: 409 "conflicts with existing data", nothing created. */
    resetAbzerTokenCache(); calls = []
    let creates = 0
    route = (path, method) => {
      if (path === '/direct-payment-request/extended') return ++creates <= 2
        ? { status: 409, body: { title: 'Conflict', detail: 'The request conflicts with existing data' } }
        : { status: 201, body: { id: '0a2a0036-a163-1a5c-81a1-776675551899' } }
      if (path.endsWith('/link-generate')) return { status: 200, body: { mailLink: 'https://sandbox.billxpro.com/pay/pu/z', isLinkExpired: false } }
      return defaultRoute(path, method)
    }
    const retried = await abz.createOrder({ amountAED: 1, orderId: 'ord-409', courseTitle: 'C', buyerEmail: 'e@x.ae', buyerName: 'n' })
    check('a 409 conflict is asked again — succeeds on the third try', retried.abzerRequestId.endsWith('1899') && creates === 3, `creates=${creates}`)
    check('...the same body every time (same order reference)', calls.filter(c => c.path === '/direct-payment-request/extended').every(c => c.body?.referenceNumber === 'ord-409'))
    creates = -100
    threw = false; try { await abz.createOrder({ amountAED: 1, orderId: 'ord-409b', courseTitle: 'C', buyerEmail: 'e@x.ae', buyerName: 'n' }) } catch { threw = true }
    check('a conflict that does not clear: an error after six tries', threw && creates === -94, `creates=${creates}`)
    creates = 0
    route = (path, method) => path === '/direct-payment-request/extended' ? (++creates, { status: 422, body: { title: 'bad' } }) : defaultRoute(path, method)
    threw = false; try { await abz.createOrder({ amountAED: 1, orderId: 'o', courseTitle: 'C', buyerEmail: 'e', buyerName: 'n' }) } catch { threw = true }
    check('any other refusal (422) is not retried', threw && creates === 1, `creates=${creates}`)
  }

  /* ─────────────────────────────────────────────────────── */
  section('B · webhook bodies')
  {
    const ev = AbzerService.webhookEvents
    check('one JSON object', ev({ type: 'WH_RECEIPT_POSTING' }).length === 1)
    check('a JSON array (one payment, several invoices)', ev([{ type: 'a' }, { type: 'b' }, null, 7]).length === 2)
    check('a JSON string and a Buffer', ev('[{"type":"a"}]').length === 1 && ev(Buffer.from('{"type":"a"}')).length === 1)
    check('junk: nothing', ev('not json').length === 0 && ev(null).length === 0 && ev(42).length === 0)
  }

  /* ─────────────────────────────────────────────────────── */
  section('C · verified fulfilment — Abzer\'s record decides')
  {
    route = defaultRoute; resetAbzerTokenCache()
    const paid = await mkOrder(); remote.set(paid.requestId, record(paid.requestId, paid.id, 'CR_PAID'))
    check('CR_PAID, our reference, exact amount → fulfilled', await svc.fulfillAbzerVerified(paid.id) === 'fulfilled')
    check('...paid, enrolled, receipt stored', await statusOf(paid.id) === 'paid' && await enrolled(paid.userId)
      && ((await M.OrderModel.findById(paid.id).lean()) as any)?.abzerPaymentId === `rc-${paid.requestId.slice(-4)}`)
    check('...the account is approved by the payment', ((await M.UserModel.findById(paid.userId).lean()) as any)?.enrollmentStatus === 'approved')
    check('asked again → already-fulfilled', await svc.fulfillAbzerVerified(paid.id) === 'already-fulfilled')

    const race = await mkOrder(); remote.set(race.requestId, record(race.requestId, race.id, 'CR_PAID'))
    const outs = await Promise.all([...Array(6)].map(() => svc.fulfillAbzerVerified(race.id)))
    check('six at once: exactly one fulfils', outs.filter(o => o === 'fulfilled').length === 1, outs.join(','))
    check('...one enrolment', (await M.EnrollmentModel.countDocuments({ userId: race.userId, courseId: course._id })) === 1)

    const failed = await mkOrder(); remote.set(failed.requestId, record(failed.requestId, failed.id, 'CR_FAILED'))
    check('CR_FAILED → failed, order left pending (the link can be paid again)', await svc.fulfillAbzerVerified(failed.id) === 'failed' && await statusOf(failed.id) === 'pending')
    remote.set(failed.requestId, record(failed.requestId, failed.id, 'CR_PAID'))
    check('...and a later successful attempt still fulfils', await svc.fulfillAbzerVerified(failed.id) === 'fulfilled')

    const open = await mkOrder(); remote.set(open.requestId, record(open.requestId, open.id, 'CR_REQUESTED'))
    check('CR_REQUESTED → not-paid', await svc.fulfillAbzerVerified(open.id) === 'not-paid' && await statusOf(open.id) === 'pending')

    const odd = await mkOrder(); remote.set(odd.requestId, { ...record(odd.requestId, odd.id, 'CR_PAID'), status: { code: 'CR_SOMETHING_NEW' } })
    check('an unknown status is not paid', await svc.fulfillAbzerVerified(odd.id) === 'not-paid')

    const other = await mkOrder(); remote.set(other.requestId, record(other.requestId, String(new mongoose.Types.ObjectId()), 'CR_PAID'))
    check('a paid request for ANOTHER order is refused', await svc.fulfillAbzerVerified(other.id) === 'ignored' && await statusOf(other.id) === 'pending')

    const swapped = await mkOrder(); remote.set(swapped.requestId, record(uuid(), swapped.id, 'CR_PAID'))
    check('a record whose id is not the one we stored is refused', await svc.fulfillAbzerVerified(swapped.id) === 'ignored')

    const short = await mkOrder(); remote.set(short.requestId, record(short.requestId, short.id, 'CR_PAID', 25))
    check('paid less than the order → refused', await svc.fulfillAbzerVerified(short.id) === 'ignored' && await statusOf(short.id) === 'pending')
    const usd = await mkOrder(); remote.set(usd.requestId, record(usd.requestId, usd.id, 'CR_PAID', 2500, 'USD'))
    check('paid in another currency → refused', await svc.fulfillAbzerVerified(usd.id) === 'ignored')
    const noRcpt = await mkOrder(); remote.set(noRcpt.requestId, record(noRcpt.requestId, noRcpt.id, 'CR_PAID', 2500, 'AED', false))
    check('CR_PAID without a receipt → not paid', await svc.fulfillAbzerVerified(noRcpt.id) === 'not-paid')

    const down = await mkOrder(); remote.set(down.requestId, 503)
    check('Abzer answering 503 → retry (a failed lookup is not "unpaid")', await svc.fulfillAbzerVerified(down.id) === 'retry')
    const gone = await mkOrder(); route = (p, m) => p === '/authenticate' ? AUTH_OK : { status: -1, body: null }
    check('Abzer unreachable → retry', await svc.fulfillAbzerVerified(gone.id) === 'retry')
    route = defaultRoute

    const refunded = await mkOrder({ status: 'refunded' }); remote.set(refunded.requestId, record(refunded.requestId, refunded.id, 'CR_PAID'))
    check('a refunded order is never made paid again', await svc.fulfillAbzerVerified(refunded.id) === 'ignored' && await statusOf(refunded.id) === 'refunded')
    const tabby = await mkOrder({ gateway: 'tabby' }); remote.set(tabby.requestId, record(tabby.requestId, tabby.id, 'CR_PAID'))
    check('a Tabby order is not an Abzer order', await svc.fulfillAbzerVerified(tabby.id) === 'ignored')
    const noId = await mkOrder({ requestId: null })
    check('no request id stored → cannot confirm', await svc.fulfillAbzerVerified(noId.id) === 'ignored')
  }

  /* ─────────────────────────────────────────────────────── */
  section('D · the webhook route')
  {
    route = defaultRoute
    const receipt = (o: { id: string; requestId: string }, extra: Record<string, unknown> = {}) => ({
      type: 'WH_RECEIPT_POSTING', paymentStatus: 'Success', receiptId: `rc-${o.requestId.slice(-4)}`, receiptAmount: 2500, collectedCurrency: 'AED', invoiceNumber: o.id, ...extra,
    })

    const ok = await mkOrder(); remote.set(ok.requestId, record(ok.requestId, ok.id, 'CR_PAID'))
    const r = await hook(receipt(ok))
    check('a genuine receipt: 200, paid', r.status === 200 && await statusOf(ok.id) === 'paid')

    const noSecret = await mkOrder(); remote.set(noSecret.requestId, record(noSecret.requestId, noSecret.id, 'CR_PAID'))
    const r2 = await hook(receipt(noSecret), null)
    check('no secret header: 200 (no retry storm) but NOT fulfilled', r2.status === 200 && await statusOf(noSecret.id) === 'pending')
    await hook(receipt(noSecret), 'wrong-secret')
    check('a wrong secret: not fulfilled', await statusOf(noSecret.id) === 'pending')

    const forged = await mkOrder(); remote.set(forged.requestId, record(forged.requestId, forged.id, 'CR_REQUESTED'))
    await hook(receipt(forged))
    check('a receipt with the RIGHT secret for an unpaid request: refused (Abzer says not paid)', await statusOf(forged.id) === 'pending')

    const batchA = await mkOrder(), batchB = await mkOrder()
    remote.set(batchA.requestId, record(batchA.requestId, batchA.id, 'CR_PAID')); remote.set(batchB.requestId, record(batchB.requestId, batchB.id, 'CR_PAID'))
    await hook([receipt(batchA), receipt(batchB)])
    check('a JSON array: every invoice in it is settled', await statusOf(batchA.id) === 'paid' && await statusOf(batchB.id) === 'paid')

    const form = await mkOrder(); remote.set(form.requestId, record(form.requestId, form.id, 'CR_PAID'))
    await hook(Object.fromEntries(Object.entries(receipt(form)).map(([k, v]) => [k, String(v)])), undefined, true)
    check('form fields (POST_PARAMS body type) work too', await statusOf(form.id) === 'paid')

    const offline = await mkOrder(); route = (p) => p === '/authenticate' ? AUTH_OK : { status: -1, body: null }
    await hook(receipt(offline))
    check('Abzer unreachable: a matching receipt still fulfils (header + exact amount)', await statusOf(offline.id) === 'paid')
    const offShort = await mkOrder()
    await hook(receipt(offShort, { receiptAmount: 25 }))
    check('...but a short receipt does not', await statusOf(offShort.id) === 'pending')
    route = defaultRoute

    const pendingApproval = await mkOrder(); remote.set(pendingApproval.requestId, record(pendingApproval.requestId, pendingApproval.id, 'CR_PAID'))
    await hook(receipt(pendingApproval, { paymentStatus: 'Pending Approval' }))
    check('"Pending Approval" is not paid', await statusOf(pendingApproval.id) === 'pending')
    const failure = await mkOrder()
    const r3 = await hook({ type: 'WH_PAYMENT_FAILURE', invoiceNumber: failure.id })
    check('WH_PAYMENT_FAILURE: 200, order left pending', r3.status === 200 && await statusOf(failure.id) === 'pending')
    /* Unparseable JSON never reaches the route — the app's JSON parser answers 400. Abzer never sends it. */
    const r4 = await hook('not json at all')
    check('a malformed body: no server error, nothing done', r4.status < 500, String(r4.status))
    const r5 = await hook({ type: 'WH_RECEIPT_POSTING', paymentStatus: 'Success', receiptId: 'x', receiptAmount: 2500, invoiceNumber: 'not-an-object-id' })
    check('an invoice number that is not ours: 200', r5.status === 200)
  }

  /* ─────────────────────────────────────────────────────── */
  section('E · refunds')
  {
    route = defaultRoute
    const o = await mkOrder({ status: 'paid' })
    await hook({ type: 'WH_REFUND', invoiceNumber: o.id, receiptAmount: 1000, collectedCurrency: 'AED' })
    check('a partial refund: left paid for a person to look at', await statusOf(o.id) === 'paid')
    await hook({ type: 'WH_REFUND', invoiceNumber: o.id, refundAmount: 2500, collectedCurrency: 'AED' })
    check('a full refund: marked refunded', await statusOf(o.id) === 'refunded')
    remote.set(o.requestId, record(o.requestId, o.id, 'CR_PAID'))
    await hook({ type: 'WH_RECEIPT_POSTING', paymentStatus: 'Success', receiptId: 'rc-again', receiptAmount: 2500, collectedCurrency: 'AED', invoiceNumber: o.id })
    check('a receipt redelivered after the refund does not make it paid again', await statusOf(o.id) === 'refunded')
    const pend = await mkOrder()
    await hook({ type: 'WH_REFUND', invoiceNumber: pend.id, refundAmount: 2500 })
    check('a refund for an unpaid order changes nothing', await statusOf(pend.id) === 'pending')
  }

  /* ─────────────────────────────────────────────────────── */
  section('F · return check and sweep')
  {
    route = defaultRoute
    const f = await mkOrder(); remote.set(f.requestId, record(f.requestId, f.id, 'CR_FAILED'))
    const vf = await svc.verifyAbzerReturn(String(f.userId), f.id, '')
    check('return page: a failed attempt says failed', vf.paid === false && vf.failed === true)
    const p = await mkOrder(); remote.set(p.requestId, record(p.requestId, p.id, 'CR_PAID'))
    const t0 = Date.now(); const vp = await svc.verifyAbzerReturn(String(p.userId), p.id, '')
    check('return page: paid at Abzer → paid now, without waiting for a webhook', vp.paid === true && vp.failed === false && await enrolled(p.userId), `${Date.now() - t0}ms`)
    let forbidden = false; try { await svc.verifyAbzerReturn(String(new mongoose.Types.ObjectId()), p.id, '') } catch (e) { forbidden = (e as any).statusCode === 403 || /belong/.test((e as Error).message) }
    check('someone else\'s order: refused', forbidden)

    /* Sweep: only pending Abzer orders 5 min – 7 days old. */
    await mongoose.connection.db!.collection('orders').updateMany({ status: 'pending' }, { $set: { status: 'cancelled' } })
    const due = await mkOrder({ ageMs: 30 * 60_000 }), young = await mkOrder({ ageMs: 60_000 }), old = await mkOrder({ ageMs: 8 * 86_400_000 })
    for (const o of [due, young, old]) remote.set(o.requestId, record(o.requestId, o.id, 'CR_PAID'))
    calls = []
    const res = await runAbzerSweep()
    const looked = new Set(calls.filter(c => c.method === 'GET').map(c => c.path.split('/').pop()))
    check('the due order is recovered', res.fulfilled === 1 && await statusOf(due.id) === 'paid', JSON.stringify(res))
    check('an order under 5 minutes old is left alone', !looked.has(young.requestId) && await statusOf(young.id) === 'pending')
    check('an order over 7 days old is left alone', !looked.has(old.requestId) && await statusOf(old.id) === 'pending')
  }
  await settle()
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  globalThis.fetch = realFetch
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect(); server.close()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
