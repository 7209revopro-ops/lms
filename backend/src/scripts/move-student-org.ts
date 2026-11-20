/* ─────────────────────────────────────────────────────────────
   Move ONE student's account to a different academy (organizationId).

   Why this exists: the admin dashboard has no "change academy" control for
   an existing user — userUpdateSchema (PATCH /admin/users/:id) does not
   accept organizationId, only creation does. When a student was mis-assigned
   at signup (wrong organizationSlug on the register call, or an admin picked
   the wrong academy while approving), the only way to correct it today is
   directly in the database.

   What it changes:
     - User.organizationId              (their account's home academy)
     - Enrollment.organizationId        (one row per course they're enrolled
                                          in — kept in sync with the user so
                                          course/booking org-scoping agrees)

   What it deliberately does NOT touch: Order, Certificate, SupportTicket,
   AuditLog, and other historical records that carry organizationId. Those
   are point-in-time facts (an order was placed, a certificate was issued,
   under whatever academy was true then) — rewriting them would falsify
   history rather than correct a mistake. Say so if that turns out to be
   wrong for this case.

   Report-only by default; --apply performs the change.

   Usage (from backend/):
     bun src/scripts/move-student-org.ts --email=someone@example.com --to=dubai
     …then re-run with --apply

   Several at once (2026-11-20, the DUBAI-STUD backfill — finance's
   backfill:dubai-stud prints this command filled in):
     bun src/scripts/move-student-org.ts --emails=a@example.com,b@example.com --to=dubai
   Each is reported (and, with --apply, moved) on its own; one that can't be
   moved — no account, not a student — is said and skipped, the rest go on.
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const EMAILS = [...new Set([args.get('email') ?? '', ...(args.get('emails') ?? '').split(',')]
  .map((e) => e.trim().toLowerCase()).filter(Boolean))]
const TO    = (args.get('to') ?? '').trim().toLowerCase()
const APPLY = args.has('apply')

if (!EMAILS.length) { console.error('❌ --email=<student email> (or --emails=a,b,…) is required.'); process.exit(1) }
if (!TO)    { console.error('❌ --to=<dubai|bangalore> is required.'); process.exit(1) }
if (!['dubai', 'bangalore'].includes(TO)) {
  console.error(`❌ --to must be "dubai" or "bangalore", got "${TO}".`); process.exit(1)
}

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const dbName = mongoose.connection.db!.databaseName
const { UserModel, OrganizationModel, EnrollmentModel } = await import('@/models/schema.ts')

console.log('═'.repeat(64))
console.log(`  Mode:     ${APPLY ? 'APPLY' : 'REPORT ONLY'}`)
console.log(`  Database: ${dbName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Students: ${EMAILS.length === 1 ? EMAILS[0] : `${EMAILS.length}`}`)
console.log(`  Move to:  ${TO}`)
console.log('═'.repeat(64))

const targetOrg = await OrganizationModel.findOne({ slug: TO }).select('name slug').lean()
if (!targetOrg) {
  console.error(`\n❌ No organization with slug "${TO}" exists.`)
  await mongoose.disconnect(); process.exit(1)
}

type Outcome = 'moved' | 'would move' | 'already there' | 'refused'
const outcomes: Array<{ email: string; outcome: Outcome; from: string }> = []

for (const EMAIL of EMAILS) {
  console.log(`\n── ${EMAIL}`)
  const user = await UserModel.findOne({ email: EMAIL })
    .select('name email role organizationId enrollmentStatus').lean()
  if (!user) {
    console.error(`  ❌ No account found for ${EMAIL}. Nothing was changed for them.`)
    outcomes.push({ email: EMAIL, outcome: 'refused', from: '' }); continue
  }
  if (user.role !== 'student') {
    console.error(`  ❌ ${EMAIL} has role "${user.role}", not "student". Refused — this script is for student accounts.`)
    outcomes.push({ email: EMAIL, outcome: 'refused', from: '' }); continue
  }

  const currentOrgId = (user as { organizationId?: mongoose.Types.ObjectId }).organizationId ?? null
  const currentOrg = currentOrgId
    ? await OrganizationModel.findById(currentOrgId).select('name slug').lean()
    : null
  const from = currentOrg?.slug ?? ''

  console.log('  BEFORE')
  console.log(`    name             : ${user.name}`)
  console.log(`    enrollmentStatus : ${(user as { enrollmentStatus?: string }).enrollmentStatus ?? '(unset)'}`)
  console.log(`    organizationId   : ${currentOrgId ?? '(none — visible to every academy)'}`)
  console.log(`    academy          : ${currentOrg ? `${currentOrg.name} (${currentOrg.slug})` : '(unassigned)'}`)

  if (currentOrgId && String(currentOrgId) === String(targetOrg._id)) {
    console.log(`  Already on ${targetOrg.name} (${targetOrg.slug}). Nothing to do.`)
    outcomes.push({ email: EMAIL, outcome: 'already there', from }); continue
  }

  const enrollments = await EnrollmentModel.find({ userId: user._id })
    .select('courseId organizationId').lean()

  console.log('  ENROLLMENTS')
  if (enrollments.length === 0) {
    console.log('    (none)')
  } else {
    for (const e of enrollments) {
      const eOrgId = (e as { organizationId?: mongoose.Types.ObjectId }).organizationId
      console.log(`    course ${e.courseId}  organizationId: ${eOrgId ?? '(none)'}${eOrgId && String(eOrgId) === String(targetOrg._id) ? '  (already correct)' : ''}`)
    }
  }

  console.log('  WILL SET')
  console.log(`    User.organizationId -> ${targetOrg._id}  (${targetOrg.name})`)
  if (enrollments.length > 0) {
    console.log(`    Enrollment.organizationId -> ${targetOrg._id}  for all ${enrollments.length} enrollment row(s) above`)
  }

  if (!APPLY) { outcomes.push({ email: EMAIL, outcome: 'would move', from }); continue }

  await UserModel.updateOne({ _id: user._id }, { $set: { organizationId: targetOrg._id } })
  if (enrollments.length > 0) {
    await EnrollmentModel.updateMany({ userId: user._id }, { $set: { organizationId: targetOrg._id } })
  }
  const after = await UserModel.findById(user._id).select('organizationId').lean()
  console.log(`  AFTER: organizationId ${after?.organizationId} — ${targetOrg.name} (${targetOrg.slug})`)
  outcomes.push({ email: EMAIL, outcome: 'moved', from })
}

console.log('\n' + '═'.repeat(64))
for (const o of ['moved', 'would move', 'already there', 'refused'] as const) {
  const n = outcomes.filter((x) => x.outcome === o).length
  if (n) console.log(`  ${o.padEnd(14)} ${n}`)
}
if (!APPLY && outcomes.some((x) => x.outcome === 'would move')) console.log('\n  Nothing changed. Re-run with --apply to make the change.')
// To put them back: the same command, each to where they came from.
const back = new Map<string, string[]>()
for (const o of outcomes.filter((x) => x.outcome === 'moved' && x.from)) back.set(o.from, [...(back.get(o.from) ?? []), o.email])
if (back.size) {
  console.log('\n  To undo:')
  for (const [slug, emails] of back) console.log(`    bun src/scripts/move-student-org.ts --emails=${emails.join(',')} --to=${slug} --apply`)
}
console.log('')

await mongoose.disconnect()
process.exit(outcomes.some((x) => x.outcome === 'refused') ? 2 : 0)
