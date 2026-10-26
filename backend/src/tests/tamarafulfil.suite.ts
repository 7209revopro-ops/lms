/* ─────────────────────────────────────────────────────────────
   Tamara fulfilment against a real database, Tamara's API stubbed.
   tamara.suite.ts covers the client; this covers what happens to OUR order:
     · the return page and the order_approved webhook authorise at once —
       the second is refused, and must still end fulfilled, not "retry";
     · a genuinely refused authorise still says "retry";
     · the stuck-order sweep re-checks pending orders from 5 min to 72 h old;
     · the checkout carries Tamara's education risk block, dates dd-mm-yyyy.
   Usage (from backend/): bun --no-env-file src/tests/tamarafulfil.suite.ts
───────────────────────────────────────────────────────────── */
process.env.NODE_ENV           = 'test'
process.env.DATABASE_URL       = process.env.TAMARAFULFIL_DB_URL || 'mongodb://localhost:27017/lms_tamarafulfil_suite'
process.env.JWT_ACCESS_SECRET  = 'tamarafulfil-access-secret-tamarafulfil'
process.env.JWT_REFRESH_SECRET = 'tamarafulfil-refresh-secret-tamarafulfil'
process.env.TAMARA_API_KEY            = 'test-api-token'
process.env.TAMARA_NOTIFICATION_TOKEN = 'test-notification-token'
process.env.TAMARA_BASE_URL           = 'https://api-sandbox.tamara.co'
process.env.TAMARA_CURRENCY           = 'AED'
process.env.ENABLE_CRON               = 'false'
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_BACKUP_HOST', 'WHATSAPP_API_KEY', 'GOOGLE_CLIENT_ID', 'R2_ACCESS_KEY_ID', 'VAPID_PUBLIC_KEY']) process.env[k] = ''

import mongoose from 'mongoose'

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

/* ── Tamara stub: answers by path, records what we sent ── */
interface Call { url: string; method: string; body: any }
const realFetch = globalThis.fetch
let calls: Call[] = []
let route: (url: string, method: string, body: any) => { status: number; body: any } = () => ({ status: 200, body: {} })
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input), method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(init.body) : undefined
  calls.push({ url, method, body })
  const r = route(url, method, body)
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) } as any
}) as any

await mongoose.connect(process.env.DATABASE_URL!)
await mongoose.connection.db!.dropDatabase()

const M = await import('@/models/schema.ts')
const { OrderService, tamaraDay } = await import('@/services/order.service.ts')
const { runTamaraSweep } = await import('@/jobs/tamaraSweep.job.ts')

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'

