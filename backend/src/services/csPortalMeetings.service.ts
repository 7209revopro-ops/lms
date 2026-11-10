/* ─────────────────────────────────────────────────────────────
   Meeting requests and Meetings done in the LMS admin (the user, 2026-11-10:
   "meeting request and meeting done area also do same as the commission
   portal also in the lms admin"). The CS Portal keeps them — the requests,
   the 7-day rule, who approves, the Meeting mentor commission, Converted —
   and this server asks it for the instructor signed in here, by their own
   address, never one sent by the page:

     POST {COMMISSION_API_URL}/api/v1/integrations/lms/mentor-meetings
          { email, action, body }        x-lms-secret: COMMISSION_S2S_SECRET

   The same link the new-student job uses (commissionStudents.service.ts).
   The CS Portal lets a Junior, Senior or Sub-junior Mentor ask for a student
   meeting, see and take back their own requests and see their commission; a
   Chief their team's meetings and commission. Nobody decides from here — the
   student's CS picks the time and approves in the CS Portal.

   Also: a Senior, Junior or Sub-junior Mentor asks for a student meeting
   rather than booking it on the Mentor Calendar here (mustAskForStudentMeetings),
   as in the CS Portal. If the CS Portal can't say, booking goes on as before.
───────────────────────────────────────────────────────────── */
import { logger } from '@/utils/logger.ts'

/** What the LMS admin may ask for — the CS Portal checks each against the mentor's role again. */
export const CS_MEETING_ACTIONS = new Set([
  'me', 'listMeetingRequests', 'createMeetingRequest', 'cancelMeetingRequest', 'getMeetingRequestReview',
  'searchMeetingStudents', 'getStudentMeetingHistory', 'getMeetingCommissions', 'getMeetingsDone',
])
const TIMEOUT_MS = 30_000
const base = (v: unknown) => String(v ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')

export class CsMeetingsError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function csMeetingsConfigured(): boolean {
  return Boolean(process.env['COMMISSION_API_URL'] && process.env['COMMISSION_S2S_SECRET'])
}

/** The CS Portal's answer to `action`, as the mentor with this address. */
export async function askCsPortal(email: unknown, action: string, body: unknown = {}): Promise<Record<string, unknown>> {
  if (!CS_MEETING_ACTIONS.has(action)) throw new CsMeetingsError('Unknown action', 400)
  const address = String(email ?? '').trim().toLowerCase()
  if (!address.includes('@')) throw new CsMeetingsError('Your account has no email', 400)
  if (!csMeetingsConfigured()) throw new CsMeetingsError('The CS Portal is not linked to this server (COMMISSION_API_URL, COMMISSION_S2S_SECRET)', 503)
  const inner = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  let res: Response
  try {
    res = await fetch(`${base(process.env['COMMISSION_API_URL'])}/api/v1/integrations/lms/mentor-meetings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lms-secret': String(process.env['COMMISSION_S2S_SECRET'] ?? '') },
      body: JSON.stringify({ email: address, action, body: inner }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new CsMeetingsError('The CS Portal could not be reached', 502)
  }
  const got = await res.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } | string; message?: string }
  if (res.ok) return got.data ?? {}
  const code = typeof got.error === 'object' ? got.error?.code : undefined
  const message = (typeof got.error === 'object' ? got.error?.message : got.error) ?? got.message ?? `The CS Portal answered ${res.status}`
  /* Its server still on code without this route (a plain "Not found", no code), or the link off there: not the
     mentor's doing. */
  if ((res.status === 404 && !code) || code === 'INTEGRATION_DISABLED') throw new CsMeetingsError('This needs the CS Portal update (its API deploy)', 503)
  /* A bad secret is this server's setting, not something the mentor did. */
  if (res.status === 401) throw new CsMeetingsError('The CS Portal refused this server (COMMISSION_S2S_SECRET)', 502)
  throw new CsMeetingsError(String(message), res.status >= 500 ? 502 : res.status)
}

/* Who asks rather than books, by address — five minutes, so the Mentor Calendar isn't slowed down. */
const asksCache = new Map<string, { at: number; asks: boolean }>()
const ASKS_TTL_MS = 5 * 60_000

/**
 * Must this instructor ask for a student meeting (the CS Portal's Senior / Junior / Sub-junior Mentors) instead of
 * booking it? False when the CS Portal isn't linked or can't be asked — booking goes on as before.
 */
export async function mustAskForStudentMeetings(email: unknown): Promise<boolean> {
  const address = String(email ?? '').trim().toLowerCase()
  if (!address.includes('@') || !csMeetingsConfigured()) return false
  const hit = asksCache.get(address)
  if (hit && Date.now() - hit.at < ASKS_TTL_MS) return hit.asks
  try {
    const me = await askCsPortal(address, 'me')
    const asks = me['mentor'] === true && me['asks'] === true
    asksCache.set(address, { at: Date.now(), asks })
    return asks
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'CS Portal could not say whether this mentor asks for student meetings — booking allowed')
    return false
  }
}

/** For the suite: forget what was asked. */
export function forgetAsks(): void { asksCache.clear() }

export const ASK_INSTEAD_MESSAGE = "Ask for a student meeting on Meeting requests — the student's CS picks the time and approves it, as in the CS Portal."
