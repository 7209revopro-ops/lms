/* ─────────────────────────────────────────────────────────────
   Money, as a property — Tabby, Tamara and Abzer (2026-10-26).
   For hundreds of random prices and coupons, through each gateway's real
   order-creation path (gateways stubbed at fetch, real database):
     · the amount sent to the gateway equals the order to the fil
     · the order equals price − discount, the discount capped at the price
     · the gateway's own breakdown (items − discount) adds up to its total
     · never more than two decimals on the wire
   Seeded: a failure prints its seed — rerun with PAYMENT_SEED=<n>.
   Usage (from backend/): bun --no-env-file src/tests/paymentamounts.suite.ts
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.PAYMENTAMOUNTS_DB_URL || 'mongodb://localhost:27017/lms_paymentamounts_suite'
process.env.JWT_ACCESS_SECRET  = 'paymentamounts-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET = 'paymentamounts-refresh-secret-0123456789'
process.env.TABBY_SECRET_KEY = 'sk_test_paymentamounts'; process.env.TABBY_PUBLIC_KEY = 'pk_test_paymentamounts'
process.env.TABBY_MERCHANT_CODE = 'DeltaAE'; process.env.TABBY_CURRENCY = 'AED'
process.env.TAMARA_API_KEY = 'test-token'; process.env.TAMARA_BASE_URL = 'https://api-sandbox.tamara.co'
process.env.TAMARA_NOTIFICATION_TOKEN = 'test-notification'; process.env.TAMARA_CURRENCY = 'AED'
process.env.ABZER_ACCESS_KEY = 'test-access'; process.env.ABZER_SECRET_KEY = 'test-secret'; process.env.ABZER_CURRENCY = 'AED'
process.env.ABZER_BASE_URL = 'https://abzer.test/as/api/v100'
process.env.CLIENT_URL = 'https://lms.test'; process.env.BACKEND_PUBLIC_URL = 'https://api.lms.test'; process.env.ENABLE_CRON = 'false'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID', 'VAPID_PUBLIC_KEY']) process.env[k] = ''
export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) } else { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (n: string) => lines.push(`\n${n}`)

/* Seeded RNG (mulberry32) */
const SEED = Number(process.env.PAYMENT_SEED ?? Date.now() % 2 ** 31)
let st = SEED >>> 0
const rand = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

/* ── gateway stub: records what each gateway was asked to charge ── */
const realFetch = globalThis.fetch
let sent: { host: string; path: string; body: any }[] = []
let uuidN = 0
const uuid = () => `0a2a00af-9f26-47ba-819f-${(++uuidN).toString(16).padStart(12, '0')}`
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input))
  const body = init.body ? JSON.parse(init.body) : undefined
  sent.push({ host: url.host, path: url.pathname, body })
  const json = (status: number, b: unknown) => ({ ok: status < 300, status, headers: new Headers(), json: async () => b, text: async () => JSON.stringify(b) }) as any
  if (url.host === 'api.tabby.ai') {
    return json(200, { id: uuid(), status: 'created', configuration: { available_products: { installments: [{ web_url: 'https://checkout.tabby.ai/x' }] } } })
  }
  if (url.host === 'api-sandbox.tamara.co') {
    if (url.pathname.includes('eligibility')) return json(200, { is_eligible: true })
    return json(200, { checkout_id: uuid(), order_id: uuid(), checkout_url: 'https://checkout.tamara.co/x' })
  }
  if (url.host === 'abzer.test') {
    if (url.pathname.endsWith('/authenticate')) return json(200, { token: 't' })
    if (url.pathname.endsWith('/link-generate')) return json(200, { mailLink: 'https://sandbox.billxpro.com/pay/pu/x', isLinkExpired: false })
    return json(201, { id: uuid() })
  }
  return json(404, {})
}) as any

const mongoose = (await import('mongoose')).default
await mongoose.connect(process.env.DATABASE_URL!)
await mongoose.connection.db!.dropDatabase()
const M = await import('@/models/schema.ts')
const { OrderService } = await import('@/services/order.service.ts')
const { setTabbyPacing } = await import('@/services/tabby.service.ts')
setTabbyPacing(Infinity)

