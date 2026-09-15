/* ─────────────────────────────────────────────────────────────
   Who is going to be stopped at the sign-in screen?

   An account with no password cannot sign in with one. The old build tells
   those people "This account uses social login. Please sign in with Google.",
   which is doubly wrong — there is no Google sign-in here, and these are not
   social accounts. They come from bulk imports and from external purchases,
   where the buyer is provisioned a seat before they ever choose a password.

   The new build tells them to use "Forgot password?" instead. That route
   already works on the OLD build too — forgotPassword() never cared whether a
   hash existed — so nobody has to wait for a deploy to get in. What they DO
   need is to be told, and this script says exactly who to tell.

     bun run list-passwordless            # every affected account
     bun run list-passwordless --emails   # just the addresses, comma-separated
     bun run list-passwordless --students # students only

   Read-only. It sends nothing and changes nothing.
───────────────────────────────────────────────────────────── */
import 'dotenv/config'
import mongoose from 'mongoose'
import { UserModel } from '@/models/schema.ts'

const args        = process.argv.slice(2)
const emailsOnly  = args.includes('--emails')
const studentsOnly = args.includes('--students')

const uri = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI']
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment.')
  process.exit(1)
}

await mongoose.connect(uri)

try {
  /* passwordHash is select:false, so it must be asked for explicitly — and
     "missing" and "empty string" are both no-password. */
  const rows = await UserModel.find({
    isActive: true,
    ...(studentsOnly ? { role: 'student' } : {}),
    $or: [
      { passwordHash: { $exists: false } },
      { passwordHash: null },
      { passwordHash: '' },
    ],
  })
    .select('+passwordHash name email role signupType createdAt lastLoginAt enrollmentStatus')
    .sort({ createdAt: -1 })
    .lean() as any[]

  /* Belt and braces: the query above should not return anyone with a hash,
     but a stray select is cheaper to guard than to debug. */
  const affected = rows.filter(r => !r.passwordHash)

  if (!affected.length) {
    console.log('\nNo active account is missing a password. Nobody will hit that message.\n')
    process.exit(0)
  }

  if (emailsOnly) {
    console.log(affected.map(r => r.email).join(', '))
    process.exit(0)
  }

  console.log(`\n${affected.length} active account(s) cannot sign in with a password.\n`)

  const byRole = new Map<string, any[]>()
  for (const r of affected) {
    const k = String(r.role ?? 'unknown')
    byRole.set(k, [...(byRole.get(k) ?? []), r])
  }

  for (const [role, list] of [...byRole].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`── ${role} (${list.length}) ${'─'.repeat(Math.max(0, 40 - role.length))}`)
    for (const r of list) {
      /* lastLoginAt is the useful signal: someone who has NEVER signed in is
         probably a fresh import who has not tried yet, while someone with a
         past login had a password once and something removed it — worth a
         second look rather than a bulk mail. */
      const everIn = r.lastLoginAt ? `last in ${new Date(r.lastLoginAt).toISOString().slice(0, 10)}` : 'never signed in'
      const origin = r.signupType === 'express' ? 'express/purchase' : 'import or full'
      console.log(`   ${String(r.email).padEnd(38)} ${everIn.padEnd(22)} ${origin}`)
    }
    console.log('')
  }

  console.log('What to tell them')
  console.log('─────────────────')
  console.log('  On the sign-in page, use "Forgot password?" — enter this same')
  console.log('  address, open the emailed link, and choose a password. That')
  console.log('  works on the site as it stands today; it does not need the')
  console.log('  new build.')
  console.log('')
  console.log('  For a copy-pasteable address list:  bun run list-passwordless --emails')
  console.log('')
} finally {
  await mongoose.disconnect()
}
