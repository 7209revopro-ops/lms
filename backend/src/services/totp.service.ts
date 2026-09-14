/**
 * TotpService — RFC 6238 TOTP, pure Node crypto (no external packages).
 *
 * Flow:
 *   1. POST /auth/2fa/setup   → returns { secret, otpauthUrl }
 *   2. POST /auth/2fa/enable  { code } → verifies code, sets twoFactorEnabled=true
 *   3. POST /auth/2fa/disable { password } → re-auth, clears secret
 *
 * Sign-in step (AuthService.loginTwoFactor → verifyLoginCode):
 *   POST /auth/login → challenge, then POST /auth/login/2fa { challengeToken, code }
 */
import { createHmac, randomBytes } from 'crypto'
import { UserModel } from '@/models/schema.ts'
import { comparePassword } from '@/utils/hash.ts'
import { logger } from '@/utils/logger.ts'

const ISSUER  = 'Delta'
const PERIOD  = 30   // seconds per step
const DIGITS  = 6
const WINDOW  = 1    // allow ±1 step for clock skew

/* ─── Base32 helpers (RFC 4648) ────────────────────────── */
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function toBase32(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += B32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += B32_CHARS[(value << (5 - bits)) & 31]
  return output
}

function fromBase32(str: string): Buffer {
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of str.toUpperCase().replace(/=+$/, '')) {
    const idx = B32_CHARS.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/* ─── HOTP (RFC 4226) ───────────────────────────────────── */
function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.allocUnsafe(8)
  // Write 64-bit big-endian counter (JS number safe up to 2^53)
  const hi = Math.floor(counter / 0x100000000)
  const lo = counter >>> 0
  msg.writeUInt32BE(hi, 0)
  msg.writeUInt32BE(lo, 4)

  const hmac  = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[19]! & 0x0f
  const code   = (
    ((hmac[offset]!     & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) <<  8) |
     (hmac[offset + 3]! & 0xff)
  ) % (10 ** DIGITS)
  return String(code).padStart(DIGITS, '0')
}

/* ─── TOTP (RFC 6238) ───────────────────────────────────── */
function totp(secret: string, stepOffset = 0): string {
  const step = Math.floor(Date.now() / 1000 / PERIOD) + stepOffset
  return hotp(fromBase32(secret), step)
}

function verifyTotp(secret: string, token: string): boolean {
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if (totp(secret, w) === token) return true
  }
  return false
}

/* ─── Errors ─────────────────────────────────────────────── */
export class TotpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'TotpError'
  }
}

/* ─── Service ────────────────────────────────────────────── */
export class TotpService {

