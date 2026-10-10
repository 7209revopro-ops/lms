/* ─────────────────────────────────────────────────────
   Recheck the commission portal (the user, 2026-10-10)
   ─────────────────────────────────────────────────────
   Tetra Commission tells us every student's CS and team every ten minutes
   (portalStudentCs.service.ts). This asks it now, for one student — the
   Students table's "Recheck commission portal", a student created or edited
   here, and a Forex student the moment they have been sent there
   (commissionStudents.service.ts) — and keeps the answer on them as
   `tetraCs`, as the push does.

   The link the new-student job uses: COMMISSION_API_URL and
   COMMISSION_S2S_SECRET (LMS_S2S_SECRET there). Unset — not offered.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { UserModel } from '@/models/schema.ts'
import { logger } from '@/utils/logger.ts'

const TIMEOUT_MS = 10_000

export interface TetraCsRecheck {
  /** In Tetra Commission at all. */
  found:  boolean
  /** Their CS; "" while they wait in Delta Open Students. */
  cs:     string
  team:   string
  /** Their student code there, STU-…. */
  code:   string
  open:   boolean
}

export class TetraCsUnavailableError extends Error {}

export const tetraCsRecheckConfigured = (): boolean =>
  Boolean(process.env['COMMISSION_API_URL'] && process.env['COMMISSION_S2S_SECRET'])

/** Asks Tetra Commission who looks after this student now, and keeps it. Throws TetraCsUnavailableError when it can't say. */
export async function recheckTetraCs(userId: string): Promise<TetraCsRecheck> {
  if (!tetraCsRecheckConfigured()) {
    throw new TetraCsUnavailableError('The commission portal is not linked to this server (COMMISSION_API_URL, COMMISSION_S2S_SECRET)')
  }
  if (!Types.ObjectId.isValid(userId)) throw new TetraCsUnavailableError('Not a student')
  const user = await UserModel.findById(userId).select('email role').lean() as { _id: Types.ObjectId; email?: string; role?: string } | null
  if (!user || user.role !== 'student') throw new TetraCsUnavailableError('Not a student')

  const base = String(process.env['COMMISSION_API_URL']).replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api/v1/integrations/lms/student-cs`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-lms-secret': String(process.env['COMMISSION_S2S_SECRET']) },
      body:    JSON.stringify({ lmsUserId: String(user._id), email: String(user.email ?? '').toLowerCase() }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new TetraCsUnavailableError('The commission portal could not be reached')
  }
  if (res.status === 404) throw new TetraCsUnavailableError('The commission portal does not answer this yet — its server needs the new code')
  const body = await res.json().catch(() => ({})) as { data?: Partial<TetraCsRecheck>; error?: { message?: string } }
  if (!res.ok || !body.data) throw new TetraCsUnavailableError(body.error?.message ?? `The commission portal answered ${res.status}`)

  const answer: TetraCsRecheck = {
    found: body.data.found === true,
    cs:    String(body.data.cs ?? ''),
    team:  String(body.data.team ?? ''),
    code:  String(body.data.code ?? ''),
    open:  body.data.open === true,
  }
  // Not there is not news: whatever the push last said stays.
  if (answer.found) {
    await UserModel.updateOne({ _id: user._id }, {
      $set: { tetraCs: { name: answer.cs, team: answer.team, code: answer.code, open: answer.open, at: new Date() } },
    })
  }
  return answer
}

/** The same, in the background — after a student is saved or sent, never holding that up. */
export function recheckTetraCsLater(userId: string | undefined | null): void {
  if (!userId || !tetraCsRecheckConfigured()) return
  recheckTetraCs(String(userId)).catch((err: unknown) => {
    if ((err as Error).message !== 'Not a student') logger.warn({ userId, err: (err as Error).message }, 'Could not recheck the commission portal')
  })
}
