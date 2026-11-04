/* ─────────────────────────────────────────────────────
   My Wallet — the staff member's own, from the HRMS
   ─────────────────────────────────────────────────────
   The user, 2026-11-04: "the wallet page on every portal". The HRMS keeps
   it — salary a day at a time, what came off and why, commission, what
   finance has paid — and finds the person by the email they sign in here
   with (hrms-backend GET /integrations/wallet). Staff only, and only ever
   their own: never while someone is impersonating them.
───────────────────────────────────────────────────── */
import { UserModel } from '@/models/schema.ts'
import { hrms, hrmsLinked } from '@/services/classPod.service.ts'

/** The HRMS may ask finance, and finance the sales CRMs, before it answers. */
const WALLET_TIMEOUT_MS = 30_000
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export class WalletError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export async function walletOf(userId: string, month: string | undefined): Promise<unknown> {
  if (month && !MONTH.test(month)) throw new WalletError(400, 'VALIDATION_ERROR', 'month must be YYYY-MM')
  if (!hrmsLinked()) throw new WalletError(503, 'HRMS_NOT_LINKED', "The LMS isn't linked to the HRMS yet, so there is no wallet to show.")
  const me = await UserModel.findById(userId).select('email').lean<{ email?: string } | null>()
  const email = String(me?.email ?? '').trim().toLowerCase()
  if (!email) throw new WalletError(400, 'NO_EMAIL', 'Your account has no email to find your HRMS record with.')
  try {
    return await hrms<unknown>('GET', '/wallet', { email, ...(month ? { month } : {}) }, undefined, { org: false, timeoutMs: WALLET_TIMEOUT_MS })
  } catch (err) {
    const e = err as { status?: number; hrmsMessage?: string }
    // The HRMS's own refusals ("No HRMS employee has this email.") pass through; it out of reach is a 503.
    if (e.status && e.status < 500 && e.status !== 401) throw new WalletError(e.status, 'HRMS_REFUSED', e.hrmsMessage || `The HRMS refused this (${e.status})`)
    if (e.status === 401) throw new WalletError(502, 'HRMS_CREDENTIALS', "The HRMS refused the LMS's credentials (HRMS_CLIENT_ID / HRMS_INTEGRATION_SECRET).")
    throw new WalletError(503, 'HRMS_UNAVAILABLE', 'The HRMS could not be reached — try again in a moment.')
  }
}
