/* ─────────────────────────────────────────────────────────────
   The digest's grouping invariant, over many random shapes.

   digest.suite.ts checks the scenarios somebody wrote down. This one checks
   the rule underneath all of them, against queues it did not design:

     for any set of queued events, one flush sends each student with at least
     one pending row EXACTLY ONE email containing EXACTLY their own rows —
     no row delivered twice, none delivered to the wrong person, none left
     behind, and no mail at all for a student with nothing queued.

   Randomised over student counts and per-student item counts (including
   zero), with a fixed seed so a failure is reproducible.

   Run: bun run test:digest-prop
───────────────────────────────────────────────────────────── */
process.env.DATABASE_URL = 'mongodb://localhost:27017/lms_digestprop_suite'
process.env.NODE_ENV     = 'test'
process.env.PORT         = '0'
process.env.EMAIL_OUTBOX = 'on'
process.env.CLIENT_URL   = 'http://localhost:3000'
process.env.SMTP_HOST    = ''
process.env.SMTP_USER    = ''
process.env.SMTP_PASS    = ''
process.env.R2_ACCOUNT_ID        = ''
process.env.R2_ACCESS_KEY_ID     = ''
process.env.R2_SECRET_ACCESS_KEY = ''
process.env.R2_PUBLIC_URL        = ''

export {}

let pass = 0, fail = 0
const lines: string[] = []
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; lines.push(`  PASS  ${label}`) }
  else    { fail++; lines.push(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
function section(n: string) { lines.push(`\n${n}`) }

const mongoose = (await import('mongoose')).default
mongoose.set('autoIndex', false)
const {
  UserModel, OrganizationModel, DigestQueueModel, EmailOutboxModel,
} = await import('@/models/schema.ts')
const { hashPassword } = await import('@/utils/hash.ts')
const { runDailyDigest, queueDigestItem } = await import('@/jobs/digest.job.ts')

await mongoose.connect(process.env.DATABASE_URL!)
if (mongoose.connection.db!.databaseName !== 'lms_digestprop_suite') {
  console.error('REFUSING TO RUN — not the throwaway database'); process.exit(1)
}
await mongoose.connection.db!.dropDatabase()

/* Deterministic PRNG: a failure here must be reproducible, and Math.random
   would make "it passed last time" meaningless. */
let seed = 20260915
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

try {

const org = await OrganizationModel.create({
  name: 'Dubai Academy', slug: 'dubai', currency: 'AED', paymentGateway: 'abzer',
})
const hash = await hashPassword('Prop1x')

let uid = 0

for (const round of [1, 2, 3, 4, 5]) {
  section(`Round ${round}`)

  const studentCount = between(2, 6)
  const expected = new Map<string, string[]>()   // email -> its own item markers
  const people: any[] = []

  for (let i = 0; i < studentCount; i++) {
    const u = await UserModel.create({
      name: `S${uid}`, email: `p${uid}@dp.local`, passwordHash: hash,
      role: 'student', isActive: true, isVerified: true,
      enrollmentStatus: 'approved', organizationId: org._id,
    })
    uid++
    people.push(u)

    /* Deliberately includes 0 — a student with nothing queued must get no
       mail at all, which is the rule easiest to break by looping over users
       instead of over pending rows. */
    const itemCount = between(0, 4)
    const marks: string[] = []
    for (let k = 0; k < itemCount; k++) {
      const mark = `R${round}-U${i}-I${k}`
      marks.push(mark)
      await queueDigestItem({
        userId: String(u._id), kind: 'new-session',
        title: `Update ${mark}`, body: `body ${mark}`,
      })
    }
    expected.set(u.email, marks)
  }

  const withItems = [...expected.values()].filter(v => v.length > 0).length
  const totalItems = [...expected.values()].reduce((a, b) => a + b.length, 0)

  const before = new Map<string, number>()
  for (const u of people) {
    before.set(u.email, await EmailOutboxModel.countDocuments({ to: u.email }))
  }

  const tally = await runDailyDigest()
  await new Promise(r => setTimeout(r, 900))

  check(`R${round} the flush reports ${withItems} student(s) and ${totalItems} item(s)`,
    tally.students === withItems && tally.items === totalItems,
    `${JSON.stringify(tally)} expected {students:${withItems},items:${totalItems}}`)

  let mailErrors: string[] = []
  for (const u of people) {
    const marks = expected.get(u.email) ?? []
    const gained = (await EmailOutboxModel.countDocuments({ to: u.email })) - (before.get(u.email) ?? 0)

    if (marks.length === 0) {
      if (gained !== 0) mailErrors.push(`${u.email}: empty queue but gained ${gained} mail`)
      continue
    }
    if (gained !== 1) { mailErrors.push(`${u.email}: expected 1 mail, gained ${gained}`); continue }

    const mail = await EmailOutboxModel.findOne({ to: u.email }).sort({ createdAt: -1 }).lean() as any
    const html = String(mail?.html ?? '')

    /* Every one of their own items present … */
    const missing = marks.filter(m => !html.includes(m))
    if (missing.length) mailErrors.push(`${u.email}: missing ${missing.join(',')}`)

    /* … and nobody else's. Cross-contamination is the failure a per-user
       loop over a shared row list produces, and it is invisible unless
       checked from the other direction. */
    const foreign = [...expected.entries()]
      .filter(([em]) => em !== u.email)
      .flatMap(([, ms]) => ms)
      .filter(m => html.includes(m))
    if (foreign.length) mailErrors.push(`${u.email}: contains foreign ${foreign.slice(0, 3).join(',')}`)
  }

  check(`R${round} every student got exactly their own items, and only those`,
    mailErrors.length === 0, mailErrors.slice(0, 3).join(' | '))

  const leftPending = await DigestQueueModel.countDocuments({ sentAt: null })
  check(`R${round} nothing is left pending after the flush`,
    leftPending === 0, String(leftPending))
}

} catch (err) {
  fail++
  lines.push(`  FAIL  suite threw — ${(err as Error).message}\n${(err as Error).stack}`)
} finally {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

console.log(lines.join('\n'))
console.log(`\ndigest.property.suite — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
