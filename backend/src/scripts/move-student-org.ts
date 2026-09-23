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
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const EMAIL = (args.get('email') ?? '').trim().toLowerCase()
const TO    = (args.get('to') ?? '').trim().toLowerCase()
const APPLY = args.has('apply')

if (!EMAIL) { console.error('❌ --email=<student email> is required.'); process.exit(1) }
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
console.log(`  Student:  ${EMAIL}`)
console.log(`  Move to:  ${TO}`)
console.log('═'.repeat(64))

const user = await UserModel.findOne({ email: EMAIL })
  .select('name email role organizationId enrollmentStatus').lean()
if (!user) {
  console.error(`\n❌ No account found for ${EMAIL}. Nothing was changed.`)
  await mongoose.disconnect(); process.exit(1)
}
if (user.role !== 'student') {
  console.error(`\n❌ ${EMAIL} has role "${user.role}", not "student". Refusing — this script is for student accounts.`)
  await mongoose.disconnect(); process.exit(1)
}

const targetOrg = await OrganizationModel.findOne({ slug: TO }).select('name slug').lean()
if (!targetOrg) {
  console.error(`\n❌ No organization with slug "${TO}" exists.`)
  await mongoose.disconnect(); process.exit(1)
}

const currentOrgId = (user as { organizationId?: mongoose.Types.ObjectId }).organizationId ?? null
const currentOrg = currentOrgId
  ? await OrganizationModel.findById(currentOrgId).select('name slug').lean()
  : null

console.log('\n  BEFORE')
console.log(`    name             : ${user.name}`)
console.log(`    email            : ${user.email}`)
console.log(`    enrollmentStatus : ${(user as { enrollmentStatus?: string }).enrollmentStatus ?? '(unset)'}`)
console.log(`    organizationId   : ${currentOrgId ?? '(none — visible to every academy)'}`)
console.log(`    academy          : ${currentOrg ? `${currentOrg.name} (${currentOrg.slug})` : '(unassigned)'}`)

if (currentOrgId && String(currentOrgId) === String(targetOrg._id)) {
  console.log(`\n  Already on ${targetOrg.name} (${targetOrg.slug}). Nothing to do.\n`)
  await mongoose.disconnect(); process.exit(0)
}

const enrollments = await EnrollmentModel.find({ userId: user._id })
  .select('courseId organizationId').lean()

console.log('\n  ENROLLMENTS')
if (enrollments.length === 0) {
  console.log('    (none)')
} else {
  for (const e of enrollments) {
    const eOrgId = (e as { organizationId?: mongoose.Types.ObjectId }).organizationId
    console.log(`    course ${e.courseId}  organizationId: ${eOrgId ?? '(none)'}${eOrgId && String(eOrgId) === String(targetOrg._id) ? '  (already correct)' : ''}`)
  }
}

console.log('\n  WILL SET')
console.log(`    User.organizationId -> ${targetOrg._id}  (${targetOrg.name})`)
if (enrollments.length > 0) {
  console.log(`    Enrollment.organizationId -> ${targetOrg._id}  for all ${enrollments.length} enrollment row(s) above`)
}

if (!APPLY) {
  console.log('\n  Nothing changed. Re-run with --apply to make the change.\n')
  await mongoose.disconnect(); process.exit(0)
}

await UserModel.updateOne({ _id: user._id }, { $set: { organizationId: targetOrg._id } })
if (enrollments.length > 0) {
  await EnrollmentModel.updateMany({ userId: user._id }, { $set: { organizationId: targetOrg._id } })
}

const after = await UserModel.findById(user._id).select('name email organizationId').lean()
console.log('\n  AFTER')
console.log(`    organizationId   : ${after?.organizationId}`)
console.log(`    academy          : ${targetOrg.name} (${targetOrg.slug})`)
console.log('\n  Done.\n')

await mongoose.disconnect()
process.exit(0)
