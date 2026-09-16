/* ─────────────────────────────────────────────────────────────
   Tabby — the HTTP surface, attacked.

   Boots the REAL Express app against an ISOLATED throwaway database
   (lms_tabby_suite, dropped on exit) and talks to the REAL Tabby sandbox for
   session creation and status checks. Nothing here can move money: every
   payment it creates is left CREATED, which Tabby refuses to capture.

   Every route is tried the four ways that catch different defects:
     · the owner does the thing (does it work?)
     · anonymous (must be 401)
     · another student (IDOR — a 200 here is a breach)
     · malformed input (must be 4xx, never a 5xx or a call to Tabby)

   Plus the attacks specific to a payment webhook:
     · no auth header, wrong secret, non-JSON body — nothing may be fulfilled
     · correct secret but a payment Tabby says is only CREATED — the
       server-to-server check must refuse, whatever the payload claims
     · a payment id Tabby has never heard of — we must ask for a retry (503),
       not swallow it
     · a payment id shaped to escape the URL path — must never reach Tabby

   And the rule the UI enforces but the API used to not: Tabby is UAE-only.

   Needs TABBY_SECRET_KEY (sk_test_) + TABBY_MERCHANT_CODE in backend/.env;
   skips (exit 0) without them. Not in the main chain — it needs the network.

   Run: bun run test:tabby:routes
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_tabby_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.BACKEND_PUBLIC_URL = 'http://127.0.0.1:8000'
process.env.CLIENT_URL   = 'https://client.test'
process.env.R2_ACCOUNT_ID = ''; process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_SECRET_ACCESS_KEY = ''; process.env.R2_PUBLIC_URL = ''
delete process.env.GOOGLE_CLIENT_ID
delete process.env.GOOGLE_CLIENT_SECRET
delete process.env.GOOGLE_REFRESH_TOKEN
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.RATE_LIMIT_CHECKOUT_MAX = '9000'
/* The webhook secret must be known to the suite for the "correct secret" case. */
process.env.TABBY_WEBHOOK_SECRET = process.env.TABBY_WEBHOOK_SECRET || 'suite-webhook-secret'
export {}

let pass = 0
const failures: string[] = []
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else { failures.push(`${label}${detail ? '  — ' + detail : ''}`); lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

if (!process.env.TABBY_SECRET_KEY || !process.env.TABBY_MERCHANT_CODE) {
  console.log('tabby.routes: TABBY_SECRET_KEY / TABBY_MERCHANT_CODE not set — skipping')
  process.exit(0)
}
if (!process.env.TABBY_SECRET_KEY.startsWith('sk_test_')) {
  console.log('tabby.routes: refusing to run against a NON-sandbox key'); process.exit(1)
}

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, OrderModel, EnrollmentModel } = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_tabby_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

