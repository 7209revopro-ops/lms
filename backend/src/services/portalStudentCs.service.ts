/* ─────────────────────────────────────────────────────
   Students' CS and CS team, from the commission portal
   ─────────────────────────────────────────────────────
   Tetra Commission knows who looks after each of its students — their CS (the
   primary mentor) and the CS team — and the admin shows it beside the student
   wherever a student is shown (the user, 2026-10-07: "show the cs name and
   team name … every student showing area"). The commission portal sends it
   here every few minutes, for the students whose CS or team changed — every
   one of them the first time:

     POST /service/student-cs { students: [{ email, lmsUserId?, code, cs, team, open }] }
                                at most MAX at a time

   Kept on the student as `tetraCs`: the CS's name ("" while they wait in Delta
   Open Students — `open`), the team, their student code there, and when the
   portal said so. Matched by the LMS user id the portal holds, else by email.
   Students only: a staff account is never written from here. A student whose
   CS and team are as they were is left alone.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { UserModel } from '@/models/schema.ts'
import { PortalError } from '@/services/portal.service.ts'

const MAX = 500

const bad = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

interface Told {
  email:     string
  lmsUserId: string
  name:      string
  team:      string
  code:      string
  open:      boolean
}

export interface StudentCsResult {
  /** Written now: their CS or team (or code, or open) changed. */
  updated:   number
  /** Already as they were told. */
  unchanged: number
  /** Not a student here — by that id or email. */
  notFound:  string[]
}

export async function studentCsFromPortal(input: { students: unknown }): Promise<StudentCsResult> {
  if (!Array.isArray(input.students)) throw bad('students must be a list')
  if (input.students.length > MAX) throw bad(`At most ${MAX} students at a time, and ${input.students.length} were sent`)

  const told: Told[] = []
  for (const raw of input.students as Record<string, unknown>[]) {
    const email = clip(raw?.email, 320).toLowerCase()
    const lmsUserId = clip(raw?.lmsUserId, 24)
    if (!email.includes('@') && !Types.ObjectId.isValid(lmsUserId)) continue
    told.push({
      email,
      lmsUserId: Types.ObjectId.isValid(lmsUserId) ? lmsUserId : '',
      name:  clip(raw?.cs, 120),
      team:  clip(raw?.team, 120),
      code:  clip(raw?.code, 40),
      open:  raw?.open === true,
    })
  }
  if (!told.length) return { updated: 0, unchanged: 0, notFound: [] }

  const ids = [...new Set(told.map(t => t.lmsUserId).filter(Boolean))].map(id => new Types.ObjectId(id))
  const emails = [...new Set(told.map(t => t.email).filter(e => e.includes('@')))]
  const docs = await UserModel.find({
    role: 'student',
    $or: [...(ids.length ? [{ _id: { $in: ids } }] : []), ...(emails.length ? [{ email: { $in: emails } }] : [])],
  }).select('_id email tetraCs').lean() as unknown as { _id: Types.ObjectId; email: string; tetraCs?: { name?: string; team?: string; code?: string; open?: boolean } }[]
  const byId = new Map(docs.map(d => [String(d._id), d]))
  const byEmail = new Map(docs.map(d => [d.email, d]))

  const at = new Date()
  const result: StudentCsResult = { updated: 0, unchanged: 0, notFound: [] }
  const ops: Parameters<typeof UserModel.bulkWrite>[0] = []
  const seen = new Set<string>()
  for (const t of told) {
    const doc = (t.lmsUserId && byId.get(t.lmsUserId)) || byEmail.get(t.email)
    if (!doc) { result.notFound.push(t.email || t.lmsUserId); continue }
    const key = String(doc._id)
    if (seen.has(key)) continue               // the same student twice in one call: the first stands
    seen.add(key)
    const was = doc.tetraCs
    if (was && (was.name ?? '') === t.name && (was.team ?? '') === t.team && (was.code ?? '') === t.code && !!was.open === t.open) {
      result.unchanged++
      continue
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id, role: 'student' },
        update: { $set: { tetraCs: { name: t.name, team: t.team, code: t.code, open: t.open, at } } },
      },
    })
    result.updated++
  }
  if (ops.length) await UserModel.bulkWrite(ops, { ordered: false })
  return result
}
