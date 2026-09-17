/* ─────────────────────────────────────────────────────────────
   Tamara — the contract, and the places it is NOT Tabby.

   Runs against a stubbed fetch: no credentials, no network, no database. That
   matters more here than it did for Tabby, because the credentials we hold are
   PRODUCTION ones and there is no sandbox merchant yet — so this suite is the
   only thing standing between a doc misreading and a live BNPL order.

   Asserted here:
     · the create-session payload matches the documented schema — including the
       three things that are easy to get wrong from a Tabby mental model: there
       is NO merchant_url.notification key, shipping_address is required even
       for a digital course, and consumer.phone_number is LOCAL format;
     · currency is always sent explicitly, because every Tamara endpoint
       defaults to SAR and a copied example would silently charge in it;
     · capture puts order_id in the BODY — there is no /orders/{id}/capture;
     · refunds go to the simplified-refund endpoint keyed by ORDER id;
     · the status vocabulary is exact, including the two spelling traps
       (`authorised` British, `canceled` single-L) and the fact that `approved`
       is NOT a paid state;
     · the webhook JWT is verified for signature AND expiry — its claims are
       only exp/iat/iss, so without the expiry check a captured token is a
       replayable credential forever;
     · a malformed order id never reaches an authenticated Tamara URL.

   Run: bun run test:tamara
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
/* Set before the first import that reads config/env.ts — env parses once. */
process.env.TAMARA_API_KEY            = 'test-api-token'
process.env.TAMARA_NOTIFICATION_TOKEN = 'test-notification-token'
process.env.TAMARA_BASE_URL           = 'https://api-sandbox.tamara.co'
process.env.TAMARA_CURRENCY           = 'AED'
process.env.BACKEND_PUBLIC_URL        = 'https://api.delta.test'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const {
  TamaraService, TAMARA_STATUSES, isTamaraStatus, tamaraStatusIsPaid, tamaraStatusIsDead,
  isTamaraId, tamaraLocalPhone, tamaraIntlPhone, TAMARA_WEBHOOK_EVENTS,
} = await import('@/services/tamara.service.ts')

const { createHmac } = await import('node:crypto')

/* ── fetch stub ────────────────────────────────────────── */
interface Call { url: string; method: string; headers: Record<string, string>; body: any }
const realFetch = globalThis.fetch
let calls: Call[] = []
let replies: Array<{ status: number; body: any }> = []

function stubFetch() {
  calls = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    calls.push({
      url:     String(input),
      method:  init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init.headers ?? {})) as Record<string, string>,
      body:    init.body ? JSON.parse(init.body) : undefined,
    })
    const next = replies.shift() ?? { status: 200, body: {} }
    return {
      ok:     next.status >= 200 && next.status < 300,
      status: next.status,
      text:   async () => JSON.stringify(next.body),
    } as any
  }) as any
}
function restoreFetch() { globalThis.fetch = realFetch }

const ORDER_ID = '8c5e39bb-698d-4c9a-bf9b-efe9bb133fca'

