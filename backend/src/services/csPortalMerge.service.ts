/* ─────────────────────────────────────────────────────
   Merges, both ways between the LMS and CS Portal (the user, 2026-11-12:
   "when merge on the lms it will merge on the commission portal also …
   which cs will get, we can decide").

   LMS → CS Portal: the merge pop-up asks CS Portal who the two accounts are
   there (`csPortalPreview`) and, when both are there with different CSs,
   which CS keeps the student. Once merged here, CS Portal is told
   (`sendMergeToCsPortal`): it merges its two students with that CS, re-links
   a lone one to the kept account, or has nothing to do. Undone here, its side
   is undone (`sendUndoToCsPortal`).

   CS Portal → LMS: a merge on CS Portal's Duplicates page arrives here
   (`mergeFromCsPortal`, /integrations/cs-portal/merge) and merges the two
   students' LMS accounts — the kept student's keeping, every detail the
   kept account's own, the closed one's email kept as a secondary email. Its
   undo arrives too (`undoFromCsPortal`).

   What came from the other side is marked (origin 'cs_portal', or CS Portal
   being told with fromLms) and never sent back. Not reached: `csPortal.state`
   'pending', tried again every minute (jobs/csPortalMerges.job.ts).
   The secret is the one only these two share: COMMISSION_S2S_SECRET — sent
   as x-lms-secret, received as x-commission-secret.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { UserError } from '@/services/user.service.ts'

type Lean = Record<string, any>
export const csPortalLinked = (): boolean => Boolean(process.env['COMMISSION_API_URL'] && process.env['COMMISSION_S2S_SECRET'])
const base = () => String(process.env['COMMISSION_API_URL']).replace(/\/+$/, '')
const TIMEOUT_MS = 20_000

class CsPortalError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function callCsPortal(path: string, body: unknown): Promise<Lean> {
  let res: Response
  try {
    res = await fetch(`${base()}/api/v1/integrations/lms${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lms-secret': String(process.env['COMMISSION_S2S_SECRET']) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new CsPortalError('CS Portal could not be reached', 0)
  }
  const j = await res.json().catch(() => ({})) as Lean
  if (!res.ok) throw new CsPortalError(j?.error?.message ?? j?.message ?? `CS Portal answered ${res.status}`, res.status)
  return (j?.data ?? j) as Lean
}

const account = (u: Lean | null | undefined) => (u ? { lmsUserId: String(u._id), email: String(u.email ?? '') } : {})
/** 1, 2, 4 … minutes after each failed try, at most an hour. */
const nextAt = (attempts: number) => new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000)

/* ── The pop-up ──────────────────────────────────────── */

export interface CsPortalPreview {
  linked: boolean
  /** merge: both are students there; relink: only the account being closed; nothing: neither, or only the kept one. */
  action?: 'merge' | 'relink' | 'nothing'
  primary?: Lean | null
  secondary?: Lean | null
  sameCs?: boolean
  /** Why CS Portal could not be asked — the merge still goes ahead, and CS Portal is told once it answers. */
  unavailable?: string
}

/** Who the two accounts are in CS Portal, and what merging them would do there. Never throws. */
export async function csPortalPreview(primaryId: string, secondaryId: string): Promise<CsPortalPreview> {
  if (!csPortalLinked()) return { linked: false }
  const { UserModel } = await import('@/models/schema.ts')
  const [p, s] = await Promise.all([
    Types.ObjectId.isValid(primaryId) ? UserModel.findById(primaryId).select('email').lean<Lean>() : null,
    Types.ObjectId.isValid(secondaryId) ? UserModel.findById(secondaryId).select('email').lean<Lean>() : null,
  ])
  if (!p || !s) return { linked: true, action: 'nothing' }
  try {
    const r = await callCsPortal('/merge/preview', { primary: account(p), secondary: account(s) })
    return { linked: true, action: r.action, primary: r.primary ?? null, secondary: r.secondary ?? null, sameCs: !!r.sameCs }
  } catch (err) {
    return { linked: true, unavailable: (err as Error).message }
  }
}

