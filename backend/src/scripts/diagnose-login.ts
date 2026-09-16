/* ─────────────────────────────────────────────────────────────
   Explain why a given account cannot sign in.

   Walks the same gates the real login walks, in the same order, and reports
   the FIRST one that would reject — which is the error the person is actually
   seeing. Read-only: it never changes an account.

   Gates checked, in login order (auth.service.ts login()):
     1. account exists
     2. isActive            -> "Invalid email or password" (deliberately vague)
     3. lockedUntil         -> ACCOUNT_LOCKED
     4. passwordHash exists -> NO_PASSWORD_SET
     5. password matches    -> only when --password is supplied
     6. twoFactorEnabled    -> a code is required to finish
     7. role                -> the admin portal refuses `student`
   Plus the admin portal's own client-side allow-list, and the org/permission
   context that decides what an instructor can see once inside.

   Usage (from backend/):
     bun src/scripts/diagnose-login.ts a@x.com b@x.com
     bun src/scripts/diagnose-login.ts a@x.com --password="whatever they typed"
───────────────────────────────────────────────────────────── */
import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const ADMIN_PORTAL_ROLES = ['super_admin', 'admin', 'sub_admin', 'support', 'instructor']

const args = process.argv.slice(2)
const PASSWORD = args.find(a => a.startsWith('--password='))?.slice(11)
const emails = args.filter(a => !a.startsWith('--')).map(e => e.trim().toLowerCase())
if (emails.length === 0) {
  console.error('❌ Give at least one email address.')
  process.exit(1)
}

const DB_URL = process.env['DATABASE_URL'] ?? 'mongodb://localhost:27017/lms'
await mongoose.connect(DB_URL)
const db = mongoose.connection.db!
const { UserModel, OrganizationModel, RoleModel } = await import('@/models/schema.ts')

console.log('═'.repeat(66))
console.log(`  Database: ${db.databaseName}  (${DB_URL.replace(/\/\/[^@/]+@/, '//***@')})`)
console.log(`  Checking ${emails.length} account(s) against the admin-portal login`)
console.log('═'.repeat(66))

for (const email of emails) {
  console.log(`\n── ${email}`)
  /* passwordHash and twoFactorSecret are select:false, so ask for them. */
  const u = await UserModel.findOne({ email })
    .select('+passwordHash +twoFactorSecret name email role isActive isVerified lockedUntil failedLoginAttempts twoFactorEnabled organizationId customRoleId program category categories lastLoginAt createdAt')
    .lean() as Record<string, any> | null

  if (!u) {
    /* A near-miss is the usual cause: a typo, or a different domain. */
    const local = email.split('@')[0]
    const near = await UserModel.find({ email: new RegExp(local!.slice(0, Math.max(4, local!.length - 2)), 'i') })
      .select('email role isActive').limit(5).lean()
    console.log('   ❌ BLOCKER: no account exists with this email address.')
    console.log('      The portal shows: "Invalid email or password."')
    if (near.length) {
      console.log('      Similar addresses that DO exist:')
      near.forEach(n => console.log(`        · ${n.email}  (${n.role}${n.isActive === false ? ', blocked' : ''})`))
    }
    continue
  }

  const org = u.organizationId ? await OrganizationModel.findById(u.organizationId).select('name slug').lean() : null
  const customRole = u.customRoleId ? await RoleModel.findById(u.customRoleId).select('name').lean() : null

  console.log(`   name        : ${u.name}`)
  console.log(`   role        : ${u.role}`)
  console.log(`   org         : ${org ? `${(org as any).name} (${(org as any).slug})` : '— none set —'}`)
  console.log(`   custom role : ${customRole ? (customRole as any).name : '—'}`)
  console.log(`   active      : ${u.isActive}`)
  console.log(`   verified    : ${u.isVerified}`)
  console.log(`   password set: ${u.passwordHash ? 'yes' : 'NO'}`)
  console.log(`   2FA         : ${u.twoFactorEnabled ? 'ENABLED' : 'off'}`)
  console.log(`   failed tries: ${u.failedLoginAttempts ?? 0}`)
  console.log(`   locked until: ${u.lockedUntil ? new Date(u.lockedUntil).toISOString() : '—'}`)
  console.log(`   last login  : ${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : 'never'}`)

  const blockers: string[] = []
  const fixes: string[] = []

  if (u.isActive === false) {
    blockers.push('Account is BLOCKED (isActive: false). The portal shows "Invalid email or password." — deliberately vague, which is why it looks like a wrong password.')
    fixes.push('Re-activate the account in the admin panel (Users → the account → activate), or set isActive: true.')
  }
  if (u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(u.lockedUntil).getTime() - Date.now()) / 60000)
    blockers.push(`Account is LOCKED for another ${mins} minute(s) after too many failed attempts (ACCOUNT_LOCKED).`)
    fixes.push('Wait for the lock to lapse, or clear lockedUntil and failedLoginAttempts.')
  }
  if (!u.passwordHash) {
    blockers.push('NO PASSWORD IS SET on this account. The portal shows: "This account does not have a password yet. Use Forgot password…"')
    fixes.push('Send them through "Forgot password?" on the admin login page, or set a password for them.')
  }
  if (!ADMIN_PORTAL_ROLES.includes(u.role)) {
    blockers.push(`Role "${u.role}" cannot use the admin portal. It shows: "This portal is for admins and instructors only."`)
    fixes.push(`Change the role to instructor (or an admin role) — it is currently "${u.role}".`)
  }
  if (u.twoFactorEnabled) {
    blockers.push('Two-factor authentication is ENABLED — after the password they must enter a code from their authenticator app.')
    fixes.push('If they lost the authenticator, disable 2FA for the account so they can sign in and set it up again.')
  }
  if (PASSWORD && u.passwordHash) {
    const ok = await bcrypt.compare(PASSWORD, u.passwordHash)
    console.log(`   supplied pw : ${ok ? 'MATCHES' : 'does NOT match'}`)
    if (!ok) {
      blockers.push('The supplied password does not match the stored hash (INVALID_CREDENTIALS).')
      fixes.push('Reset the password via "Forgot password?".')
    }
  }
  if (!u.organizationId && u.role !== 'super_admin') {
    console.log('   ⚠  no organization set — they can sign in, but org-scoped lists may come back empty.')
  }

  if (blockers.length === 0) {
    console.log(`   ✅ Nothing blocks this account at the login gates.`)
    console.log(`      If they still cannot get in, the cause is the password they are typing,`)
    console.log(`      or they are using the STUDENT site instead of the admin URL.`)
    console.log(`      Re-run with --password="what they typed" to confirm the password itself.`)
  } else {
    console.log(`   ❌ ${blockers.length} BLOCKER(S):`)
    blockers.forEach((b, i) => console.log(`      ${i + 1}. ${b}`))
    console.log(`   → FIX:`)
    fixes.forEach((f, i) => console.log(`      ${i + 1}. ${f}`))
  }
}

console.log()
await mongoose.disconnect()
process.exit(0)