const toFils = (v: unknown) => Math.round(Number(v) * 100)
const twoDp = (v: unknown) => /^-?\d+(\.\d{1,2})?$/.test(String(v))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', paymentGateway: 'abzer', currency: 'AED' } as any)
  const teacher = await M.UserModel.create({ name: 'Teacher', email: 't@pa.local', role: 'instructor', isActive: true, isVerified: true, organizationId: org._id } as any)
  const svc = new OrderService()
  let nU = 0
  const student = () => M.UserModel.create({ name: `Buyer Number${++nU}`, email: `b${nU}@pa.local`, role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id, phone: '+971501234567',
    enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: '+971501234567', city: 'Dubai' } } as any)

  const ITER = Number(process.env.PAYMENT_ITER ?? 120)
  const failures: Record<string, string[]> = { tabby: [], tamara: [], abzer: [] }
  const zeroOutcomes: Record<string, string[]> = { tabby: [], tamara: [], abzer: [] }
  let withCoupon = 0, capped = 0

  for (let i = 0; i < ITER; i++) {
    /* Prices: mostly ordinary, some tiny, some large, always 2 dp. */
    const fils = [int(1, 99), int(100, 99_999), int(100_000, 5_000_000), int(10_000, 300_000)][int(0, 3)]!
    const priceAED = fils / 100
    const course = await M.CourseModel.create({ instructorId: teacher._id, title: `C${i} “Ünïcode” & <b>`, slug: `c-${SEED}-${i}`, description: 'x',
      price: Math.max(1, Math.round(priceAED / 3.67)), priceAED, status: 'published', organizationId: org._id })

    /* Coupon: none, percent 1–100, or fixed — sometimes more than the price. */
    let code: string | undefined, expectFils = fils
    const kind = int(0, 2)
    if (kind > 0) {
      withCoupon++
      code = `P${SEED}X${i}`.slice(0, 20).toUpperCase()
      const pct = int(1, 100), fixedFils = int(1, Math.round(fils * 1.3) + 1)
      await M.CouponModel.create({ code, discountType: kind === 1 ? 'percent' : 'fixed', discountValue: kind === 1 ? pct : fixedFils / 100,
        currency: 'AED', maxUses: 0, usedCount: 0, isActive: true, appliesTo: [], organizationId: org._id } as any)
      const discount = Math.min(kind === 1 ? Math.round(fils * (pct / 100)) : fixedFils, fils)
      if (discount === fils) capped++
      expectFils = fils - discount
    }

    for (const g of ['tabby', 'tamara', 'abzer'] as const) {
      const u = await student()
      sent = []
      let orderId = '', err = ''
      try {
        const r = g === 'tabby' ? await svc.createTabbyOrder(String(u._id), String(course._id), course.slug, code)
          : g === 'tamara' ? await svc.createTamaraOrder(String(u._id), String(course._id), course.slug, code)
          : await svc.createAbzerOrder(String(u._id), String(course._id), course.slug, code)
        orderId = r.orderId
      } catch (e) { err = `${(e as any).code ?? ''} ${(e as Error).message}`.trim() }

      if (expectFils === 0) {
        /* A coupon worth the whole price. Recorded, judged below. */
        zeroOutcomes[g]!.push(err.startsWith('COUPON_COVERS_FULL_PRICE') && sent.length === 0 ? 'refused before any gateway call' : err ? `refused: ${err.slice(0, 70)}` : `CREATED a ${g} order for 0.00`)
        continue
      }
      if (err) { failures[g]!.push(`seed ${SEED} i=${i} ${priceAED} AED coupon=${kind}: threw ${err.slice(0, 90)}`); continue }

      const order: any = await M.OrderModel.findById(orderId).lean()
      const req = sent.find(s => (g === 'tabby' && s.path === '/api/v2/checkout' && s.body?.payment?.order) || (g === 'tamara' && s.path === '/checkout') || (g === 'abzer' && s.path.endsWith('/extended')))?.body
      const problems: string[] = []
      if (order?.amount !== expectFils) problems.push(`order ${order?.amount} ≠ expected ${expectFils}`)
      if (g === 'tabby') {
        const p = req?.payment
        if (toFils(p?.amount) !== order?.amount) problems.push(`sent ${p?.amount} ≠ order ${order?.amount}`)
        if (!twoDp(p?.amount)) problems.push(`amount "${p?.amount}" not 2 dp`)
        const items = p?.order?.items ?? []
        const lhs = sum(items.map((it: any) => toFils(it.unit_price) * Number(it.quantity ?? 1))) - toFils(p?.order?.discount_amount ?? 0) + toFils(p?.order?.shipping_amount ?? 0) + toFils(p?.order?.tax_amount ?? 0)
        if (lhs !== toFils(p?.amount)) problems.push(`items−discount ${lhs} ≠ amount ${toFils(p?.amount)}`)
      } else if (g === 'tamara') {
        const t = req?.total_amount
        if (toFils(t?.amount) !== order?.amount) problems.push(`sent ${t?.amount} ≠ order ${order?.amount}`)
        if (!twoDp(t?.amount)) problems.push(`amount ${t?.amount} not 2 dp`)
        const items = req?.items ?? []
        const lhs = sum(items.map((it: any) => toFils(it.total_amount?.amount))) - toFils(req?.discount?.amount?.amount ?? req?.discount?.amount ?? 0) + toFils(req?.shipping_amount?.amount ?? 0) + toFils(req?.tax_amount?.amount ?? 0)
        if (lhs !== toFils(t?.amount)) problems.push(`items−discount ${lhs} ≠ total ${toFils(t?.amount)}`)
        if (t?.currency !== 'AED') problems.push(`currency ${t?.currency}`)
      } else {
        if (toFils(req?.amount) !== order?.amount) problems.push(`sent ${req?.amount} ≠ order ${order?.amount}`)
        if (!twoDp(req?.amount)) problems.push(`amount ${req?.amount} not 2 dp`)
        if (req?.referenceNumber !== orderId) problems.push('referenceNumber is not the order')
      }
      if (problems.length) failures[g]!.push(`seed ${SEED} i=${i} price ${priceAED} coupon=${kind}: ${problems.join('; ')}`)
    }
  }

  section(`Random prices and coupons — ${ITER} cases per gateway (seed ${SEED}; ${withCoupon} with a coupon, ${capped} worth the whole price)`)
  for (const g of ['tabby', 'tamara', 'abzer'] as const) {
    const ran = ITER - zeroOutcomes[g]!.length
    check(`${g}: ${ran} charged orders — gateway amount = order = price − discount, breakdown adds up, 2 dp`, failures[g]!.length === 0, failures[g]!.slice(0, 3).join(' | '))
  }

  section('A coupon worth the whole price (order would be 0.00) — random draws + three fixed cases each')
  {
    const course = await M.CourseModel.create({ instructorId: teacher._id, title: 'Zero', slug: `zero-${SEED}`, description: 'x', price: 50, priceAED: 183.46, status: 'published', organizationId: org._id })
    const cases = [{ t: 'percent', v: 100, name: '100% off' }, { t: 'fixed', v: 183.46, name: 'fixed = price' }, { t: 'fixed', v: 500, name: 'fixed > price' }]
    for (const [ci, c] of cases.entries()) {
      for (const g of ['tabby', 'tamara', 'abzer'] as const) {
        const code = `Z${SEED}${ci}${g}`.slice(0, 20).toUpperCase()
        await M.CouponModel.create({ code, discountType: c.t, discountValue: c.v, currency: 'AED', maxUses: 1, usedCount: 0, isActive: true, appliesTo: [], organizationId: org._id } as any)
        const u = await student(); sent = []
        let err = ''
        try {
          if (g === 'tabby') await svc.createTabbyOrder(String(u._id), String(course._id), course.slug, code)
          else if (g === 'tamara') await svc.createTamaraOrder(String(u._id), String(course._id), course.slug, code)
          else await svc.createAbzerOrder(String(u._id), String(course._id), course.slug, code)
        } catch (e) { err = `${(e as any).code ?? ''}` }
        const coupon: any = await M.CouponModel.findOne({ code }).lean()
        const orders = await M.OrderModel.countDocuments({ userId: u._id })
        const ok = err === 'COUPON_COVERS_FULL_PRICE' && sent.filter(x => !x.path.includes('eligibility')).length === 0 && orders === 0 && coupon?.usedCount === 0
        zeroOutcomes[g]!.push(ok ? 'refused before any gateway call' : `${c.name}: err=${err} gatewayCalls=${sent.length} orders=${orders} usedCount=${coupon?.usedCount}`)
      }
    }
    for (const g of ['tabby', 'tamara', 'abzer'] as const) {
      const outs = zeroOutcomes[g]!
      check(`${g}: ${outs.length} full-price coupons — refused, no gateway call, no order, coupon slot given back`, outs.every(o => o === 'refused before any gateway call'), [...new Set(outs)].join(' · '))
    }
  }
} catch (err) {
  fail++; lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  globalThis.fetch = realFetch
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}
console.log(lines.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
