/* ─────────────────────────────────────────────────────────────
   The Banglore CRM's students are Bangalore-academy students
   (POST /integrations/finance/enrolment → order.service provisionFinanceEnrolment).

   Over HTTP, against a real database, with finance's shared secret:
     A. a new student finance sends with crm "banglore" on a course the Dubai
        academy runs: created in the Bangalore organisation, the enrolment
        tagged "banglore", the order in INR as finance sent it;
     B. the other CRMs are unchanged: a new "delta" / no-CRM student takes the
        course's academy (Dubai), as before;
     C. an existing student of another academy (Dubai) buying through the
        Banglore CRM: enrolled and tagged, but left in Dubai — not moved;
     D. an existing student with no academy: put in Bangalore;
     E. an unknown CRM code is refused (422), nobody created.
   Run: bun --no-env-file src/tests/bangalorecrm.suite.ts
   (BANGALORECRM_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
import nodePathBoot from 'node:path'
import nodeOsBoot from 'node:os'

process.env.DATABASE_URL = process.env.BANGALORECRM_DATABASE_URL ?? 'mongodb://localhost:27017/lms_bangalorecrm_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.RATE_LIMIT_AUTH_MAX = '900'
process.env.RATE_LIMIT_API_MAX  = '9000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.RESEND_API_KEY = ''
process.env.EMAIL_FROM   = ''
process.env.EMAIL_LOG_DIR = nodePathBoot.join(nodeOsBoot.tmpdir(), `lms-bangalorecrm-mail-${process.pid}`)
process.env.R2_ACCOUNT_ID    = ''
process.env.R2_ACCESS_KEY_ID = ''
process.env.R2_BUCKET_NAME   = ''
process.env.DOTENV_CONFIG_PATH = '/nonexistent/bangalorecrm-suite.env'
process.env.JWT_ACCESS_SECRET  ??= 'bangalorecrm-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'bangalorecrm-suite-refresh-secret-0123456789'
const SECRET = 'bangalorecrm-suite-finance-secret-0123456789'
process.env.FINANCE_S2S_SECRET = SECRET

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const app = (await import('@/app.ts')).default
const { UserModel, OrganizationModel, CourseModel, EnrollmentModel, OrderModel } = await import('@/models/schema.ts')
await mongoose.connect(process.env.DATABASE_URL!)
const dbName = mongoose.connection.db!.databaseName
if (!/bangalorecrm/.test(dbName)) { console.error(`REFUSING TO RUN — ${dbName} is not the throwaway database`); process.exit(1) }
await mongoose.connection.dropDatabase()

const server = app.listen(0)
await new Promise<void>(r => server.once('listening', () => r()))
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`

const dubai = await OrganizationModel.create({ name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer' })
const bangalore = await OrganizationModel.create({ name: 'Bangalore Academy', slug: 'bangalore', currency: 'INR', paymentGateway: 'razorpay' })
const instructor = await new UserModel({ name: 'Instructor', email: 'instructor@t.local', role: 'instructor', organizationId: dubai._id }).save()
const course = await new CourseModel({
  instructorId: instructor._id,
  title: 'Market Break-out Trading Program', slug: 'mbt-suite', program: '4x-trading',
  organizationId: dubai._id, price: 1300, isPublished: true,
}).save()

let n = 0
async function enrol(email: string, crm?: string, extra: Record<string, unknown> = {}) {
  n++
  const res = await fetch(`${BASE}/integrations/finance/enrolment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-finance-secret': SECRET },
    body: JSON.stringify({
      email, name: `Student ${n}`, courseSlug: 'mbt-suite', invoiceId: `inv-suite-${n}`, invoiceNumber: `INV-${n}`,
      amountMinor: 15_000_000, currency: 'INR', paymentStatus: 'partial',
      ...(crm ? { crm } : {}), ...extra,
    }),
  })
  const text = await res.text()
  let body: any = text; try { body = JSON.parse(text) } catch {}
  return { status: res.status, body }
}
const userOf = (email: string) => UserModel.findOne({ email }).lean() as Promise<any>
const enrolmentOf = async (email: string) => {
  const u = await userOf(email)
  return u ? EnrollmentModel.findOne({ userId: u._id, courseId: course._id }).lean() as Promise<any> : null
}
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

step('A. A new Banglore CRM student')
{
  const r = await enrol('new.blr@t.local', 'banglore')
  check('taken', r.status === 200 && r.body?.data?.created === true, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  const u = await userOf('new.blr@t.local')
  check('created in the Bangalore organisation, though Dubai runs the course', same(u?.organizationId, bangalore._id), String(u?.organizationId))
  const e = await enrolmentOf('new.blr@t.local')
  check('enrolled on the course, tagged the Banglore CRM', e?.salesCrm === 'banglore', JSON.stringify(e?.salesCrm))
  const o = await OrderModel.findOne({ 'externalRef.id': 'inv-suite-1' }).lean() as any
  check('the order is in INR, as finance sent it', o?.currency === 'inr' && o?.amount === 15_000_000, JSON.stringify({ c: o?.currency, a: o?.amount }))
  const again = await enrol('new.blr@t.local', 'banglore', { invoiceId: 'inv-suite-1' })
  check('a retry of the same invoice changes nothing', again.body?.data?.alreadyProcessed === true && same((await userOf('new.blr@t.local'))?.organizationId, bangalore._id))
}

step('B. The other CRMs, unchanged')
{
  await enrol('new.delta@t.local', 'delta')
  await enrol('new.none@t.local')
  await enrol('new.remote@t.local', 'remote')
  check('a new Sales CRM student takes the course\'s academy (Dubai)', same((await userOf('new.delta@t.local'))?.organizationId, dubai._id))
  check('...so does one with no CRM', same((await userOf('new.none@t.local'))?.organizationId, dubai._id))
  check('...and a Remote CRM one', same((await userOf('new.remote@t.local'))?.organizationId, dubai._id))
  check('...tagged as before', (await enrolmentOf('new.remote@t.local'))?.salesCrm === 'remote' && !(await enrolmentOf('new.none@t.local'))?.salesCrm)
}

step('C. An existing Dubai student buys through the Banglore CRM')
{
  await UserModel.create({ name: 'Dubai Student', email: 'dubai.student@t.local', role: 'student', organizationId: dubai._id, enrollmentStatus: 'approved' } as never)
  const r = await enrol('dubai.student@t.local', 'banglore')
  check('taken, not a new account', r.status === 200 && r.body?.data?.created === false, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  check('left in Dubai — not moved to Bangalore', same((await userOf('dubai.student@t.local'))?.organizationId, dubai._id))
  check('...but enrolled, and the enrolment tagged the Banglore CRM', (await enrolmentOf('dubai.student@t.local'))?.salesCrm === 'banglore')
}

step('D. An existing student with no academy')
{
  await UserModel.create({ name: 'Nowhere Student', email: 'nowhere@t.local', role: 'student' } as never)
  await enrol('nowhere@t.local', 'banglore')
  check('put in Bangalore', same((await userOf('nowhere@t.local'))?.organizationId, bangalore._id))
}

step('E. An unknown CRM code')
{
  const r = await enrol('stranger@t.local', 'bangalore-typo')
  check('refused with a 422, nobody created', r.status === 422 && !(await userOf('stranger@t.local')), `${r.status}`)
}

server.close()
await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