type Jar = Map<string, string>
async function call(method: string, p: string, opts: { jar?: Jar; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined || opts.raw !== undefined) headers['content-type'] ??= 'application/json'
  if (opts.jar?.size) headers['cookie'] = [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${p}`, {
    method, headers,
    body: opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (opts.jar) for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';'); const i = pair!.indexOf('=')
    if (i > 0) opts.jar.set(pair!.slice(0, i), pair!.slice(i + 1))
  }
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}
const why = (r: { status: number; body: any }) => `${r.status} ${r.body?.error?.code ?? ''} ${String(r.body?.error?.message ?? '').slice(0, 80)}`
const PW  = 'CorrectHorse1'
const SECRET = process.env.TABBY_WEBHOOK_SECRET!

/* Documented sandbox identity — the approved one. */
const TEST_PHONE = '+971500000001'

try {
  const org  = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
  const hash = await hashPassword(PW)
  const mk = (email: string, extra: object = {}) =>
    UserModel.create({ name: email.split('@')[0], email, passwordHash: hash, role: 'student', isActive: true, organizationId: org._id, enrollmentStatus: 'approved', ...extra })

  const teacher = await UserModel.create({ name: 'teacher', email: 'teacher@t.local', passwordHash: hash, role: 'instructor', isActive: true, organizationId: org._id })
  const alice = await mk('otp.success@tabby.ai', { phone: TEST_PHONE, enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: TEST_PHONE } })
  const carol = await mk('carol@t.local',        { phone: TEST_PHONE, enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: TEST_PHONE } })
  const bob   = await mk('bob@t.local',          { phone: '+919900000001', enrollmentApplication: { homeCountry: 'India', phone: '+919900000001' } })

  const course = await CourseModel.create({
    title: 'Tabby Suite Course', slug: `tabby-suite-${Date.now()}`,
    description: 'A paid course for the Tabby route suite.',
    price: 199, priceAED: 730.33, isFree: false, status: 'published', language: 'English',
    instructorId: teacher._id, organizationId: org._id,
  })
  const freeCourse = await CourseModel.create({
    title: 'Free Course', slug: `tabby-free-${Date.now()}`, description: 'free',
    price: 0, isFree: true, status: 'published', language: 'English',
    instructorId: teacher._id, organizationId: org._id,
  })
  const draft = await CourseModel.create({
    title: 'Draft Course', slug: `tabby-draft-${Date.now()}`, description: 'draft',
    price: 50, priceAED: 183.50, isFree: false, status: 'draft', language: 'English',
    instructorId: teacher._id, organizationId: org._id,
  })

  const login = async (email: string) => {
    const jar: Jar = new Map()
    const r = await call('POST', '/auth/login', { jar, body: { email, password: PW } })
    if (r.status !== 200) throw new Error(`login ${email} → ${why(r)}`)
    return jar
  }
  const A = await login('otp.success@tabby.ai')
  const C = await login('carol@t.local')
  const B = await login('bob@t.local')
  const courseId = course._id.toString()

  /* ─────────────────────────────────────────────────── */
  section('Gateway config decides who is offered Tabby')
  {
    const a = await call('GET', '/checkout/config', { jar: A })
    check('a UAE student is offered Tabby in AED',
      a.body?.data?.currency === 'AED' && a.body?.data?.gateways?.includes('tabby'), JSON.stringify(a.body?.data))
    const b = await call('GET', '/checkout/config', { jar: B })
    check('a non-UAE student is NOT offered Tabby',
      !b.body?.data?.gateways?.includes('tabby'), JSON.stringify(b.body?.data))
    const anon = await call('GET', '/checkout/config')
    check('anonymous is 401', anon.status === 401, why(anon))
  }

  /* ─────────────────────────────────────────────────── */
  section('Pre-scoring')
  {
    const r = await call('POST', '/checkout/tabby/prescore', { jar: A, body: { courseId } })
    check('the UAE student gets Tabby’s answer', r.status === 200 && r.body?.data?.available === true, why(r) + ' ' + JSON.stringify(r.body?.data))
    check('and the AED amount the snippet must quote', r.body?.data?.amount === 730.33 && r.body?.data?.currency === 'AED', JSON.stringify(r.body?.data))

    const anon = await call('POST', '/checkout/tabby/prescore', { body: { courseId } })
    check('anonymous is 401', anon.status === 401, why(anon))

    const bad = await call('POST', '/checkout/tabby/prescore', { jar: A, body: { courseId: 'not-an-objectid' } })
    check('a malformed course id is a 4xx, not a 5xx', bad.status >= 400 && bad.status < 500, why(bad))

    const free = await call('POST', '/checkout/tabby/prescore', { jar: A, body: { courseId: freeCourse._id.toString() } })
    check('a free course is simply unavailable (no Tabby call needed)', free.status === 200 && free.body?.data?.available === false, why(free))

    /* The UI hides Tabby outside the UAE; the API must too, or the gating is
       decorative — Tabby's licence is per country and QA checks it. */
    const nonUae = await call('POST', '/checkout/tabby/prescore', { jar: B, body: { courseId } })
    check('a non-UAE student cannot pre-score with Tabby',
      nonUae.status === 403 || (nonUae.status === 200 && nonUae.body?.data?.available === false), why(nonUae) + ' ' + JSON.stringify(nonUae.body?.data))
  }

  /* ─────────────────────────────────────────────────── */
  section('Create order')
  let aliceOrderId = '', alicePaymentId = '', carolPaymentId = ''
  {
    const anon = await call('POST', '/checkout/tabby/create-order', { body: { courseId, slug: course.slug } })
    check('anonymous is 401', anon.status === 401, why(anon))

    const bad = await call('POST', '/checkout/tabby/create-order', { jar: A, body: { courseId: 'not-an-objectid', slug: 'x' } })
    check('a malformed course id is 400', bad.status === 400, why(bad))

    const free = await call('POST', '/checkout/tabby/create-order', { jar: A, body: { courseId: freeCourse._id.toString(), slug: freeCourse.slug } })
    check('a free course is refused', free.status === 400 && free.body?.error?.code === 'COURSE_IS_FREE', why(free))

    const dr = await call('POST', '/checkout/tabby/create-order', { jar: A, body: { courseId: draft._id.toString(), slug: draft.slug } })
    check('an unpublished course is 404', dr.status === 404, why(dr))

    const nonUae = await call('POST', '/checkout/tabby/create-order', { jar: B, body: { courseId, slug: course.slug } })
    check('a non-UAE student cannot create a Tabby order — the API enforces what the UI shows',
      nonUae.status === 403, why(nonUae))
    check('and no order row was written for them',
      (await OrderModel.countDocuments({ userId: bob._id })) === 0)

    const r = await call('POST', '/checkout/tabby/create-order', { jar: A, body: { courseId, slug: course.slug } })
    check('the UAE student gets a session', r.status === 201, why(r))
    check('with a hosted-page URL on Tabby’s domain',
      /^https:\/\/checkout\.tabby\.ai\//.test(String(r.body?.data?.checkoutUrl)), String(r.body?.data?.checkoutUrl))
    const order = await OrderModel.findOne({ userId: alice._id, gateway: 'tabby' }).lean() as any
    check('an order row exists, pending', !!order && order.status === 'pending', JSON.stringify(order && { status: order.status }))
    check('for the AED amount in fils', order?.amount === 73033 && order?.currency === 'AED', JSON.stringify(order && { amount: order.amount, currency: order.currency }))
    check('with Tabby’s ids recorded', !!order?.tabbyCheckoutId && !!order?.tabbyPaymentId)
    aliceOrderId   = order?._id?.toString() ?? ''
    alicePaymentId = order?.tabbyPaymentId ?? ''

    /* The slug in the body only ever fed the product_url we hand to Tabby, and
       nothing tied it to the course — so it was a way to put an arbitrary link
       inside a trusted third party's UI. The course's own slug is used now, so
       a hostile one is simply ignored. */
    const evilSlug = await call('POST', '/checkout/tabby/create-order', {
      jar: C, body: { courseId, slug: '../../../evil.test/phish' },
    })
    check('a hostile slug in the body is ignored, not reflected to Tabby',
      evilSlug.status === 201, why(evilSlug))
    await OrderModel.deleteMany({ userId: carol._id })

    /* Carol's own order — a second, unrelated CREATED payment to replay. */
    const c = await call('POST', '/checkout/tabby/create-order', { jar: C, body: { courseId, slug: course.slug } })
    const corder = await OrderModel.findOne({ userId: carol._id, gateway: 'tabby' }).lean() as any
    check('a second student gets her own session', c.status === 201 && !!corder?.tabbyPaymentId, why(c))
    carolPaymentId = corder?.tabbyPaymentId ?? ''
  }

  /* ─────────────────────────────────────────────────── */
  section('Verify-return — the browser’s word is never enough')
  {
    const anon = await call('POST', '/checkout/tabby/verify-return', { body: { orderId: aliceOrderId } })
    check('anonymous is 401', anon.status === 401, why(anon))

    const idor = await call('POST', '/checkout/tabby/verify-return', { jar: C, body: { orderId: aliceOrderId, paymentId: alicePaymentId } })
    check('another student on Alice’s order is 403', idor.status === 403, why(idor))

    const mal = await call('POST', '/checkout/tabby/verify-return', { jar: A, body: { orderId: 'not-an-objectid' } })
    check('a malformed order id is a 4xx, not a 5xx', mal.status >= 400 && mal.status < 500, why(mal))

    /* Owner, own pending order, payment only CREATED at Tabby. */
    const own = await call('POST', '/checkout/tabby/verify-return', { jar: A, body: { orderId: aliceOrderId, paymentId: alicePaymentId } })
    check('the owner’s call succeeds', own.status === 200, why(own))
    check('but reports paid:false for an unsettled payment', own.body?.data?.paid === false, JSON.stringify(own.body?.data))
    let o = await OrderModel.findById(aliceOrderId).lean() as any
    check('but a CREATED payment does not fulfil the order', o?.status === 'pending', o?.status)
    check('and no enrolment was created', (await EnrollmentModel.countDocuments({ userId: alice._id })) === 0)

    /* Replaying someone else's payment id against your own order. */
    const replay = await call('POST', '/checkout/tabby/verify-return', { jar: A, body: { orderId: aliceOrderId, paymentId: carolPaymentId } })
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('Carol’s payment id against Alice’s order fulfils nothing', replay.status < 500 && o?.status === 'pending', why(replay) + ' ' + o?.status)

    /* A payment id that tries to leave the URL path. It must be rejected by
       validation, never spliced into an authenticated request to Tabby. */
    for (const evil of ['../../v1/webhooks', 'x?foo=bar', 'a/b', '%2e%2e/%2e%2e/v1/webhooks', ' ']) {
      const r = await call('POST', '/checkout/tabby/verify-return', { jar: A, body: { orderId: aliceOrderId, paymentId: evil } })
      /* 422 from the validate middleware, 400 from the service guard — either
         is a refusal; what matters is that it never reaches Tabby. */
      check(`a path-shaped payment id ${JSON.stringify(evil)} is refused`, r.status >= 400 && r.status < 500, why(r))
    }
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('and the order is still pending afterwards', o?.status === 'pending', o?.status)
  }

  /* ─────────────────────────────────────────────────── */
  section('Webhook — forged, replayed, malformed')
  {
    const hook = (body: unknown, auth?: string, raw?: string) =>
      call('POST', '/webhooks/tabby', { body: raw === undefined ? body : undefined, raw, headers: auth ? { authorization: auth } : {} })
    const authorizedPayload = (id: string) => ({ id, status: 'authorized', amount: '730.33', currency: 'AED', order: { reference_id: aliceOrderId } })

    const noAuth = await hook(authorizedPayload(alicePaymentId))
    let o = await OrderModel.findById(aliceOrderId).lean() as any
    check('no Authorization header → acknowledged but nothing fulfilled', noAuth.status === 200 && o?.status === 'pending', why(noAuth) + ' ' + o?.status)

    const wrong = await hook(authorizedPayload(alicePaymentId), 'Bearer definitely-not-the-secret')
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('wrong secret → acknowledged but nothing fulfilled', wrong.status === 200 && o?.status === 'pending', why(wrong) + ' ' + o?.status)

    const nearMiss = await hook(authorizedPayload(alicePaymentId), `Bearer ${SECRET}x`)
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('secret with one extra byte → nothing fulfilled', nearMiss.status === 200 && o?.status === 'pending', why(nearMiss))

    const junk = await hook(undefined, `Bearer ${SECRET}`, '{not json')
    check('non-JSON body with the right secret is a 4xx, never a 5xx', junk.status >= 400 && junk.status < 500, why(junk))

    /* The one that matters: correct secret, payload SAYS authorized, but Tabby
       says CREATED. The server-to-server check must win. */
    const forged = await hook(authorizedPayload(alicePaymentId), `Bearer ${SECRET}`)
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('correct secret + payload claiming "authorized" for a CREATED payment → NOT fulfilled',
      forged.status === 200 && o?.status === 'pending', why(forged) + ' ' + o?.status)
    check('and no enrolment', (await EnrollmentModel.countDocuments({ userId: alice._id })) === 0)

    const closedClaim = await hook({ ...authorizedPayload(alicePaymentId), status: 'closed' }, `Bearer ${SECRET}`)
    o = await OrderModel.findById(aliceOrderId).lean() as any
    check('same with a "closed" claim', closedClaim.status === 200 && o?.status === 'pending', why(closedClaim))

    /* Unknown payment: Tabby 404s our getPayment → we must ask for a retry. */
    const ghost = await hook(authorizedPayload('00000000-0000-4000-8000-000000000000'), `Bearer ${SECRET}`)
    check('a payment Tabby has never heard of → 503 so Tabby re-delivers', ghost.status === 503, why(ghost))

    /* Path-shaped id in the webhook must not become a request to a different Tabby endpoint. */
    const evil = await hook(authorizedPayload('../../v1/webhooks'), `Bearer ${SECRET}`)
    check('a path-shaped payment id in the webhook is ignored (2xx), not sent to Tabby', evil.status === 200, why(evil))

    const ignored = await hook({ id: alicePaymentId, status: 'rejected' }, `Bearer ${SECRET}`)
    check('a non-capturable status is acknowledged', ignored.status === 200, why(ignored))
  }

  /* ─────────────────────────────────────────────────── */
  section('Replay of a genuinely AUTHORIZED payment against another order')
  {
    /* Everything above used CREATED payments, which Tabby refuses to capture —
       so those assertions passed for the wrong reason. The real attack needs a
       payment Tabby genuinely authorised. Rather than drive the OTP flow, stub
       the ONE call that reports payment state and let the rest of the system
       run for real: routes, ownership checks, binding, DB writes.

       The scenario: Alice completes a cheap purchase (P1 -> CLOSED, captured),
       then opens an expensive order O2 and calls verify-return with P1. */
    const { TabbyService } = await import('@/services/tabby.service.ts')
    const realGetPayment = TabbyService.prototype.getPayment

    const cheap = await CourseModel.create({
      title: 'Cheap Course', slug: `tabby-cheap-${Date.now()}`, description: 'cheap',
      price: 10, priceAED: 36.70, isFree: false, status: 'published', language: 'English',
      instructorId: teacher._id, organizationId: org._id,
    })

    /* Dave is clean: no enrolments, no prior orders. */
    const dave = await mk('dave@t.local', { phone: TEST_PHONE, enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: TEST_PHONE } })
    const D = await login('dave@t.local')

    await call('POST', '/checkout/tabby/create-order', { jar: D, body: { courseId: cheap._id.toString(), slug: cheap.slug } })
    const cheapOrder = await OrderModel.findOne({ userId: dave._id, courseId: cheap._id }).lean() as any
    const P1 = cheapOrder.tabbyPaymentId as string

    /* P1 is now genuinely CLOSED and captured, as it would be after a real purchase. */
    TabbyService.prototype.getPayment = async function (id: string) {
      if (id === P1) return {
        id, status: 'CLOSED', amount: '36.70', currency: 'AED',
        orderReferenceId: cheapOrder._id.toString(),
        captures: [{ amount: '36.70', created_at: '2026-01-01T00:00:00Z' }], refunds: [],
      } as any
      return realGetPayment.call(this, id)
    }

    const cheapDone = await call('POST', '/checkout/tabby/verify-return', { jar: D, body: { orderId: cheapOrder._id.toString(), paymentId: P1 } })
    const co = await OrderModel.findById(cheapOrder._id).lean() as any
    check('the genuine cheap purchase fulfils normally', cheapDone.status === 200 && co?.status === 'paid', why(cheapDone) + ' ' + co?.status)
    check('and reports paid:true', cheapDone.body?.data?.paid === true, JSON.stringify(cheapDone.body?.data))
    check('and enrols the student', (await EnrollmentModel.countDocuments({ userId: dave._id, courseId: cheap._id })) === 1)

    /* Now the attack: a fresh expensive order, paid for with the cheap payment. */
    await call('POST', '/checkout/tabby/create-order', { jar: D, body: { courseId, slug: course.slug } })
    const big = await OrderModel.findOne({ userId: dave._id, courseId: course._id }).lean() as any
    check('the expensive order starts pending at 730.33 AED', big?.status === 'pending' && big?.amount === 73033)

    const attack = await call('POST', '/checkout/tabby/verify-return', { jar: D, body: { orderId: big._id.toString(), paymentId: P1 } })
    const after = await OrderModel.findById(big._id).lean() as any
    check('replaying a 36.70 payment against a 730.33 order does NOT fulfil it',
      after?.status === 'pending', `${why(attack)} order=${after?.status}`)
    /* The client empties the basket and shows a thank-you on this response, so
       it has to say plainly that nothing settled — a 200 alone is not success. */
    check('and the response reports paid:false so the cart survives',
      attack.body?.data?.paid === false, JSON.stringify(attack.body?.data))
    check('and grants no enrolment in the expensive course',
      (await EnrollmentModel.countDocuments({ userId: dave._id, courseId: course._id })) === 0)

    /* Same replay through the webhook, which is the other door to the same sink. */
    const forgedHook = await call('POST', '/webhooks/tabby', {
      headers: { authorization: `Bearer ${SECRET}` },
      body: { id: P1, status: 'closed', amount: '36.70', currency: 'AED', order: { reference_id: big._id.toString() } },
    })
    const after2 = await OrderModel.findById(big._id).lean() as any
    check('the same replay through the webhook is refused too',
      after2?.status === 'pending', `${why(forgedHook)} order=${after2?.status}`)

    /* CLOSED is not the same as PAID. A student who opens a checkout and then
       cancels it in the Tabby app leaves a closed, never-captured payment —
       which used to fall through to the capture branch, fail there, and be
       fulfilled anyway by the "funds already committed" allowance. */
    const other = await CourseModel.create({
      title: 'Cancellation Case Course', slug: `tabby-cancel-${Date.now()}`, description: 'x',
      price: 10, priceAED: 36.70, isFree: false, status: 'published', language: 'English',
      instructorId: teacher._id, organizationId: org._id,
    })
    const cancelledOrderRes = await call('POST', '/checkout/tabby/create-order', { jar: D, body: { courseId: other._id.toString(), slug: other.slug } })
    check('a fresh order for the cancellation case', cancelledOrderRes.status === 201, why(cancelledOrderRes))
    const cancelled = await OrderModel.findOne({ userId: dave._id, courseId: other._id, status: 'pending' }).lean() as any
    const P2 = cancelled?.tabbyPaymentId as string

    TabbyService.prototype.getPayment = async function (id: string) {
      if (id === P2) return {
        id, status: 'CLOSED', amount: '36.70', currency: 'AED',
        orderReferenceId: cancelled._id.toString(),
        captures: [], refunds: [],          // closed WITHOUT capture — cancelled
      } as any
      if (id === P1) return {
        id, status: 'CLOSED', amount: '36.70', currency: 'AED',
        orderReferenceId: cheapOrder._id.toString(),
        captures: [{ amount: '36.70', created_at: '2026-01-01T00:00:00Z' }], refunds: [],
      } as any
      return realGetPayment.call(this, id)
    }

    const cancelAttack = await call('POST', '/checkout/tabby/verify-return', { jar: D, body: { orderId: cancelled._id.toString(), paymentId: P2 } })
    const cancelAfter = await OrderModel.findById(cancelled._id).lean() as any
    check('a CLOSED payment that was never captured does NOT fulfil',
      cancelAfter?.status === 'pending', `${why(cancelAttack)} order=${cancelAfter?.status}`)
    check('and reports paid:false', cancelAttack.body?.data?.paid === false, JSON.stringify(cancelAttack.body?.data))

    /* Captured then fully refunded is also CLOSED, and also not payment. */
    TabbyService.prototype.getPayment = async function (id: string) {
      if (id === P2) return {
        id, status: 'CLOSED', amount: '36.70', currency: 'AED',
        orderReferenceId: cancelled._id.toString(),
        captures: [{ amount: '36.70', created_at: '2026-01-01T00:00:00Z' }],
        refunds:  [{ amount: '36.70', created_at: '2026-01-02T00:00:00Z' }],
      } as any
      return realGetPayment.call(this, id)
    }
    const refundedAttack = await call('POST', '/checkout/tabby/verify-return', { jar: D, body: { orderId: cancelled._id.toString(), paymentId: P2 } })
    const refundedAfter = await OrderModel.findById(cancelled._id).lean() as any
    check('a CLOSED payment whose money was refunded does NOT fulfil',
      refundedAfter?.status === 'pending', `${why(refundedAttack)} order=${refundedAfter?.status}`)

    /* Restore the P1 stub for the assertions that follow. */
    TabbyService.prototype.getPayment = async function (id: string) {
      if (id === P1) return {
        id, status: 'CLOSED', amount: '36.70', currency: 'AED',
        orderReferenceId: cheapOrder._id.toString(),
        captures: [{ amount: '36.70', created_at: '2026-01-01T00:00:00Z' }], refunds: [],
      } as any
      return realGetPayment.call(this, id)
    }

    /* A refunded order must not be resurrected by a late callback. */
    await OrderModel.updateOne({ _id: cheapOrder._id }, { $set: { status: 'refunded' } })
    const resurrect = await call('POST', '/webhooks/tabby', {
      headers: { authorization: `Bearer ${SECRET}` },
      body: { id: P1, status: 'closed', amount: '36.70', currency: 'AED', order: { reference_id: cheapOrder._id.toString() } },
    })
    const refunded = await OrderModel.findById(cheapOrder._id).lean() as any
    check('a refunded order is not flipped back to paid by a late callback',
      refunded?.status === 'refunded', `${why(resurrect)} order=${refunded?.status}`)

    TabbyService.prototype.getPayment = realGetPayment
  }

  /* ─────────────────────────────────────────────────── */
  section('Already enrolled')
  {
    await EnrollmentModel.create({ userId: alice._id, courseId: course._id, status: 'active' })
    const r = await call('POST', '/checkout/tabby/create-order', { jar: A, body: { courseId, slug: course.slug } })
    check('an enrolled student cannot buy the course again', r.status === 409, why(r))
  }

} catch (err) {
  failures.push(`suite threw — ${(err as Error).message}`)
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
