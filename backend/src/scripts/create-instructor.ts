/* ─────────────────────────────────────────────────────────────
   Create (or ensure) an instructor account in a given organisation.

   Written because the Bangalore org had zero instructors, so course copies had
   nothing to be parked on. A super-admin creating a user through the admin UI
   does not reliably stamp the target org (the super-admin carries no org of
   their own), so this sets organizationId explicitly and verifiably.

   The account is created WITHOUT a password — it cannot sign in until someone
   sends it through "Forgot password?" (or set-staff-password.ts). That is
   deliberate for a placeholder instructor that only needs to own draft courses
   until the real instructor is assigned.

   Idempotent: if the email already exists it reports the account and, with
   --apply, ensures role=instructor and the org is set — it never duplicates or
   overwrites a password.

   Report-only unless --apply.

   Usage (from backend/):
     bun src/scripts/create-instructor.ts --org=bangalore --name="Unassigned Instructor" --email=instructor@bangalore.delta
     …then add --apply
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const ORG   = (args.get('org') ?? '').toLowerCase()
const EMAIL = args.get('email')?.trim().toLowerCase()
const NAME  = args.get('name')?.trim()
const APPLY = args.has('apply')
const EMAIL_RE = /^[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

if (!ORG)                       { console.error('❌ --org=<slug> is required (e.g. bangalore).'); process.exit(1) }
if (!EMAIL || !EMAIL_RE.test(EMAIL)) { console.error('❌ --email=<valid email> is required.'); process.exit(1) }
if (!NAME)                      { console.error('❌ --name="Full Name" is required.'); process.exit(1) }

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
const { OrganizationModel, UserModel } = await import('@/models/schema.ts')

console.log('═'.repeat(60))
console.log(`  Mode:     ${APPLY ? 'APPLY' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Create instructor "${NAME}" <${EMAIL}> in org "${ORG}"`)
console.log('═'.repeat(60))

const org = await OrganizationModel.findOne({ slug: ORG }).select('_id name').lean()
if (!org) { console.error(`\n❌ No organisation with slug "${ORG}".`); await mongoose.disconnect(); process.exit(1) }

const existing = await UserModel.findOne({ email: EMAIL }).select('name email role organizationId').lean() as any
if (existing) {
  console.log(`\n  An account with this email already exists:`)
  console.log(`     name: ${existing.name} · role: ${existing.role} · org: ${existing.organizationId ?? 'none'}`)
  if (!APPLY) {
    console.log(`\n  With --apply it would be set to role=instructor and org=${ORG} (password untouched).\n`)
    await mongoose.disconnect(); process.exit(0)
  }
  await UserModel.updateOne({ _id: existing._id },
    { $set: { role: 'instructor', organizationId: org._id, isActive: true } })
  console.log(`\n  ✅ Ensured ${EMAIL} is an instructor in ${ORG}.\n`)
  await mongoose.disconnect(); process.exit(0)
}

if (!APPLY) {
  console.log(`\n  Would create a new instructor account:`)
  console.log(`     name : ${NAME}`)
  console.log(`     email: ${EMAIL}`)
  console.log(`     role : instructor · org: ${(org as any).name} (${ORG}) · no password (set later via Forgot password)`)
  console.log(`\n  Nothing was written. Add --apply to create it.\n`)
  await mongoose.disconnect(); process.exit(0)
}

const created = await UserModel.create({
  name: NAME, email: EMAIL, role: 'instructor',
  organizationId: org._id, isActive: true, isVerified: true,
})
console.log(`\n  ✅ Created instructor ${EMAIL} (id ${created._id}) in ${ORG}.`)
console.log(`     No password set — send them through "Forgot password?" if they need to sign in.\n`)

await mongoose.disconnect()
process.exit(0)
