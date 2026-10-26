/* ─────────────────────────────────────────────────────────────
   Abzer — against the REAL BillXPro sandbox. No database, no money.
   Proves the shapes abzer.suite.ts stubs are the ones Abzer sends:
     · login, create a request, generate its hosted link
     · read the request back: CR_REQUESTED, our referenceNumber, amount, AED
     · an earlier sandbox request that was PAID reads CR_PAID with a receipt
       (ABZER_SANDBOX_PAID_ID / _PAID_REF — optional)
     · a garbage token is refused and the client recovers by logging in again
   Refuses to run unless ABZER_BASE_URL is the sandbox.
   Usage (from backend/): ABZER_ACCESS_KEY=… ABZER_SECRET_KEY=… \
     bun --no-env-file src/tests/abzersandbox.suite.ts
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
process.env.ABZER_BASE_URL ||= 'https://sandbox.billxpro.com/as/api/v100'
process.env.DATABASE_URL       ||= 'mongodb://localhost:27017/lms_abzersandbox_unused'
process.env.JWT_ACCESS_SECRET  ||= 'abzer-sandbox-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ||= 'abzer-sandbox-refresh-secret-0123456789'
export {}

if (!/^https:\/\/sandbox\.billxpro\.com\//.test(process.env.ABZER_BASE_URL!)) {
  console.error('REFUSING TO RUN: ABZER_BASE_URL is not the BillXPro sandbox'); process.exit(1)
}
if (!process.env.ABZER_ACCESS_KEY || !process.env.ABZER_SECRET_KEY) {
  console.log('SKIPPED — set ABZER_ACCESS_KEY / ABZER_SECRET_KEY (sandbox) to run'); process.exit(0)
}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

const { AbzerService, ABZER_STATUS, isAbzerId, resetAbzerTokenCache } = await import('@/services/abzer.service.ts')
const abz = new AbzerService()

try {
  section('Create → link → read back')
  const ref = `sbx${Date.now().toString(36)}`
  const t0 = Date.now()
  /* An undeliverable address: the payment-link template may email the buyer. */
  const made = await abz.createOrder({ amountAED: 1.5, orderId: ref, courseTitle: 'Sandbox check', buyerEmail: 'abzer.sandbox@qa.local', buyerName: 'Sandbox Check', buyerPhone: '+971501234567' })
  check('a request is created with a UUID', isAbzerId(made.abzerRequestId), made.abzerRequestId)
  check('the hosted link is on BillXPro', /^https:\/\/sandbox\.billxpro\.com\/pay\//.test(made.checkoutUrl), made.checkoutUrl)
  check('create + link within 15 s', Date.now() - t0 < 15_000, `${Date.now() - t0}ms`)

  const r = await abz.getPaymentRequest(made.abzerRequestId)
  check('read back: the same request', r.id === made.abzerRequestId)
  check('referenceNumber is what we sent (our order id)', r.referenceNumber === ref, r.referenceNumber)
  check('status CR_REQUESTED before payment', r.status === ABZER_STATUS.requested, r.status)
  check('amount 1.50 AED', r.amount === 1.5 && r.currency === 'AED', `${r.amount} ${r.currency}`)
  check('no receipt before payment', !r.receiptId)

  const paidId = process.env.ABZER_SANDBOX_PAID_ID
  if (paidId) {
    section('An earlier PAID sandbox request')
    const p = await abz.getPaymentRequest(paidId)
    check('CR_PAID', p.status === ABZER_STATUS.paid, p.status)
    check('carries a receipt id and number', !!p.receiptId && !!p.receiptNumber)
    check('amount and currency are numbers / codes', Number.isFinite(p.amount) && p.amount > 0 && p.currency === 'AED', `${p.amount} ${p.currency}`)
    if (process.env.ABZER_SANDBOX_PAID_REF) check('its referenceNumber is the order id we sent', p.referenceNumber === process.env.ABZER_SANDBOX_PAID_REF, p.referenceNumber)
  }
  const failedId = process.env.ABZER_SANDBOX_FAILED_ID
  if (failedId) {
    const f = await abz.getPaymentRequest(failedId)
    check('an earlier failed attempt reads CR_FAILED, no receipt', f.status === ABZER_STATUS.failed && !f.receiptId, f.status)
  }

  /* Abzer gives every request a NEW customer coded <minute><one random digit> and refuses a
     taken code with 409 — so a merchant account holds ~11 new requests a minute. The client
     retries into the next minute; six at once must always get through. Twelve is beyond the
     platform's ceiling and is measured, not asserted. */
  section("Bursts (Abzer's per-minute customer-code ceiling)")
  {
    const burst = async (size: number, tag: string) => {
      const R = Date.now().toString(36)
      const t0 = Date.now()
      const rs = await Promise.allSettled([...Array(size)].map((_, i) => abz.createOrder({
        amountAED: 1, orderId: `${tag}${R}${i}`, courseTitle: 'Sandbox check', buyerEmail: `${tag}${i}.${R}@qa.local`, buyerName: `Burst ${i}`, buyerPhone: `+9715033${String(i).padStart(5, '0')}`,
      })))
      return { ok: rs.filter(r => r.status === 'fulfilled').length, ms: Date.now() - t0 }
    }
    const six = await burst(6, 'six')
    check('six checkouts at once: all get a payment link', six.ok === 6, `${six.ok}/6`)
    check('...within the 35 s the page allows', six.ms < 35_000, `${six.ms}ms`)
    if (process.env.ABZER_SANDBOX_STRESS) {
      const twelve = await burst(12, 'twelve')
      lines.push(`  INFO  twelve at once: ${twelve.ok}/12 got a link in ${twelve.ms} ms`)
    }
  }

  section('Errors')
  let threw = false
  try { await abz.getPaymentRequest('00000000-0000-4000-8000-000000000000') } catch { threw = true }
  check('an unknown request id is an error, not "unpaid"', threw)

  /* Poison the cached token: the sandbox answers 403 "Token expired" and the client logs in again. */
  resetAbzerTokenCache()
  await abz.getPaymentRequest(made.abzerRequestId)
  const realFetch = globalThis.fetch
  let first = true
  globalThis.fetch = ((input: any, init: any = {}) => {
    if (first && String(input).includes('/direct-payment-request/')) { first = false; init = { ...init, headers: { ...init.headers, Authorization: 'Bearer expired-token' } } }
    return realFetch(input, init)
  }) as any
  const again = await abz.getPaymentRequest(made.abzerRequestId).catch(e => e as Error)
  globalThis.fetch = realFetch
  check('a rejected token: logged in again and answered', !(again instanceof Error) && again.status === ABZER_STATUS.requested, again instanceof Error ? again.message : '')
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}`)
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
