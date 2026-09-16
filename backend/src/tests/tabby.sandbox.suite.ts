/* ─────────────────────────────────────────────────────────────
   Tabby — LIVE sandbox smoke test.

   Talks to the real Tabby sandbox with the keys in backend/.env. Nothing here
   moves money: a session is created, inspected, and left CREATED; a capture is
   attempted on it precisely so Tabby can refuse it. Skips itself (exit 0) when
   no sandbox key is configured, so it is safe in any environment — but it is
   NOT in the main `bun run test` chain because it needs the network.

   What it proves, in order:
     · the secret key and merchant code are accepted (a 401 here means they are
       wrong or swapped — Tabby issues sk_ for the server and pk_ for the page);
     · pre-scoring returns Tabby's decision and Tabby's wording for both the
       documented "approved" and "rejected" test identities;
     · a full checkout session is created and yields a hosted-page URL;
     · getPayment normalises the status to uppercase;
     · a payment that is merely CREATED cannot be captured — the gate that
       stops a forged webhook or a stale payment id from enrolling anyone;
     · an over-long course title is clipped rather than rejected.

   Run: bun run test:tabby:sandbox
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const { env } = await import('@/config/env.ts')

if (!env.TABBY_SECRET_KEY || !env.TABBY_MERCHANT_CODE) {
  console.log('tabby.sandbox: TABBY_SECRET_KEY / TABBY_MERCHANT_CODE not set — skipping (nothing to test against)')
  process.exit(0)
}
if (!env.TABBY_SECRET_KEY.startsWith('sk_test_')) {
  console.log('tabby.sandbox: refusing to run against a NON-sandbox key — this suite creates sessions')
  process.exit(1)
}

const { TabbyService, TABBY_REJECTION_MESSAGES } = await import('@/services/tabby.service.ts')
const svc = new TabbyService()

/* Documented sandbox identities — docs.tabby.ai/testing-guidelines/testing-credentials */
const APPROVED = { email: 'otp.success@tabby.ai', phone: '+971500000001' }
const REJECTED = { email: 'otp.success@tabby.ai', phone: '+971500000002' }

try {
  section('Credentials are accepted by the sandbox')
  {
    let hooks: unknown[] | null = null, err = ''
    try { hooks = await svc.listWebhooks() } catch (e) { err = (e as Error).message }
    check('GET /webhooks with the secret key + X-Merchant-Code succeeds', hooks !== null, err)
    if (hooks) lines.push(`        (${hooks.length} webhook(s) currently registered for this merchant code + key)`)
  }

  section('Pre-scoring returns Tabby’s decision and Tabby’s wording')
  {
    const ok = await svc.checkEligibility({ amountAED: 500, buyerEmail: APPROVED.email, buyerPhone: APPROVED.phone })
    check('the approved test identity is eligible', ok.available === true, JSON.stringify(ok))
    check('with no rejection message', ok.message === null)

    const no = await svc.checkEligibility({ amountAED: 500, buyerEmail: REJECTED.email, buyerPhone: REJECTED.phone })
    check('the pre-scoring-rejection identity is refused', no.available === false, JSON.stringify(no))
    check('with a documented reason code', typeof no.rejectionReason === 'string' && no.rejectionReason.length > 0, String(no.rejectionReason))
    check('and the message is Tabby’s published copy, verbatim',
      Object.values(TABBY_REJECTION_MESSAGES).some(m => m.en === no.message), String(no.message))
  }

  section('A checkout session is created and inspectable')
  {
    const orderId = `sandbox-${Math.random().toString(36).slice(2, 10)}`
    const result = await svc.createCheckout({
      amountAED: 730.33, orderId, courseTitle: 'Sandbox Smoke — Diploma', courseId: 'crs_sandbox',
      courseUrl: 'https://example.com/courses/sandbox',
      buyerEmail: APPROVED.email, buyerName: 'Sandbox Student', buyerPhone: APPROVED.phone,
      registeredSince: new Date('2025-01-15T10:30:00Z'), isEmailVerified: true, isPhoneVerified: true,
      orderHistory: [{ purchased_at: '2025-06-01T09:00:00Z', amount: '365.00', status: 'complete', payment_method: 'card' }],
      successUrl: 'https://example.com/payment-return?gateway=tabby&orderId=' + orderId,
      cancelUrl:  'https://example.com/payment-return?gateway=tabby&status=cancelled',
      failureUrl: 'https://example.com/payment-return?gateway=tabby&status=failed&orderId=' + orderId,
    })
    check('a checkout id comes back', !!result.checkoutId)
    check('a payment id comes back', !!result.paymentId)
    check('the hosted page URL is on Tabby’s checkout domain',
      /^https:\/\/checkout\.tabby\.ai\//.test(result.checkoutUrl), result.checkoutUrl)

    const p = await svc.getPayment(result.paymentId)
    check('getPayment finds it', p.id === result.paymentId)
    check('status is normalised to UPPERCASE', p.status === 'CREATED', p.status)
    check('amount round-trips', p.amount === '730.33', p.amount)
    check('captures[] and refunds[] are empty arrays, not undefined',
      Array.isArray(p.captures) && p.captures.length === 0 && Array.isArray(p.refunds))

    /* The gate. A payment nobody has authorised must not be capturable — this is
       what stops a forged webhook or a replayed payment id from enrolling anyone. */
    const captured = await svc.capturePayment({
      paymentId: result.paymentId, amountAED: '730.33', orderId, courseTitle: 'x', courseId: 'c',
    })
    check('capturing a CREATED (unauthorised) payment is refused by Tabby', captured === false)
    const after = await svc.getPayment(result.paymentId)
    check('and the payment is still CREATED afterwards', after.status === 'CREATED', after.status)

    lines.push(`\n        To finish this session by hand (OTP 8888): ${result.checkoutUrl}`)
    lines.push(`        payment id: ${result.paymentId}`)
  }

  section('Field limits')
  {
    const long = 'Diploma '.repeat(60)   // 480 chars
    let ok = true, msg = ''
    try {
      const r = await svc.createCheckout({
        amountAED: 100, orderId: `sandbox-long-${Math.random().toString(36).slice(2, 8)}`,
        courseTitle: long, courseId: 'crs_long',
        buyerEmail: APPROVED.email, buyerName: 'Sandbox Student', buyerPhone: APPROVED.phone,
        registeredSince: new Date('2025-01-15T10:30:00Z'),
        successUrl: 'https://example.com/s', cancelUrl: 'https://example.com/c', failureUrl: 'https://example.com/f',
      })
      ok = !!r.checkoutUrl
    } catch (e) { ok = false; msg = (e as Error).message }
    check('a 480-char course title still creates a session (clipped to 255)', ok, msg)
  }

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
