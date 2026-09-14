/* ─────────────────────────────────────────────────────────────
   Why can this person not sign in?

   "Invalid email or password" is deliberately the same answer for three
   different states, so that nobody can use the login form to discover which
   addresses have accounts. That is right for the public internet and useless
   for the admin who just created an instructor and is being told the password
   they typed themselves is wrong.

   This script is the other side of that trade: run it on the server, where
   you already have the database, and it names the actual state.

     bun src/scripts/diagnose-login.ts someone@example.com
     bun src/scripts/diagnose-login.ts someone@example.com 'TheirPassword1'

   Give the password as a second argument and it verifies it against the
   stored hash — the same bcrypt comparison login() performs, so a PASS here
   means the credentials are genuinely correct and the problem is elsewhere.
   The password is never written to the database, the log, or the output.

   Read-only. It changes nothing.
───────────────────────────────────────────────────────────── */
import 'dotenv/config'
import mongoose from 'mongoose'
import { UserModel } from '@/models/schema.ts'
import { comparePassword } from '@/utils/hash.ts'

const [rawEmail, rawPassword] = process.argv.slice(2)

if (!rawEmail) {
  console.error('Usage: bun src/scripts/diagnose-login.ts <email> [password]')
  process.exit(1)
}

/* The exact normalisation findByEmail() applies. Looking the account up any
   other way would answer a different question than the one login asks. */
const email = rawEmail.toLowerCase().trim()

const uri = process.env['DATABASE_URL'] ?? process.env['MONGODB_URI']
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment.')
  process.exit(1)
}

await mongoose.connect(uri)

const say = (verdict: 'OK' | 'CAUSE' | 'NOTE', text: string) =>
  console.log(`  ${verdict === 'OK' ? '  ok ' : verdict === 'CAUSE' ? '>>>>' : '  --'}  ${text}`)

try {
  console.log(`\nLooking up  ${email}`)
  if (email !== rawEmail) {
    console.log(`  (you typed "${rawEmail}" — login normalises it to the above)`)
  }
  console.log('')

  const user = await UserModel.findOne({ email }).select('+passwordHash').lean() as any

  /* ── Cause 1: no such account ─────────────────────────────── */
  if (!user) {
    say('CAUSE', 'NO ACCOUNT has this address. Login answers "Invalid email or password".')
    /* Far and away the most common reason for this in practice is that the
       account exists under a slightly different address, so do the looking
       rather than leaving it as an exercise. */
    const [localPart] = email.split('@')
    const near = await UserModel.find({
      $or: [
        { email: { $regex: `^${localPart!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`, $options: 'i' } },
        { pendingEmail: email },
      ],
    }).select('email role isActive pendingEmail').limit(10).lean() as any[]

    if (near.length) {
      console.log('\n  Similar addresses that DO exist:')
      for (const n of near) {
        const via = n.pendingEmail === email ? '  (has this as an UNCONFIRMED email change)' : ''
        console.log(`    ${n.email}   role=${n.role}  active=${n.isActive}${via}`)
      }
      console.log('\n  If one of those is the person, they are typing the wrong address —')
      console.log('  or an email change was started and never confirmed.')
    }
    process.exit(0)
  }

  console.log(`  found: ${user.name}   role=${user.role}   id=${user._id}`)
  console.log('')

  let blocked = false

  /* ── Cause 2: the account is disabled ─────────────────────── */
  if (!user.isActive) {
    blocked = true
    say('CAUSE', 'isActive is FALSE. Login answers "Invalid email or password" —')
    say('NOTE',  'the message says nothing about the account being disabled, which is')
    say('NOTE',  'why this one looks like a mystery. Fix: Users → Activate.')
  } else {
    say('OK', 'the account is active')
  }

  /* ── Cause 3: no password was ever set ────────────────────── */
  if (!user.passwordHash) {
    blocked = true
    say('CAUSE', 'NO PASSWORD is set on this account. Login answers NO_PASSWORD_SET and')
    say('NOTE',  'points them at "Forgot password?", which does work for these accounts.')
  } else if (!/^\$2[aby]\$/.test(String(user.passwordHash))) {
    blocked = true
    say('CAUSE', 'the stored password is NOT a bcrypt hash. Something wrote it directly')
    say('NOTE',  'instead of going through hashPassword(). No password can ever match it.')
  } else {
    say('OK', 'a bcrypt password hash is stored')
  }

  /* ── A lockout, which has its own message but is easy to miss ─ */
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    blocked = true
    const mins = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000)
    say('CAUSE', `the account is LOCKED for another ${mins} minute(s) after ` +
                 `${user.failedLoginAttempts ?? '?'} failed attempts.`)
    say('NOTE',  'This one DOES say so at the login screen — "Too many failed attempts".')
    say('NOTE',  'It clears itself; a correct sign-in afterwards resets the counter.')
  } else if (user.failedLoginAttempts) {
    say('NOTE', `${user.failedLoginAttempts} failed attempt(s) recorded, not locked`)
  }

  /* ── Portal and tenancy, which change WHICH login works ───── */
  if (user.role === 'student') {
    say('NOTE', 'this is a STUDENT. The admin portal refuses students with "This portal')
    say('NOTE', 'is for admins and instructors only." They sign in on the student site.')
  } else {
    say('OK', `role ${user.role} may use the admin portal`)
  }

  if (!user.organizationId && user.role !== 'super_admin') {
    say('NOTE', 'no academy is set. Sign-in still works, but this account is invisible')
    say('NOTE', 'to every academy-scoped list in the admin panel.')
  }

  if (user.twoFactorEnabled) {
    say('NOTE', 'two-factor is ON — the password step is followed by a 6-digit code.')
  }

  /* ── The decisive check, when a password was supplied ─────── */
  if (rawPassword) {
    if (!user.passwordHash) {
      say('NOTE', 'cannot check the password: none is stored.')
    } else {
      const ok = await comparePassword(rawPassword, String(user.passwordHash))
      console.log('')
      if (ok) {
        say('OK', 'THE PASSWORD IS CORRECT. It is not the credentials.')
        if (!blocked) {
          say('NOTE', 'Nothing above blocks this sign-in — so if they are still refused,')
          say('NOTE', 'the failure is in front of the API: check they are on the admin')
          say('NOTE', 'site and not the student one, and check for a 429 rate limit.')
        }
      } else {
        say('CAUSE', 'THE PASSWORD DOES NOT MATCH. Whatever they are typing is not what')
        say('NOTE',  'was set. The panel never shows a password again, so if it was')
        say('NOTE',  'mistyped at creation nobody can read it back — set a new one, or')
        say('NOTE',  'have them use "Forgot password?".')
      }
    }
  } else {
    console.log('')
    say('NOTE', 'Pass the password as a second argument to verify it against the hash.')
  }

  console.log('')
} finally {
  await mongoose.disconnect()
}
