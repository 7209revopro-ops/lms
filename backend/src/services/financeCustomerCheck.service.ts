/* ─────────────────────────────────────────────────────
   Does finance know this student?
   ─────────────────────────────────────────────────────
   A student is let in by hand — approved on Enrollment Requests, given another
   programme there, or created already approved under Users — only when
   finance has a customer with their email: their sale reached finance.
   Asked live, every time:

     POST {FINANCE_API_URL}/api/v1/lms/customer-check { email }
     x-lms-secret: FINANCE_S2S_SECRET   (the secret finance calls us with)

   Fails closed. No FINANCE_API_URL, finance not answering, or an answer that is
   not one is an error, never a yes: the approval is refused and says why.
   Where the money is already known — finance's own enrolments, a website
   purchase, the AI-academy site — nothing here is asked.

   All of it only while the finance check is switched on (a super admin's
   switch on Enrollment Requests, `financeCheck.enabled` in settings.service.ts).
   It is off by default: then finance is not asked and admins approve as they
   did before the check.
───────────────────────────────────────────────────── */
import { logger } from '@/utils/logger.ts'
import { isFinanceCheckEnabled } from '@/services/settings.service.ts'

const TIMEOUT_MS = 8_000

export interface FinanceCustomerCheck {
  exists:        boolean
  /** The finance organizations the customer is in, for the admin to see where. */
  organizations: string[]
}

export type FinanceCheckFailure = 'FINANCE_NOT_CONFIGURED' | 'FINANCE_UNAVAILABLE'

export class FinanceCheckError extends Error {
  code: FinanceCheckFailure
  constructor(code: FinanceCheckFailure, message: string) {
    super(message)
    this.code = code
  }
}

/* Either form of the address works: with or without the /api/v1 it serves. */
function financeBase(): string {
  return String(process.env['FINANCE_API_URL'] ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
}

export async function checkFinanceCustomer(email: string): Promise<FinanceCustomerCheck> {
  const base = financeBase()
  const secret = String(process.env['FINANCE_S2S_SECRET'] ?? '')
  if (!base || !secret) throw new FinanceCheckError('FINANCE_NOT_CONFIGURED', 'FINANCE_API_URL or FINANCE_S2S_SECRET is not set')

  let res: globalThis.Response
  try {
    res = await fetch(`${base}/api/v1/lms/customer-check`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-lms-secret': secret },
      body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new FinanceCheckError('FINANCE_UNAVAILABLE', `finance did not answer: ${(err as Error).message}`)
  }
  const body = await res.json().catch(() => null) as { data?: { exists?: unknown; organizations?: unknown } } | null
  if (!res.ok || typeof body?.data?.exists !== 'boolean') {
    throw new FinanceCheckError('FINANCE_UNAVAILABLE', `finance answered ${res.status}`)
  }
  const orgs = Array.isArray(body.data.organizations)
    ? body.data.organizations.filter((o): o is string => typeof o === 'string')
    : []
  return { exists: body.data.exists, organizations: orgs }
}

/** The refusal to send when finance could not be asked. */
export function financeCheckFailure(err: unknown): { status: number; code: string; message: string } {
  const code = err instanceof FinanceCheckError ? err.code : 'FINANCE_UNAVAILABLE'
  return {
    status:  503,
    code:    'FINANCE_CHECK_FAILED',
    message: code === 'FINANCE_NOT_CONFIGURED'
      ? 'Finance cannot be checked from this server yet (FINANCE_API_URL is not set), so nobody can be approved by hand.'
      : 'Finance could not be reached to check this student, so they were not approved. Try again in a moment.',
  }
}

/** Why this student may not be let in by hand — or null, when finance knows them or the check is off. Never throws. */
export async function financeRefusal(email: string): Promise<{ status: number; code: string; message: string } | null> {
  if (!(await isFinanceCheckEnabled())) return null
  const address = email.trim().toLowerCase()
  try {
    if ((await checkFinanceCustomer(address)).exists) return null
    return {
      status:  422,
      code:    'NOT_IN_FINANCE',
      message: `${address || 'This student'} is not a customer in finance, so they cannot be approved. Check the email, or enrol them through the sales CRM so the sale reaches finance first.`,
    }
  } catch (err) {
    logger.warn({ email: address, err: (err as Error).message }, 'Finance check before an approval failed')
    return financeCheckFailure(err)
  }
}