/* ── LMS → CS Portal ─────────────────────────────────── */

/** A merge made here: CS Portal follows. Never throws; what happened is on the merge (`csPortal`). */
export async function sendMergeToCsPortal(mergeId: string): Promise<Lean | null> {
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const m = await AccountMergeModel.findById(mergeId).lean<Lean>()
  if (!m || m.origin === 'cs_portal') return null
  if (m.status !== 'done') {
    if (m.csPortal?.state === 'pending') await AccountMergeModel.updateOne({ _id: m._id }, { $set: { 'csPortal.state': 'cancelled' } })
    return null
  }
  const choice = { csFrom: m.csPortal?.csFrom === 'secondary' ? 'secondary' : 'primary', otherCsAsCommon: m.csPortal?.otherCsAsCommon !== false }
  if (!csPortalLinked()) {
    const csPortal = { ...choice, state: 'not_linked', at: new Date() }
    await AccountMergeModel.updateOne({ _id: m._id }, { $set: { csPortal } })
    return csPortal
  }
  const attempts = Number(m.csPortal?.attempts ?? 0) + 1
  try {
    const r = await callCsPortal('/merge', {
      lmsMergeId: String(m._id),
      primary: { lmsUserId: String(m.primaryId), email: m.primaryEmail },
      secondary: { lmsUserId: String(m.secondaryId), email: m.secondaryEmail },
      ...choice,
      by: { email: m.mergedByEmail ?? '' },
    })
    const csPortal = { ...choice, state: r.action === 'nothing' ? 'nothing' : 'done', action: r.action ?? 'nothing', csMergeId: r.mergeId ?? null, at: new Date(), attempts }
    await AccountMergeModel.updateOne({ _id: m._id }, { $set: { csPortal } })
    return csPortal
  } catch (err) {
    // Refused (4xx) will not change by asking again: recorded, for a person to look at.
    const status = err instanceof CsPortalError ? err.status : 0
    const csPortal = { ...choice, state: status >= 400 && status < 500 && status !== 401 ? 'failed' : 'pending', error: (err as Error).message, attempts, nextAt: nextAt(attempts), at: new Date() }
    await AccountMergeModel.updateOne({ _id: m._id }, { $set: { csPortal } })
    logger.warn({ mergeId, err: (err as Error).message }, 'CS Portal was not told of an account merge yet')
    return csPortal
  }
}

/** A merge undone here: CS Portal's side follows — the one it made for this merge, or the CS Portal merge this one came from. */
export async function sendUndoToCsPortal(mergeId: string): Promise<Lean | null> {
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const m = await AccountMergeModel.findById(mergeId).lean<Lean>()
  if (!m || m.status !== 'undone' || !csPortalLinked()) return null
  const target = m.origin === 'cs_portal' ? (m.csPortal?.csMergeId ? { csMergeId: m.csPortal.csMergeId } : null)
    : m.csPortal?.state === 'done' ? { lmsMergeId: String(m._id) } : null
  if (!target) return null
  const attempts = Number(m.csPortalUndo?.attempts ?? 0) + 1
  try {
    const r = await callCsPortal('/merge/undo', target)
    const csPortalUndo = { state: 'done', nothing: !!r.nothing, at: new Date(), attempts }
    await AccountMergeModel.updateOne({ _id: m._id }, { $set: { csPortalUndo } })
    return csPortalUndo
  } catch (err) {
    const csPortalUndo = { state: 'pending', error: (err as Error).message, attempts, nextAt: nextAt(attempts), at: new Date() }
    await AccountMergeModel.updateOne({ _id: m._id }, { $set: { csPortalUndo } })
    return csPortalUndo
  }
}

