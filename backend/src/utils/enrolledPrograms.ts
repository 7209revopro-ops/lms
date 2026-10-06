import { Types } from 'mongoose'

/* ─────────────────────────────────────────────────────
   The programmes a student STUDIES, as opposed to the ones they were APPROVED
   into.

   `user.categories` is deliberately the approval record — "who did we approve
   into this programme" (programscope.suite.ts §E) — and enrolling on another
   programme's course never rewrites it. That left an AI student an admin put
   on a Digital Marketing course reading "AI" alone in the Students table and
   never seeing that course's classes on their dashboard.

   So the enrolled programmes are DERIVED, never stored: whatever programme
   every non-dropped enrolment belongs to. Removing the course removes it again,
   with nothing to keep in sync. One aggregation for any number of students. */

export const PROGRAM_ORDER = ['4x-trading', 'digital-marketing', 'ai', 'jura'] as const

export async function enrolledProgramsByUser(
  userIds: Array<string | Types.ObjectId>,
): Promise<Map<string, string[]>> {
  const ids = userIds.map(String).filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id))
  const out = new Map<string, string[]>()
  if (ids.length === 0) return out
  const { EnrollmentModel } = await import('@/models/schema.ts')

  const rows = await EnrollmentModel.aggregate<{ _id: Types.ObjectId; programs: string[] }>([
    { $match: { userId: { $in: ids }, status: { $ne: 'dropped' } } },
    { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'c',
                 pipeline: [{ $project: { program: 1 } }] } },
    { $unwind: '$c' },
    { $match: { 'c.program': { $in: PROGRAM_ORDER as unknown as string[] } } },
    { $group: { _id: '$userId', programs: { $addToSet: '$c.program' } } },
  ])
  for (const r of rows) {
    out.set(String(r._id), PROGRAM_ORDER.filter(p => r.programs.includes(p)))
  }
  return out
}

export async function enrolledProgramsOf(userId: string | Types.ObjectId): Promise<string[]> {
  return (await enrolledProgramsByUser([userId])).get(String(userId)) ?? []
}
