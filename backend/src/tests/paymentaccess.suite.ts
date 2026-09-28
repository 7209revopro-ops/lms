/* ─────────────────────────────────────────────────────────────
   Payment access — which modules a finance enrolment opens.

   Paid opens every module, partial the first half (rounded up), unpaid none.
   Pinned here, against a real database and the real module service:

     A. the rule itself, including odd module counts;
     B. a later payment only ever opens — never re-locks;
     C. a module added to the course keeps part-payers to their half: the new
        one is locked past the half, and the half grows when it should;
     D. enrolments the rule does not govern are never touched.

   The finance → LMS round trip is proven from the finance side
   (finance-delta scripts/lms-provision-e2e.sh); this is the LMS half.

   Run: bun --no-env-file src/tests/paymentaccess.suite.ts
   (PAYMENTACCESS_DATABASE_URL to point it at a throwaway mongod.)
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = process.env.PAYMENTACCESS_DATABASE_URL ?? 'mongodb://localhost:27017/lms_paymentaccess'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.SMTP_BACKUP_HOST = ''
process.env.SMTP_BACKUP_USER = ''
process.env.SMTP_BACKUP_PASS = ''
process.env.EMAIL_FROM   = ''
process.env.JWT_ACCESS_SECRET  ??= 'paymentaccess-suite-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'paymentaccess-suite-refresh-secret-0123456789'

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ''}\x1b[0m`) }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`)

const mongoose = (await import('mongoose')).default
const { CourseModel, SectionModel, EnrollmentModel, UserModel } = await import('@/models/schema.ts')
const { openModuleCount, applyInitialPaymentAccess, raisePaymentAccess } = await import('@/services/paymentAccess.service.ts')
const { SectionService } = await import('@/services/section.service.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (!['127.0.0.1', 'localhost'].includes(mongoose.connection.host) || mongoose.connection.db!.databaseName !== 'lms_paymentaccess') {
  console.error(`REFUSING TO RUN — not the throwaway database (${mongoose.connection.host}/${mongoose.connection.db!.databaseName})`)
  process.exit(1)
}
await mongoose.connection.dropDatabase()

const blocked = async (id: unknown) =>
  ((await EnrollmentModel.findById(id).lean())?.blockedLessons ?? []).map(String).sort().join(',')
const ids = (list: string[]) => [...list].sort().join(',')

step('A. The rule')
check('paid, 10 modules: all 10', openModuleCount('paid', 10) === 10)
check('partial, 10 modules: 5', openModuleCount('partial', 10) === 5)
check('partial, 7 modules: 4 (rounded up)', openModuleCount('partial', 7) === 4)
check('partial, 1 module: 1', openModuleCount('partial', 1) === 1)
check('unpaid: none', openModuleCount('unpaid', 10) === 0)

// Raw rows: this is about access, not about what makes a valid course or student.
const courseId = (await CourseModel.collection.insertOne({
  title: 'Delta Wave Theory Trading Programme', slug: 'dwt-paymentaccess', price: 4500, status: 'published',
  createdAt: new Date(), updatedAt: new Date(),
})).insertedId
const course = { _id: courseId }
const modules: string[] = []
for (let i = 0; i < 10; i++) {
  const s = await SectionModel.create({ courseId: course._id, title: `Module ${i + 1}`, order: i })
  modules.push(String(s._id))
}
const student = async (email: string) =>
  (await UserModel.collection.insertOne({ name: email, email, role: 'student', createdAt: new Date(), updatedAt: new Date() })).insertedId
const enrol = async (email: string, source: 'purchase' | 'admin' = 'purchase') =>
  EnrollmentModel.create({ userId: await student(email), courseId: course._id, source, status: 'active' })

const ananya = await enrol('ananya@paymentaccess.test')
const sara   = await enrol('sara@paymentaccess.test')
const rahul  = await enrol('rahul@paymentaccess.test')
const manual = await enrol('manual@paymentaccess.test', 'admin')
await applyInitialPaymentAccess(ananya._id, course._id, 'partial', 'inv-ananya')
await applyInitialPaymentAccess(sara._id,   course._id, 'unpaid',  'inv-sara')
await applyInitialPaymentAccess(rahul._id,  course._id, 'paid',    'inv-rahul')
check('partial: modules 6–10 locked', await blocked(ananya._id) === ids(modules.slice(5)))
check('unpaid: all 10 locked', await blocked(sara._id) === ids(modules))
check('paid: nothing locked', await blocked(rahul._id) === '')

step('B. Only ever opens')
let r = await raisePaymentAccess(ananya._id, 'partial')
check('partial again changes nothing', r?.changed === false && await blocked(ananya._id) === ids(modules.slice(5)))
r = await raisePaymentAccess(ananya._id, 'unpaid')
check('a lower status changes nothing', r?.changed === false && await blocked(ananya._id) === ids(modules.slice(5)))
r = await raisePaymentAccess(sara._id, 'partial')
check('unpaid → partial opens the first half', r?.changed === true && await blocked(sara._id) === ids(modules.slice(5)))
r = await raisePaymentAccess(manual._id, 'paid')
check('an enrolment made another way is left alone', r?.changed === false && await blocked(manual._id) === '')

step('C. A module added later')
const added = await new SectionService().create({ courseId: String(course._id), title: 'Module 11' } as never)
const eleven = [...modules, String(added._id)]
check('partial: half of 11 is 6, so module 6 opens and module 11 arrives locked',
  await blocked(ananya._id) === ids(eleven.slice(6)), await blocked(ananya._id))
check('paid: module 11 arrives open', await blocked(rahul._id) === '')
check('an enrolment made another way is not touched', await blocked(manual._id) === '')

step('B again. Paid opens everything')
await EnrollmentModel.updateOne({ _id: ananya._id }, { $addToSet: { blockedLessons: new mongoose.Types.ObjectId(eleven[1]) } })
r = await raisePaymentAccess(ananya._id, 'paid')
check('paid in full: every module open, including one an admin had locked', r?.changed === true && await blocked(ananya._id) === '')
check('...and it stays paid', (await EnrollmentModel.findById(ananya._id).lean())?.paymentAccess?.status === 'paid')

await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

export {}