try {
  const org = await M.OrganizationModel.create({ name: 'Dubai', slug: 'dubai', paymentGateway: 'abzer', currency: 'AED' } as any)
  const teacher = await M.UserModel.create({ name: 'Teacher', email: 'teacher@tf.local', role: 'instructor', isActive: true, isVerified: true, organizationId: org._id } as any)
  const course = await M.CourseModel.create({
    instructorId: teacher._id,
    title: 'Forex Foundations', slug: 'ff-tamara', description: 'x', price: 1000, priceAED: 1000,
    status: 'published', organizationId: org._id,
  })
  const mkStudent = (tag: string) => M.UserModel.create({
    name: `Student ${tag}`, email: `${tag}@tf.local`, role: 'student', isActive: true, isVerified: true,
    enrollmentStatus: 'approved', organizationId: org._id, phone: '+971501234567',
    enrollmentApplication: { homeCountry: 'United Arab Emirates', phone: '+971501234567', city: 'Dubai' },
  })
  const mkOrder = async (userId: unknown, tamaraOrderId: string, ageMs = 10 * 60_000) => {
    const at = new Date(Date.now() - ageMs)
    const { insertedId } = await mongoose.connection.db!.collection('orders').insertOne({
      userId, courseId: course._id, organizationId: org._id, gateway: 'tamara', status: 'pending',
      amount: 100_000, currency: 'AED', tamaraOrderId, createdAt: at, updatedAt: at,
    })
    return String(insertedId)
  }
  const tamaraOrder = (id: string, ref: string, status: string) => ({
    order_id: id, order_reference_id: ref, status, total_amount: { amount: 1000, currency: 'AED' },
  })
  const svc = new OrderService()

  /* ─────────────────────────────────────────────────────── */
  section('Authorise race — return page and webhook together')
  {
    const s = await mkStudent('race')
    const ours = await mkOrder(s._id, T1)
    /* Tamara first says approved; our authorise is refused (the other path got
       there first); asked again, it is authorised. */
    let reads = 0
    route = (url, method) => {
      if (url.endsWith(`/orders/${T1}`) && method === 'GET') return { status: 200, body: tamaraOrder(T1, ours, ++reads === 1 ? 'approved' : 'authorised') }
      if (url.endsWith(`/orders/${T1}/authorise`)) return { status: 409, body: { message: 'Order was already authorised' } }
      if (url.endsWith('/payments/capture')) return { status: 200, body: { capture_id: 'cap_1', status: 'fully_captured' } }
      return { status: 200, body: {} }
    }
    const out = await svc.fulfillTamaraFromWebhook(T1, ours)
    check('a refused authorise on an already-authorised order still fulfils', out === 'fulfilled', String(out))
    const o: any = await M.OrderModel.findById(ours).lean()
    check('the order is paid', o?.status === 'paid', String(o?.status))
    check('the student is enrolled', !!(await M.EnrollmentModel.findOne({ userId: s._id, courseId: course._id })))
  }

  /* ─────────────────────────────────────────────────────── */
  section('A real authorise failure still asks for a retry')
  {
    const s = await mkStudent('refused')
    const ours = await mkOrder(s._id, T2)
    route = (url, method) => {
      if (url.endsWith(`/orders/${T2}`) && method === 'GET') return { status: 200, body: tamaraOrder(T2, ours, 'approved') }
      if (url.endsWith(`/orders/${T2}/authorise`)) return { status: 500, body: { message: 'boom' } }
      return { status: 200, body: {} }
    }
    const out = await svc.fulfillTamaraFromWebhook(T2, ours)
    check('still approved after a refused authorise → retry', out === 'retry', String(out))
    const o: any = await M.OrderModel.findById(ours).lean()
    check('the order stays pending', o?.status === 'pending', String(o?.status))
  }

  /* ─────────────────────────────────────────────────────── */
  section('Stuck-order sweep — 5 minutes to 72 hours')
  {
    const s = await mkStudent('sweep')
    const due    = await mkOrder(s._id, T3, 30 * 60_000)
    const young  = await mkOrder(s._id, '44444444-4444-4444-8444-444444444444', 60_000)
    const stale  = await mkOrder(s._id, '55555555-5555-4555-8555-555555555555', 80 * 3_600_000)
    void young; void stale
    calls = []
    route = (url, method) => {
      if (url.endsWith(`/orders/${T3}`) && method === 'GET') return { status: 200, body: tamaraOrder(T3, due, 'approved') }
      if (url.endsWith(`/orders/${T3}/authorise`)) return { status: 200, body: { status: 'authorised' } }
      if (url.endsWith('/payments/capture')) return { status: 200, body: { capture_id: 'cap_3' } }
      if (/\/orders\/[0-9a-f-]+$/.test(url)) return { status: 200, body: tamaraOrder(url.split('/').pop()!, '', 'new') }
      return { status: 200, body: {} }
    }
    /* T2 above is pending and 10 min old too — it is in the window. */
    const r = await runTamaraSweep()
    const looked = new Set(calls.filter(c => c.method === 'GET').map(c => c.url.split('/').pop()))
    check('the due order is checked', looked.has(T3))
    check('an order under 5 minutes old is left alone', !looked.has('44444444-4444-4444-8444-444444444444'))
    check('an order past 72 hours is left alone', !looked.has('55555555-5555-4555-8555-555555555555'))
    check('the due order is recovered', r.fulfilled >= 1 && (await M.OrderModel.findById(due).lean() as any)?.status === 'paid',
      JSON.stringify(r))
  }

  /* ─────────────────────────────────────────────────────── */
  section('Sweep — expired at Tamara closes our order; round-robin, never starved')
  {
    await mongoose.connection.db!.collection('orders').updateMany({ status: 'pending' }, { $set: { status: 'cancelled' } })
    const s = await mkStudent('sweep2')
    const expiredId = '77777777-7777-4777-8777-777777777777'
    const exp = await mkOrder(s._id, expiredId, 40 * 60_000)
    const stale = await Promise.all([...Array(55)].map((_, i) => mkOrder(s._id, `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`, 50 * 60_000 + i * 60_000)))
    const paidId = '99999999-9999-4999-8999-999999999999'
    const paid = await mkOrder(s._id, paidId, 20 * 60_000)
    route = (url, method) => {
      const id = url.split('/').filter(Boolean).slice(-1)[0]!
      if (url.endsWith(`/orders/${expiredId}`) && method === 'GET') return { status: 200, body: tamaraOrder(expiredId, exp, 'expired') }
      if (url.endsWith(`/orders/${paidId}`) && method === 'GET') return { status: 200, body: tamaraOrder(paidId, paid, 'approved') }
      if (url.endsWith(`/orders/${paidId}/authorise`)) return { status: 200, body: { status: 'authorised' } }
      if (url.endsWith('/payments/capture')) return { status: 200, body: { capture_id: 'cap_x' } }
      if (/\/orders\/[0-9a-f-]+$/.test(url) && method === 'GET') {
        const ref = stale[Number(id.slice(-12))]
        return { status: 200, body: tamaraOrder(id, ref ?? '', 'new') }
      }
      return { status: 200, body: {} }
    }
    await runTamaraSweep()
    check('an order Tamara has EXPIRED is cancelled on our side', (await M.OrderModel.findById(exp).lean() as any)?.status === 'cancelled')
    check('the newer paid order is recovered despite 55 older pending ones', (await M.OrderModel.findById(paid).lean() as any)?.status === 'paid')
    await runTamaraSweep()
    const reached = await mongoose.connection.db!.collection('orders').countDocuments({ _id: { $in: stale.map(id => new mongoose.Types.ObjectId(id)) }, gatewayCheckedAt: { $exists: true } })
    check('two sweeps reach every pending order (round-robin)', reached === 55, `${reached}/55`)
  }

  /* ─────────────────────────────────────────────────────── */
  section('Checkout payload — Tamara education risk block')
  {
    const s = await mkStudent('payload')
    const start = new Date(Date.now() + 3 * 86_400_000), end = new Date(Date.now() + 40 * 86_400_000)
    await M.LiveClassModel.create([
      { title: 'A', instructorId: teacher._id, courseId: course._id, organizationId: org._id, scheduledStart: start, durationMins: 60, type: 'external', status: 'scheduled', isOnline: true },
      { title: 'B', instructorId: teacher._id, courseId: course._id, organizationId: org._id, scheduledStart: end, durationMins: 60, type: 'external', status: 'scheduled', isOnline: false },
    ] as any)
    calls = []
    route = (url) => url.endsWith('/checkout')
      ? { status: 200, body: { checkout_id: 'chk', order_id: '66666666-6666-4666-8666-666666666666', checkout_url: 'https://checkout.tamara.co/x' } }
      : { status: 200, body: {} }
    await svc.createTamaraOrder(String(s._id), String(course._id), 'ff-tamara', undefined, { isMobile: true })
    const body = calls.find(c => c.url.endsWith('/checkout'))?.body
    const risk = body?.risk_assessment
    check('account_creation_date is dd-mm-yyyy', /^\d{2}-\d{2}-\d{4}$/.test(risk?.account_creation_date ?? ''), risk?.account_creation_date)
    check('a first order sends null paid dates', risk?.date_first_paid === null && risk?.date_last_paid === null)
    check('education.start_date is the first class ahead', risk?.education?.start_date === tamaraDay(start), risk?.education?.start_date)
    check('education.end_date is the last class ahead', risk?.education?.end_date === tamaraDay(end), risk?.education?.end_date)
    check('online and in-person classes read Hybrid', risk?.education?.event_location === 'Hybrid', risk?.education?.event_location)
    check('a course is a one-time course purchase',
      risk?.education?.education_type === 'course' && risk?.education?.purchase_type === 'One-time')
    check('is_mobile travels from the request', body?.is_mobile === true)
  }
} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  globalThis.fetch = realFetch
  await mongoose.connection.db?.dropDatabase().catch(() => {})
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