try {
  const svc = new TamaraService()

  /* ─────────────────────────────────────────────────────── */
  section('Create session — the documented payload, not a Tabby-shaped guess')
  {
    stubFetch()
    replies = [{ status: 200, body: {
      checkout_id: 'chk_1', order_id: ORDER_ID, checkout_url: 'https://checkout.tamara.co/x', status: 'new',
    } }]

    const r = await svc.createCheckout({
      amountAED: 730.33, orderId: 'ord_abc',
      courseTitle: 'Diploma in Dental Assisting', courseId: 'crs_1',
      courseUrl: 'https://client.test/courses/x',
      buyerEmail: 'student@example.com', buyerName: 'Mona Lisa',
      buyerPhone: '+971501234567', city: 'Dubai', addressLine: 'Villa 12',
      successUrl: 'https://client.test/s', cancelUrl: 'https://client.test/c', failureUrl: 'https://client.test/f',
    })

    const b = calls[0]?.body
    check('posts to /checkout', calls[0]?.url === 'https://api-sandbox.tamara.co/checkout', calls[0]?.url)
    check('authorised with the API token as a bearer',
      calls[0]?.headers['Authorization'] === 'Bearer test-api-token')
    check('returns the hosted checkout url', r.checkoutUrl === 'https://checkout.tamara.co/x')
    check('returns Tamara-s order id for later calls', r.tamaraOrderId === ORDER_ID)

    /* The three Tabby-shaped mistakes. */
    check('merchant_url has NO notification key — the webhook is account-level',
      b?.merchant_url && !('notification' in b.merchant_url), JSON.stringify(b?.merchant_url))
    check('but does carry success / failure / cancel',
      !!b?.merchant_url?.success && !!b?.merchant_url?.failure && !!b?.merchant_url?.cancel)
    check('shipping_address is present even for a digital course',
      !!b?.shipping_address?.city && b?.shipping_address?.country_code === 'AE',
      JSON.stringify(b?.shipping_address))
    check('consumer.phone_number is LOCAL format — no country code, no plus',
      b?.consumer?.phone_number === '501234567', String(b?.consumer?.phone_number))

    /* Currency: every Tamara endpoint defaults to SAR. */
    check('total_amount is explicitly AED', b?.total_amount?.currency === 'AED', JSON.stringify(b?.total_amount))
    check('and the amount is the decimal major unit', b?.total_amount?.amount === 730.33)
    check('shipping_amount and tax_amount are sent even at zero',
      b?.shipping_amount?.currency === 'AED' && b?.tax_amount?.currency === 'AED')
    check('country_code is AE', b?.country_code === 'AE')
    check('payment_type is PAY_BY_INSTALMENTS', b?.payment_type === 'PAY_BY_INSTALMENTS')
    check('our order id travels as order_reference_id', b?.order_reference_id === 'ord_abc')
    check('the single line item carries the course', b?.items?.length === 1 && b.items[0].type === 'Digital')

    /* Documented length caps. */
    calls = []
    replies = [{ status: 200, body: { checkout_id: 'c', order_id: ORDER_ID, checkout_url: 'https://checkout.tamara.co/y' } }]
    await svc.createCheckout({
      amountAED: 10, orderId: 'o', courseTitle: 'x'.repeat(400), courseId: 'y'.repeat(200),
      buyerEmail: 'a@b.c', buyerName: 'A B', buyerPhone: '501234567',
      successUrl: 'https://s', cancelUrl: 'https://c', failureUrl: 'https://f',
    })
    const long = calls[0]?.body
    check('item name is clipped to 255', long?.items?.[0]?.name?.length === 255, String(long?.items?.[0]?.name?.length))
    check('item sku is clipped to 128', long?.items?.[0]?.sku?.length === 128, String(long?.items?.[0]?.sku?.length))
    check('description is clipped to 256', long?.description?.length <= 256, String(long?.description?.length))

    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Money movement — the endpoint shapes Tamara actually uses')
  {
    stubFetch()

    /* Authorise: order id in the PATH, no body semantics. */
    replies = [{ status: 200, body: { status: 'authorised', auto_captured: false } }]
    const auth = await svc.authoriseOrder(ORDER_ID)
    check('authorise posts to /orders/{id}/authorise',
      calls[0]?.url === `https://api-sandbox.tamara.co/orders/${ORDER_ID}/authorise`, calls[0]?.url)
    check('and reports the resulting status', auth.ok && auth.status === 'authorised')
    check('and whether the account auto-captured', auth.autoCaptured === false)

    /* Auto-capture is an account-level flag: authorise can land on captured. */
    calls = []; replies = [{ status: 200, body: { status: 'fully_captured', auto_captured: true } }]
    const autoCap = await svc.authoriseOrder(ORDER_ID)
    check('an auto-capturing account is reported as such',
      autoCap.autoCaptured === true && autoCap.status === 'fully_captured')

    /* Capture: order id in the BODY. There is no /orders/{id}/capture. */
    calls = []; replies = [{ status: 200, body: {} }]
    await svc.captureOrder({
      tamaraOrderId: ORDER_ID, amountAED: 730.33,
      courseTitle: 'Course', courseId: 'crs_1', shippedAtIso: '2026-01-01T00:00:00.000Z',
    })
    check('capture posts to /payments/capture',
      calls[0]?.url === 'https://api-sandbox.tamara.co/payments/capture', calls[0]?.url)
    check('with order_id in the BODY, not the path', calls[0]?.body?.order_id === ORDER_ID)
    check('the captured amount is explicit AED',
      calls[0]?.body?.total_amount?.amount === 730.33 && calls[0]?.body?.total_amount?.currency === 'AED')
    check('shipping_info is present — Tamara requires it even for digital goods',
      !!calls[0]?.body?.shipping_info?.shipped_at && !!calls[0]?.body?.shipping_info?.shipping_company)

    /* Refund: simplified-refund, keyed by ORDER id. */
    calls = []; replies = [{ status: 200, body: { refund_id: 'ref_1' } }]
    await svc.refundOrder({ tamaraOrderId: ORDER_ID, amountAED: 100, orderId: 'ord_abc' })
    check('refund posts to /payments/simplified-refund/{orderId}',
      calls[0]?.url === `https://api-sandbox.tamara.co/payments/simplified-refund/${ORDER_ID}`, calls[0]?.url)
    check('comment is required by the API and always sent', typeof calls[0]?.body?.comment === 'string')
    check('merchant_refund_id keys off OUR order, never a timestamp',
      calls[0]?.body?.merchant_refund_id === 'refund-ord_abc', calls[0]?.body?.merchant_refund_id)

    calls = []; replies = [{ status: 200, body: {} }]
    await svc.refundOrder({ tamaraOrderId: ORDER_ID, amountAED: 50, orderId: 'ord_abc', attempt: 2 })
    check('a genuine second refund gets a distinct key',
      calls[0]?.body?.merchant_refund_id === 'refund-ord_abc-2', calls[0]?.body?.merchant_refund_id)

    /* Cancel: the unwind for authorised-but-uncaptured. */
    calls = []; replies = [{ status: 200, body: {} }]
    await svc.cancelOrder({ tamaraOrderId: ORDER_ID, amountAED: 730.33, orderId: 'ord_abc' })
    check('cancel posts to /orders/{id}/cancel',
      calls[0]?.url === `https://api-sandbox.tamara.co/orders/${ORDER_ID}/cancel`, calls[0]?.url)

    /* A refused money call must be reported, never swallowed. */
    calls = []; replies = [{ status: 400, body: { message: 'nope' } }]
    check('a refused capture returns false', (await svc.captureOrder({
      tamaraOrderId: ORDER_ID, amountAED: 1, courseTitle: 'x', courseId: 'c', shippedAtIso: 'now',
    })) === false)

    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Get order is the source of truth, and tolerates Tamara-s own shapes')
  {
    stubFetch()
    replies = [{ status: 200, body: {
      order_id: ORDER_ID, order_reference_id: 'ord_abc', status: 'authorised',
      total_amount: { amount: 730.33, currency: 'AED' },
      /* The docs type authorized_amount as an array but return an object. */
      authorized_amount: { amount: 730.33, currency: 'AED' },
      captures: [{ total_amount: { amount: 730.33, currency: 'AED' } }],
      refunds: [],
      auto_captured: false,
    } }]
    const o = await svc.getOrder(ORDER_ID)
    check('reads the order by id', calls[0]?.url === `https://api-sandbox.tamara.co/orders/${ORDER_ID}`)
    check('surfaces Tamara-s own order_reference_id — the binding to our order',
      o.orderReferenceId === 'ord_abc')
    check('converts the total to fils', o.totalFils === 73033, String(o.totalFils))
    check('sums captures to fils', o.capturedFils === 73033, String(o.capturedFils))
    check('and reports zero refunds as zero, not NaN', o.refundedFils === 0)
    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Status vocabulary — including the two spelling traps')
  {
    check('exactly the eleven documented statuses', TAMARA_STATUSES.length === 11, String(TAMARA_STATUSES.length))
    check('`authorised` is British -ised', (TAMARA_STATUSES as readonly string[]).includes('authorised'))
    check('`canceled` is American single-L', (TAMARA_STATUSES as readonly string[]).includes('canceled'))
    check('and `cancelled` is NOT accepted', !isTamaraStatus('cancelled'))
    check('nor `authorized`', !isTamaraStatus('authorized'))
    check('an unknown status is rejected rather than defaulted', !isTamaraStatus('order_something_new'))

    /* The single most important business rule in the integration. */
    check('`approved` is NOT a paid state — it is the customer-s first instalment only',
      !tamaraStatusIsPaid('approved'))
    check('`authorised` IS paid — funds committed, course owed', tamaraStatusIsPaid('authorised'))
    check('captured states are paid',
      tamaraStatusIsPaid('fully_captured') && tamaraStatusIsPaid('partially_captured'))
    check('`updated` (partially cancelled) is still live and still paid', tamaraStatusIsPaid('updated'))
    check('`new` is not paid', !tamaraStatusIsPaid('new'))

    check('declined / expired / canceled are terminal',
      tamaraStatusIsDead('declined') && tamaraStatusIsDead('expired') && tamaraStatusIsDead('canceled'))
    check('but `updated` is NOT terminal — it flows on to capture', !tamaraStatusIsDead('updated'))
    check('and a captured order is not terminal either — refunds remain possible',
      !tamaraStatusIsDead('fully_captured'))
  }

  /* ─────────────────────────────────────────────────────── */
  section('Webhook events')
  {
    const ev = TAMARA_WEBHOOK_EVENTS as readonly string[]
    check('all seven order events are subscribed', ev.length === 7, String(ev.length))
    for (const e of ['order_approved','order_authorised','order_declined','order_expired','order_canceled','order_captured','order_refunded']) {
      check(`subscribes ${e}`, ev.includes(e))
    }
    check('event names are lowercase — they were matched UPPERCASE before, so nothing fired',
      ev.every(e => e === e.toLowerCase()))
  }

  /* ─────────────────────────────────────────────────────── */
  section('Webhook JWT — signature AND expiry')
  {
    const SECRET = 'test-notification-token'
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const sign = (claims: object) => {
      const h = b64({ typ: 'JWT', alg: 'HS256' })
      const p = b64(claims)
      const s = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')
      return `${h}.${p}.${s}`
    }
    const now = Math.floor(Date.now() / 1000)

    check('a well-formed current token verifies',
      svc.verifyWebhookJwt(sign({ iss: 'Tamara', iat: now, exp: now + 900 }), SECRET).valid)

    check('a token signed with the wrong secret is refused',
      !svc.verifyWebhookJwt(sign({ iss: 'Tamara', iat: now, exp: now + 900 }), 'the-wrong-secret').valid)

    /* The claims are only exp/iat/iss — the token says nothing about the body.
       Expiry is therefore the ONLY thing limiting replay of a captured token. */
    const expired = svc.verifyWebhookJwt(sign({ iss: 'Tamara', iat: now - 3600, exp: now - 1800 }), SECRET)
    check('an expired token is refused', !expired.valid)
    check('and says why', expired.reason === 'expired', String(expired.reason))

    check('a token from another issuer is refused',
      !svc.verifyWebhookJwt(sign({ iss: 'NotTamara', iat: now, exp: now + 900 }), SECRET).valid)

    check('clock drift inside a minute is tolerated',
      svc.verifyWebhookJwt(sign({ iss: 'Tamara', iat: now, exp: now - 30 }), SECRET).valid)

    for (const junk of ['', 'not.a.jwt', 'only.two', 'a.b.c.d']) {
      check(`malformed token ${JSON.stringify(junk)} is refused`, !svc.verifyWebhookJwt(junk, SECRET).valid)
    }
  }

  /* ─────────────────────────────────────────────────────── */
  section('Order ids never reach an authenticated URL unchecked')
  {
    check('a real UUID is accepted', isTamaraId(ORDER_ID))
    for (const evil of ['../../webhooks', 'a/b', 'x?y=1', '', ' ', 'https://evil.test/x', 'ord_abc']) {
      check(`refuses ${JSON.stringify(evil)}`, !isTamaraId(evil))
    }
    check('a non-string is refused', !isTamaraId(null) && !isTamaraId(undefined) && !isTamaraId(42))

    stubFetch()
    replies = [{ status: 200, body: {} }]
    let threw = false
    try { await svc.getOrder('../../webhooks') } catch { threw = true }
    check('getOrder throws rather than calling Tamara', threw && calls.length === 0, String(calls.length))
    threw = false
    try { await svc.captureOrder({ tamaraOrderId: 'a/b', amountAED: 1, courseTitle: 'x', courseId: 'c', shippedAtIso: 'n' }) } catch { threw = true }
    check('capture throws rather than calling Tamara', threw && calls.length === 0, String(calls.length))
    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Phone normalisation — two endpoints, two formats')
  {
    /* create-session wants local; eligibility wants full international. */
    check('local strips the +971', tamaraLocalPhone('+971501234567') === '501234567')
    check('local strips a bare 971', tamaraLocalPhone('971501234567') === '501234567')
    check('local strips a leading zero', tamaraLocalPhone('0501234567') === '501234567')
    check('local tolerates spaces and dashes', tamaraLocalPhone('+971 50 123-4567') === '501234567')
    check('intl re-adds the country code', tamaraIntlPhone('0501234567') === '971501234567')
    check('intl never includes a plus', !tamaraIntlPhone('+971501234567').includes('+'))
    check('an empty phone stays empty', tamaraLocalPhone('') === '' && tamaraIntlPhone(undefined) === '')
  }

  /* ─────────────────────────────────────────────────────── */
  section('Eligibility fails SAFE')
  {
    stubFetch()
    replies = [{ status: 200, body: { has_available_payment_options: true } }]
    check('an eligible customer is available', (await svc.checkEligibility({ amountAED: 500 })).available)

    replies = [{ status: 200, body: { has_available_payment_options: false } }]
    const no = await svc.checkEligibility({ amountAED: 500 })
    check('an ineligible customer is not', !no.available)
    check('and carries copy to show rather than a raw code', typeof no.message === 'string' && no.message!.length > 20)

    /* A scoring outage must not pull the payment method off the page. */
    replies = [{ status: 500, body: {} }]
    check('a 500 from Tamara fails SAFE (still available)', (await svc.checkEligibility({ amountAED: 500 })).available)

    calls = []; replies = [{ status: 200, body: { has_available_payment_options: true } }]
    await svc.checkEligibility({ amountAED: 500, phone: '+971501234567' })
    check('eligibility posts to /pre-checkout/v1/eligibility',
      calls[0]?.url === 'https://api-sandbox.tamara.co/pre-checkout/v1/eligibility', calls[0]?.url)
    check('with the INTERNATIONAL phone shape this endpoint wants',
      calls[0]?.body?.customer?.phone_number === '971501234567', String(calls[0]?.body?.customer?.phone_number))
    check('and an explicit AED order value', calls[0]?.body?.order?.currency === 'AED')
    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Environment safety')
  {
    check('the sandbox base URL is not mistaken for production', svc.isProduction === false)
    check('the service knows it is configured', svc.isConfigured === true)

    stubFetch()
    calls = []
    const id = await svc.registerWebhook('http://localhost:8000/api/v1/webhooks/tamara')
    check('a non-HTTPS webhook URL is refused locally, not sent to Tamara',
      id === null && calls.length === 0, String(calls.length))

    replies = [{ status: 200, body: { webhook_id: 'wh_1' } }]
    calls = []
    const okId = await svc.registerWebhook('https://api.delta.test/api/v1/webhooks/tamara')
    check('an HTTPS URL registers and returns the id', okId === 'wh_1')
    check('subscribing all seven events', (calls[0]?.body?.events ?? []).length === 7)
    restoreFetch()
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  restoreFetch()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