/** Whatever CS Portal could not be told yet, tried again. */
export async function drainCsPortalMergesOnce(now = new Date()): Promise<{ merges: number; undos: number }> {
  if (!csPortalLinked()) return { merges: 0, undos: 0 }
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const merges = await AccountMergeModel.find({ status: 'done', 'csPortal.state': 'pending', 'csPortal.nextAt': { $lte: now }, 'csPortal.attempts': { $lt: 30 } }).select('_id').lean<Lean[]>()
  for (const m of merges) await sendMergeToCsPortal(String(m._id))
  const undos = await AccountMergeModel.find({ status: 'undone', 'csPortalUndo.state': 'pending', 'csPortalUndo.nextAt': { $lte: now }, 'csPortalUndo.attempts': { $lt: 30 } }).select('_id').lean<Lean[]>()
  for (const m of undos) await sendUndoToCsPortal(String(m._id))
  return { merges: merges.length, undos: undos.length }
}

/* ── CS Portal → LMS ─────────────────────────────────── */

/** A student account for what CS Portal knows of a student: by its LMS id, else by email — open, and a student. */
async function accountFor(a: Lean | undefined): Promise<Lean | null> {
  const { UserModel } = await import('@/models/schema.ts')
  const id = String(a?.lmsUserId ?? '').trim()
  const email = String(a?.email ?? '').trim().toLowerCase()
  const open = { role: 'student', mergedInto: { $exists: false } }
  if (Types.ObjectId.isValid(id)) {
    const u = await UserModel.findOne({ _id: id, ...open }).select('email').lean<Lean>()
    if (u) return u
  }
  if (!email.includes('@')) return null
  return UserModel.findOne({ $or: [{ email }, { 'secondaryEmails.email': email }], ...open }).select('email').lean<Lean>()
}

/**
 * CS Portal merged two students: their LMS accounts are merged — once per CS
 * Portal merge — the kept student's account keeping, with its own details.
 */
export async function mergeFromCsPortal(body: Lean): Promise<Lean> {
  const csMergeId = String(body?.csMergeId ?? '').trim()
  if (!Types.ObjectId.isValid(csMergeId)) throw new UserError('VALIDATION_ERROR', 'csMergeId is required', 400)
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const done = await AccountMergeModel.findOne({ origin: 'cs_portal', 'csPortal.csMergeId': csMergeId, status: { $in: ['done', 'running'] } }).select('_id').lean<Lean>()
  if (done) return { action: 'merge', mergeId: String(done._id), already: true }
  const [p, s] = await Promise.all([accountFor(body.primary), accountFor(body.secondary)])
  if (!p || !s || String(p._id) === String(s._id)) return { action: 'nothing' }
  const { mergeAccounts } = await import('@/services/accountMerge.service.ts')
  const by = String(body?.by?.name ?? body?.by?.email ?? '').trim()
  const r = await mergeAccounts({
    primaryId: String(p._id), secondaryId: String(s._id), confirmEmail: String(s.email), keepSecondaryEmail: true,
    by: { email: `CS Portal${by ? ` · ${by}` : ''}` }, origin: 'cs_portal', csMergeId,
  })
  return { action: 'merge', mergeId: r.mergeId, primaryId: r.primaryId }
}

/** CS Portal undid a merge: the LMS merge made for it — or the LMS merge it came from — is undone too, not told back. */
export async function undoFromCsPortal(body: Lean): Promise<Lean> {
  const csMergeId = String(body?.csMergeId ?? '').trim(), lmsMergeId = String(body?.lmsMergeId ?? '').trim()
  const { AccountMergeModel } = await import('@/models/schema.ts')
  const m = Types.ObjectId.isValid(lmsMergeId) ? await AccountMergeModel.findById(lmsMergeId).lean<Lean>()
    : Types.ObjectId.isValid(csMergeId) ? await AccountMergeModel.findOne({ origin: 'cs_portal', 'csPortal.csMergeId': csMergeId }).sort({ createdAt: -1 }).lean<Lean>()
    : null
  if (!Types.ObjectId.isValid(lmsMergeId) && !Types.ObjectId.isValid(csMergeId)) throw new UserError('VALIDATION_ERROR', 'csMergeId or lmsMergeId is required', 400)
  if (!m) return { undone: false, nothing: true }
  if (m.status === 'undone') return { undone: true, already: true }
  const { undoMerge } = await import('@/services/accountMerge.service.ts')
  const r = await undoMerge(String(m._id), undefined, { fromCsPortal: true })
  return { undone: true, notes: r.notes }
}
