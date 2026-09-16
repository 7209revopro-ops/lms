/* ─────────────────────────────────────────────────────────────
   Tabby — the parts that move money, and the parts Tabby's QA fails you for.

   Everything here runs against a stubbed fetch, so it needs no credentials, no
   network and no database. That is deliberate: these are the rules that are
   cheap to get wrong and expensive to discover in production, and none of them
   need a live gateway to state.

   Asserted here:
     · webhook registration is genuinely idempotent. Tabby allows FOUR webhooks
       per merchant_code + key pair and does not document what a repeat POST of
       the same URL does. This process re-registers on every boot, and under PM2
       that is every deploy — so "list first, post only if absent" is the only
       version of this that survives a month;
     · the merchant code travels as a header. Tabby requires X-Merchant-Code on
       the webhook endpoints and rejects the call without it;
     · a non-HTTPS endpoint is refused locally rather than sent to Tabby to be
       rejected with an opaque 400;
     · capture and refund reference_ids are derived from OUR order id, never a
       timestamp, because Tabby treats them as idempotency keys — a retry after
       a timeout must replay the first result, not take the money twice;
     · a genuine SECOND refund gets a genuinely different reference_id, or Tabby
       silently replays the first one and the customer is never made whole;
     · capture/refund totals are summed by VALUE across the array, because Tabby
       does not guarantee its order;
     · rejection copy is Tabby's, verbatim, in both languages;
     · strings are clipped to the 255 characters Tabby accepts.

   Run: bun run test:tabby
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
/* Set before the first import that reads config/env.ts — env is parsed once, at
   import time, and the real .env leaves these blank. */
process.env.TABBY_SECRET_KEY     = 'sk_test_suite'
process.env.TABBY_MERCHANT_CODE  = 'DeltaAE'
process.env.TABBY_WEBHOOK_SECRET = 'whsec-suite'
process.env.TABBY_CURRENCY       = 'AED'
process.env.BACKEND_PUBLIC_URL   = 'https://api.delta.test'

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const {
  TabbyService, TabbyRejectedError, TABBY_REJECTION_MESSAGES,
  tabbyRejectionMessage, tabbySumFils, tabbyField, tabbyWebhookEndpoint, isTabbyId,
} = await import('@/services/tabby.service.ts')

/* ── fetch stub ──────────────────────────────────────────────
   Records every call and answers from a queue of canned replies. */
interface Call { url: string; method: string; headers: Record<string, string>; body: any }
const realFetch = globalThis.fetch
let calls: Call[] = []
let replies: Array<{ status: number; body: any }> = []

function stubFetch() {
  calls = []
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {})) as Record<string, string>
    calls.push({
      url:     String(input),
      method:  init.method ?? 'GET',
      headers,
      body:    init.body ? JSON.parse(init.body) : undefined,
    })
    const next = replies.shift() ?? { status: 200, body: {} }
    return {
      ok:     next.status >= 200 && next.status < 300,
      status: next.status,
      json:   async () => next.body,
      text:   async () => JSON.stringify(next.body),
    } as any
  }) as any
}
function restoreFetch() { globalThis.fetch = realFetch }