  /* ── Setup: generate secret, return otpauth:// URL ────
       RE-AUTHENTICATES WITH THE PASSWORD, exactly as disable() does (NEW-01).

       It used to require only a live session, while disable() required the
       password — and that asymmetry was the bug. Anyone holding a session they
       did not own (a shared computer, an unlocked laptop) could ask for the
       secret, put it in their own authenticator, enable 2FA, and walk away.
       The real owner is then locked out of their own account with no way back:
       disabling needs a login they can no longer complete, a password reset
       leaves twoFactorEnabled untouched, and no admin endpoint writes the
       field either — recovery meant editing the database by hand.

       Gating setup() is sufficient on its own: enable() needs a valid code,
       and a code needs the secret, which only this method hands out. So one
       password prompt closes the whole path rather than two. */
  async setup(userId: string, password: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await UserModel.findById(userId).select('+passwordHash').exec()
    if (!user) throw new TotpError('USER_NOT_FOUND', 'Account not found.', 404)
    if (user.twoFactorEnabled) {
      throw new TotpError('ALREADY_ENABLED', '2FA is already enabled on this account.', 409)
    }
    if (!user.passwordHash) {
      throw new TotpError('NO_PASSWORD_SET', 'Set a password before turning on two-factor authentication.', 400)
    }
    if (!(await comparePassword(password, user.passwordHash))) {
      throw new TotpError('WRONG_PASSWORD', 'Password is incorrect.', 401)
    }

    /* 20 bytes = 160 bits — same as Google Authenticator default */
    const secret = toBase32(randomBytes(20))

    /* Store the pending secret (not yet "enabled") */
    await UserModel.findByIdAndUpdate(userId, { $set: { twoFactorSecret: secret } }).exec()

    const otpauthUrl = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(user.email)}` +
      `?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`

    logger.info({ userId }, '2FA setup initiated')
    return { secret, otpauthUrl }
  }

  /* ── Enable: verify first code, then flip flag ───────── */
  async enable(userId: string, token: string): Promise<void> {
    const user = await UserModel.findById(userId).select('+twoFactorSecret').exec()
    if (!user) throw new TotpError('USER_NOT_FOUND', 'Account not found.', 404)
    if (user.twoFactorEnabled) {
      throw new TotpError('ALREADY_ENABLED', '2FA is already enabled.', 409)
    }
    if (!user.twoFactorSecret) {
      throw new TotpError('SETUP_REQUIRED', 'Call /auth/2fa/setup first to generate a secret.', 400)
    }
    if (!verifyTotp(user.twoFactorSecret, token.trim())) {
      throw new TotpError('INVALID_CODE', 'Verification code is incorrect or expired.', 401)
    }
    await UserModel.findByIdAndUpdate(userId, { $set: { twoFactorEnabled: true } }).exec()
    logger.info({ userId }, '2FA enabled')
  }

  /* ── Verify a code at sign-in (login second factor) ───
       Keeps twoFactorSecret inside this service — callers
       only learn whether the code matched. Returns false
       for accounts that don't actually have 2FA active. */
  async verifyLoginCode(userId: string, token: string): Promise<boolean> {
    const user = await UserModel.findById(userId).select('+twoFactorSecret').exec()
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return false
    return verifyTotp(user.twoFactorSecret, token.trim())
  }

  /* ── Disable: re-authenticate with password ──────────── */
  async disable(userId: string, password: string): Promise<void> {
    const user = await UserModel.findById(userId).select('+passwordHash +twoFactorSecret').exec()
    if (!user) throw new TotpError('USER_NOT_FOUND', 'Account not found.', 404)
    if (!user.twoFactorEnabled) {
      throw new TotpError('NOT_ENABLED', '2FA is not enabled on this account.', 400)
    }
    if (!user.passwordHash) {
      throw new TotpError('NO_PASSWORD_SET', 'Set a password before turning on two-factor authentication.', 400)
    }
    const valid = await comparePassword(password, user.passwordHash)
    if (!valid) {
      throw new TotpError('WRONG_PASSWORD', 'Password is incorrect.', 401)
    }
    await UserModel.findByIdAndUpdate(userId, {
      $set:   { twoFactorEnabled: false },
      $unset: { twoFactorSecret: 1 },
    }).exec()
    logger.info({ userId }, '2FA disabled')
  }

  /* ── Status ──────────────────────────────────────────── */
  async status(userId: string): Promise<{ enabled: boolean }> {
    const user = await UserModel.findById(userId).select('twoFactorEnabled').exec()
    if (!user) throw new TotpError('USER_NOT_FOUND', 'Account not found.', 404)
    return { enabled: user.twoFactorEnabled ?? false }
  }

  /* ── Admin: clear 2FA for a user who has lost their device ──
       The user-facing disable() requires the account's own password and a live
       session, which is right — but it leaves nobody able to help someone whose
       phone is gone. Before this, no endpoint anywhere wrote twoFactorEnabled
       except the two above, so that recovery meant editing the database.

       Deliberately NOT wired into the password-reset flow: clearing 2FA on
       reset would mean anyone who can read the user's email defeats the second
       factor entirely, which is the opposite of what it is for. Recovery
       belongs with a human who can verify identity out of band. */
  async adminReset(targetUserId: string): Promise<void> {
    const user = await UserModel.findById(targetUserId).select('twoFactorEnabled').exec()
    if (!user) throw new TotpError('USER_NOT_FOUND', 'User not found.', 404)
    if (!user.twoFactorEnabled) {
      throw new TotpError('NOT_ENABLED', '2FA is not enabled on this account.', 400)
    }
    await UserModel.findByIdAndUpdate(targetUserId, {
      $set:   { twoFactorEnabled: false },
      $unset: { twoFactorSecret: 1 },
    }).exec()
    logger.warn({ targetUserId }, '2FA reset by an administrator')
  }
}
