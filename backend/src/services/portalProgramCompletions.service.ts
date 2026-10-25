import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   Programs a student completed (Tetra Commission's user, 2026-10-25: the
   portal's "Program Completion Students"): a program that has ended — its end
   date passed, not stopped — whose every class that was held (not cancelled)
   the student attended. With how many they attended of how many, for each of
   the program's students. Read only.
───────────────────────────────────────────────────────────── */

const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)

export async function programCompletionsForPortal(q: { since?: unknown }) {
  const since = typeof q.since === 'string' && q.since ? q.since : ''
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw fail('since is a day (YYYY-MM-DD)')
  const { ProgramModel, LiveClassModel, ClassBookingModel, UserModel } = await import('@/models/schema.ts')
  const today = dubaiToday()
  const programs = await ProgramModel.find(
    { status: { $ne: 'stopped' }, endDate: { $lt: today, ...(since ? { $gte: since } : {}) } },
    { title: 1, endDate: 1, studentIds: 1 },
  ).lean() as any[]
  if (!programs.length) return { programs: 0, completions: [] }

  const classes = await LiveClassModel.find(
    { programId: { $in: programs.map((p) => p._id) }, status: { $ne: 'cancelled' }, scheduledStart: { $lte: new Date() } },
    { programId: 1 },
  ).lean() as any[]
  const classesOf = new Map<string, string[]>()
  for (const c of classes) classesOf.set(String(c.programId), [...(classesOf.get(String(c.programId)) ?? []), String(c._id)])
  const attended = await ClassBookingModel.aggregate([
    { $match: { liveClassId: { $in: classes.map((c) => c._id) }, $or: [{ status: 'attended' }, { attendedAt: { $exists: true, $ne: null } }] } },
    { $group: { _id: { u: '$userId', c: '$liveClassId' } } },
  ])
  const seen = new Set(attended.map((a: any) => `${a._id.u}|${a._id.c}`))
  const ids = [...new Set(programs.flatMap((p) => (p.studentIds ?? []).map(String)))]
  const emails = new Map((await UserModel.find({ _id: { $in: ids } }, { email: 1, name: 1 }).lean() as any[]).map((u) => [String(u._id), u]))

  const completions: { email: string; name: string; programId: string; title: string; endedOn: string; attended: number; held: number; completed: boolean }[] = []
  for (const p of programs) {
    const held = classesOf.get(String(p._id)) ?? []
    if (!held.length) continue
    for (const sid of (p.studentIds ?? []).map(String)) {
      const u = emails.get(sid)
      if (!u?.email) continue
      const n = held.filter((c) => seen.has(`${sid}|${c}`)).length
      if (!n) continue
      completions.push({ email: String(u.email).toLowerCase(), name: u.name ?? '', programId: String(p._id), title: p.title ?? '', endedOn: p.endDate, attended: n, held: held.length, completed: n >= held.length })
    }
  }
  return { programs: programs.length, completions }
}