try {
  const svc = new TabbyService()
  /* Tabby ids are UUIDs, and the service now refuses anything else before the
     value can reach a URL path — so fixtures must look like the real thing. */
  const PAY = '01a0ab56-0728-87bd-a005-f453c9a02c61'

  /* ─────────────────────────────────────────────────────── */
  section('Webhook registration — idempotent, or it eats Tabby’s 4-webhook budget')
  {
    stubFetch()

    /* 1. Nothing registered yet → lists, then posts. */
    replies = [
      { status: 200, body: [] },
      { status: 200, body: { id: 'wh_1', url: 'https://api.delta.test/api/v1/webhooks/tabby' } },
    ]
    await svc.registerWebhook()

    check('it LISTS before registering', calls[0]?.method === 'GET', calls[0]?.method)
    check('and then registers', calls[1]?.method === 'POST', String(calls.length))
    check('at the documented v1 endpoint',
      calls[1]?.url === 'https://api.tabby.ai/api/v1/webhooks', calls[1]?.url)
    check('pointing at our own HTTPS endpoint',
      calls[1]?.body?.url === 'https://api.delta.test/api/v1/webhooks/tabby', calls[1]?.body?.url)

    /* The header Tabby requires and the previous implementation never sent. */
    check('the merchant code travels as X-Merchant-Code',
      calls[1]?.headers['X-Merchant-Code'] === 'DeltaAE',
      JSON.stringify(calls[1]?.headers))
    check('on the LIST call too',
      calls[0]?.headers['X-Merchant-Code'] === 'DeltaAE')
    check('authorised with the SECRET key',
      calls[1]?.headers['Authorization'] === 'Bearer sk_test_suite')

    /* The shared secret we choose comes back to us as a bearer header. */
    check('our webhook secret is registered as the signing header',
      calls[1]?.body?.header?.title === 'Authorization' &&
      calls[1]?.body?.header?.value === 'Bearer whsec-suite')

    /* Deprecated by Tabby — the key decides the environment. */
    check('the deprecated is_test flag is no longer sent',
      calls[1]?.body?.is_test === undefined, JSON.stringify(calls[1]?.body))

    /* 2. Already registered → lists, posts NOTHING. */
    calls = []
    replies = [{ status: 200, body: [
      { id: 'wh_1', url: 'https://api.delta.test/api/v1/webhooks/tabby' },
    ] }]
    await svc.registerWebhook()
    check('a reboot with our URL already registered posts nothing',
      calls.length === 1 && calls[0]?.method === 'GET',
      calls.map(c => c.method).join(','))

    /* 3. Budget already spent on four OTHER urls → refuses rather than 400s. */
    calls = []
    replies = [{ status: 200, body: [
      { id: '1', url: 'https://a.test/hook' }, { id: '2', url: 'https://b.test/hook' },
      { id: '3', url: 'https://c.test/hook' }, { id: '4', url: 'https://d.test/hook' },
    ] }]
    await svc.registerWebhook()
    check('at Tabby’s limit of four it declines to post a fifth',
      calls.length === 1, calls.map(c => c.method).join(','))

    /* 4. Tabby documents the list response as "a Webhook object or null". */
    calls = []
    replies = [{ status: 200, body: { id: 'wh_1', url: 'https://api.delta.test/api/v1/webhooks/tabby' } }]
    await svc.registerWebhook()
    check('a single-object list response is understood, not re-registered',
      calls.length === 1, calls.map(c => c.method).join(','))

    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('A localhost endpoint is refused here, not by Tabby')
  {
    /* Tabby answers a non-HTTPS endpoint with an opaque 400, so the check is
       worth making where we can say something useful about it. */
    check('a public HTTPS origin yields the endpoint',
      tabbyWebhookEndpoint('https://api.delta.test') === 'https://api.delta.test/api/v1/webhooks/tabby',
      String(tabbyWebhookEndpoint('https://api.delta.test')))
    check('a localhost dev origin yields nothing to register',
      tabbyWebhookEndpoint('http://localhost:8000') === null)
    check('so does any other plain-HTTP origin',
      tabbyWebhookEndpoint('http://api.delta.test') === null)
    check('and an unset BACKEND_PUBLIC_URL is not turned into a URL',
      tabbyWebhookEndpoint(undefined) === null && tabbyWebhookEndpoint('') === null)
  }

  /* ─────────────────────────────────────────────────────── */
  section('Capture — idempotency keys come from the order, never the clock')
  {
    stubFetch()
    replies = [{ status: 200, body: {} }]
    const ok = await svc.capturePayment({
      paymentId: PAY, amountAED: '730.33', orderId: 'ord_abc',
      courseTitle: 'Diploma in Dental Assisting', courseId: 'crs_1',
    })
    check('a capture Tabby accepts reports success', ok === true)
    check('it posts to the v2 captures endpoint',
      calls[0]?.url === `https://api.tabby.ai/api/v2/payments/${PAY}/captures`, calls[0]?.url)
    check('the reference_id is derived from our order id',
      calls[0]?.body?.reference_id === 'capture-ord_abc', calls[0]?.body?.reference_id)
    check('the full amount is captured',
      calls[0]?.body?.amount === '730.33', calls[0]?.body?.amount)

    /* Same order, retried after a timeout → same key, so Tabby replays. */
    calls = []
    replies = [{ status: 200, body: {} }]
    await svc.capturePayment({
      paymentId: PAY, amountAED: '730.33', orderId: 'ord_abc',
      courseTitle: 'Diploma in Dental Assisting', courseId: 'crs_1',
    })
    check('a retry of the SAME capture reuses the SAME reference_id',
      calls[0]?.body?.reference_id === 'capture-ord_abc', calls[0]?.body?.reference_id)

    /* A refused capture must be reported, not swallowed. */
    calls = []
    replies = [{ status: 400, body: { error: 'nope' } }]
    const bad = await svc.capturePayment({
      paymentId: PAY, amountAED: '730.33', orderId: 'ord_abc',
      courseTitle: 'x', courseId: 'c',
    })
    check('a refused capture returns false rather than pretending', bad === false)

    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Refund — a second refund must not replay the first')
  {
    stubFetch()
    replies = [{ status: 200, body: {} }]
    await svc.refundPayment({ paymentId: PAY, amountAED: '100.00', orderId: 'ord_abc' })
    check('the first refund keys off the order alone',
      calls[0]?.body?.reference_id === 'refund-ord_abc', calls[0]?.body?.reference_id)
    check('it posts to the v2 refunds endpoint',
      calls[0]?.url === `https://api.tabby.ai/api/v2/payments/${PAY}/refunds`, calls[0]?.url)

    /* attempt=1 is still the first refund — a retry of it, not a new one. */
    calls = []
    replies = [{ status: 200, body: {} }]
    await svc.refundPayment({ paymentId: PAY, amountAED: '100.00', orderId: 'ord_abc', attempt: 1 })
    check('retrying that refund keeps the same key, so Tabby replays it',
      calls[0]?.body?.reference_id === 'refund-ord_abc', calls[0]?.body?.reference_id)

    /* A genuine second refund. Without a distinct key Tabby replays the first
       one and the customer never receives the second. */
    calls = []
    replies = [{ status: 200, body: {} }]
    await svc.refundPayment({ paymentId: PAY, amountAED: '50.00', orderId: 'ord_abc', attempt: 2 })
    check('a genuine SECOND refund gets a distinct key',
      calls[0]?.body?.reference_id === 'refund-ord_abc-2', calls[0]?.body?.reference_id)

    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Close — the cancellation path, body-less by design')
  {
    stubFetch()
    replies = [{ status: 200, body: {} }]
    const ok = await svc.closePayment(PAY)
    check('close reports success', ok === true)
    check('it posts to the v2 close endpoint',
      calls[0]?.url === `https://api.tabby.ai/api/v2/payments/${PAY}/close`, calls[0]?.url)
    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('A payment id is never spliced into a Tabby URL unchecked')
  {
    /* payment_id reaches us from the student's browser (return redirect) and
       from webhook JSON. It lands in the PATH of a request we authenticate
       with the secret key, so a value like '../../v1/webhooks' would redirect
       an authenticated call to an endpoint of the caller's choosing. */
    check('a real Tabby UUID is accepted', isTabbyId(PAY))
    for (const evil of ['../../v1/webhooks', 'a/b', 'x?y=1', 'pay_1', '', ' ', 'https://evil.test/x']) {
      check(`refuses ${JSON.stringify(evil)}`, !isTabbyId(evil))
    }
    check('and a non-string is refused', !isTabbyId(null) && !isTabbyId(undefined) && !isTabbyId(42))

    /* The service refuses before any call goes out — not merely encodes it. */
    stubFetch()
    replies = [{ status: 200, body: {} }]
    let threw = false
    try { await svc.getPayment('../../v1/webhooks') } catch { threw = true }
    check('getPayment throws rather than calling Tabby', threw && calls.length === 0, String(calls.length))
    threw = false
    try { await svc.capturePayment({ paymentId: 'a/b', amountAED: '1.00', orderId: 'o', courseTitle: 't', courseId: 'c' }) } catch { threw = true }
    check('capturePayment throws rather than calling Tabby', threw && calls.length === 0, String(calls.length))
    restoreFetch()
  }

  /* ─────────────────────────────────────────────────────── */
  section('Totals are summed by value — Tabby does not promise array order')
  {
    check('an empty array is zero', tabbySumFils([]) === 0)
    check('one capture converts AED to fils',
      tabbySumFils([{ amount: '730.33', created_at: 'x' }]) === 73033)
    check('several are summed, not indexed',
      tabbySumFils([
        { amount: '100.00', created_at: '2026-01-02' },
        { amount: '50.50',  created_at: '2026-01-01' },
      ]) === 15050)
    /* Reading [0] instead of summing is the bug this guards. */
    check('an out-of-order array totals the same as an ordered one',
      tabbySumFils([
        { amount: '50.50',  created_at: '2026-01-01' },
        { amount: '100.00', created_at: '2026-01-02' },
      ]) === 15050)
    check('a missing amount does not poison the total with NaN',
      tabbySumFils([{ amount: undefined as any, created_at: 'x' }]) === 0)
  }

  /* ─────────────────────────────────────────────────────── */
  section('Rejection copy is Tabby’s, not ours')
  {
    /* Tabby publishes this wording and QA checks it is what the customer sees. */
    check('the too-high message is the published English wording',
      tabbyRejectionMessage('order_amount_too_high') ===
      'This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method')
    check('the too-low message is the published English wording',
      tabbyRejectionMessage('order_amount_too_low') ===
      'The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method')
    check('all three documented reasons are covered',
      Object.keys(TABBY_REJECTION_MESSAGES).sort().join(',') ===
      'not_available,order_amount_too_high,order_amount_too_low')
    check('each has Arabic as well as English',
      Object.values(TABBY_REJECTION_MESSAGES).every(m => m.en.length > 0 && m.ar.length > 0))

    /* A code we have never seen must not reach a student as a raw slug. */
    check('an unknown reason falls back to the generic copy',
      tabbyRejectionMessage('some_new_code_2027') === TABBY_REJECTION_MESSAGES['not_available']!.en)
    check('so does a missing one', tabbyRejectionMessage(null) === TABBY_REJECTION_MESSAGES['not_available']!.en)
    check('and the raw code never leaks into the message',
      !tabbyRejectionMessage('some_new_code_2027').includes('some_new_code'))

    const err = new TabbyRejectedError('order_amount_too_low')
    check('the typed error carries the reason for logging',
      err.rejectionReason === 'order_amount_too_low')
    check('while its message is what a student can actually read',
      err.message === TABBY_REJECTION_MESSAGES['order_amount_too_low']!.en)
  }

  /* ─────────────────────────────────────────────────────── */
  section('Strings fit the 255 characters Tabby accepts')
  {
    const short = 'Diploma in Dental Assisting'
    check('a normal title is untouched', tabbyField(short) === short)
    check('a 255-char title is untouched', tabbyField('x'.repeat(255)).length === 255)
    /* Course titles are admin-authored free text — a long one must not 400 the
       whole checkout. */
    check('a longer one is clipped to the limit', tabbyField('x'.repeat(400)).length === 255)
    check('and is visibly elided rather than silently cut',
      tabbyField('x'.repeat(400)).endsWith('…'))
  }

  /* ─────────────────────────────────────────────────────── */
  section('Session creation is rate limited per person')
  {
    /* Creating a session costs an authenticated call to Tabby, and Tabby meters
       them merchant-wide (200 per 10s for the WHOLE merchant). The general API
       limit of 100/min per person would let a dozen students exhaust that and
       take checkout down for everyone. Asserted on the config rather than by
       firing requests, so it stays a unit test. */
    const rl = await import('@/middleware/rateLimit.middleware.ts')
    check('a dedicated checkout limiter exists', typeof rl.checkoutRateLimit === 'function')

    const { readFile } = await import('node:fs/promises')
    const nodePath = (await import('node:path')).default
    const src = await readFile(nodePath.join(process.cwd(), 'src', 'middleware', 'rateLimit.middleware.ts'), 'utf8')
    const max = Number(/RATE_LIMIT_CHECKOUT_MAX', (\d+)/.exec(src)?.[1])
    check('its default is well below the general API limit', max > 0 && max < 100, String(max))
    check('but comfortably above a real purchase with retries', max >= 5, String(max))

    const routes = await readFile(nodePath.join(process.cwd(), 'src', 'routes', 'checkout.routes.ts'), 'utf8')
    /* Pre-scoring hits the same Tabby endpoint, and its cache is per course —
       so walking course ids walks past it. It needs the limiter too. */
    for (const r of ['/tabby/prescore', '/tabby/create-order']) {
      /* The middleware chain declared for this route, up to its handler —
         read by slicing rather than by regex, so the route string needs no
         escaping. */
      const at   = routes.indexOf(`router.post('${r}'`)
      const decl = at === -1 ? '' : routes.slice(at, routes.indexOf('async', at))
      check(`${r} is rate limited`, decl.includes('checkoutRateLimit'), decl.slice(0, 90))
    }
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
