/* ─────────────────────────────────────────────────────────────
   Set a NEW password for ONE staff account, admin-side.

   An existing password can never be read — it is stored as a one-way bcrypt
   hash. What an admin CAN do is overwrite it with a value they choose, which
   is what this does. The new password works on both the admin panel and the
   student site, because a person is one user record.

   Guard rails, because this overwrites a credential:
     · one email at a time, and it must resolve to exactly one account
     · STAFF ONLY — refuses role 'student' (students reset via the portal)
     · the new password must satisfy the same rules the login enforces
       (>= 8 chars, an uppercase letter, a number), so the account it sets
       is one the user can actually sign in with
     · report-only unless --apply is given
     · after setting, it revokes the account's existing sessions, so any
       stale login elsewhere cannot continue on the old credential

   Usage (from backend/):
     bun src/scripts/set-staff-password.ts --email=kiran@x.com --password='NewPass123'
     bun src/scripts/set-staff-password.ts --email=kiran@x.com --password='NewPass123' --apply
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}
const EMAIL    = (args.get('email') ?? '').trim().toLowerCase()
const PASSWORD = args.get('password') ?? ''
const APPLY    = args.has('apply')

if (!EMAIL)    { console.error('❌ --email=<staff email> is required.'); process.exit(1) }
if (!PASSWORD) { console.error('❌ --password=<new password> is required.'); process.exit(1) }

/* Mirror the register/reset schema so we never set a password the login rules
   would then reject. */
const problems: string[] = []
if (PASSWORD.length < 8)     problems.push('at least 8 characters')
if (!/[A-Z]/.test(PASSWORD)) problems.push('an uppercase letter')
if (!/[0-9]/.test(PASSWORD)) problems.push('a number')
if (problems.length) {
  console.error(`❌ That password would be rejected at login. It still needs: ${problems.join(', ')}.`)
  process.exit(1)
}

const STAFF = ['super_admin', 'admin', 'sub_admin', 'support', 'instructor']

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
const { UserModel } = await import('@/models/schema.ts')

console.log('═'.repeat(62))
console.log(`  Mode:     ${APPLY ? 'APPLY — the password will be changed' : 'REPORT ONLY'}`)
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Account:  ${EMAIL}`)
console.log('═'.repeat(62))

const user = await UserModel.findOne({ email: EMAIL })
  .select('+passwordHash name email role isActive').lean() as Record<string, any> | null

if (!user) {
  console.error(`\n❌ No account with that email. Nothing changed.`)
  await mongoose.disconnect(); process.exit(1)
}
if (!STAFF.includes(user.role)) {
  console.error(`\n❌ ${EMAIL} is a "${user.role}", not staff. This script is for staff accounts only;`)
  console.error(`   a student sets their own password through "Forgot password?" on the site.`)
  await mongoose.disconnect(); process.exit(1)
}

console.log(`\n  name        : ${user.name}`)
console.log(`  role        : ${user.role}`)
console.log(`  active      : ${user.isActive}`)
console.log(`  has password: ${user.passwordHash ? 'yes — it will be REPLACED' : 'no — one will be SET'}`)
console.log(`  new password: ${PASSWORD}`)

if (!APPLY) {
  console.log(`\n  Nothing changed. Re-run the same command with --apply to set it.\n`)
  await mongoose.disconnect(); process.exit(0)
}

const passwordHash = await bcrypt.hash(PASSWORD, 12)
await UserModel.updateOne(
  { _id: user._id },
  { $set: { passwordHash }, $unset: { lockedUntil: '', failedLoginAttempts: '' } },
)

/* Kill any live sessions so an old, still-signed-in browser somewhere cannot
   keep going on the credential we just replaced. */
const { RefreshTokenModel } = await import('@/models/schema.ts')
const revoked = await RefreshTokenModel.updateMany(
  { userId: user._id, isRevoked: { $ne: true } },
  { $set: { isRevoked: true, revokedReason: 'security' } },
)

console.log(`\n  ✅ Password set for ${EMAIL}.`)
console.log(`     ${revoked.modifiedCount} existing session(s) revoked; any failed-attempt lock cleared.`)
console.log(`\n  Give them this, and have them sign in at the admin panel:`)
console.log(`     email    : ${EMAIL}`)
console.log(`     password : ${PASSWORD}`)
console.log(`\n  Ask them to change it after signing in.\n`)

await mongoose.disconnect()
process.exit(0)
