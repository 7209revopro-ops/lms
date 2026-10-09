/* ─────────────────────────────────────────────────────────────
   wrongAcademyCopy — is this the OTHER academy's copy of a course the
   student's own academy also runs?

   Dubai and Bangalore each have "MARKET BREAK-OUT TRADING PROGRAM" (and DWT,
   MMC, DSLP …) under the same title. A Dubai student enrolled in the
   Bangalore copy sees the course twice, gets Bangalore's classes and
   modules, and Dubai's schedule misses them. That is the mistake this
   catches — and only that: a course the student's academy does NOT run (AI
   Academy lives only in Bangalore; Dubai students buy it) is still allowed,
   and so is one whose own-academy copy is still a draft.

   Returns the student's own published copy to name in the refusal, or null
   when the enrolment is fine.
───────────────────────────────────────────────────────────── */
import { Types } from 'mongoose'

export interface OwnAcademyCopy { courseId: string; title: string; academy: string }

const sameTitle = (t: string) => new RegExp(`^\\s*${t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')

export async function wrongAcademyCopy(studentOrgId: unknown, courseId: string): Promise<OwnAcademyCopy | null> {
  if (!studentOrgId || !Types.ObjectId.isValid(String(studentOrgId)) || !Types.ObjectId.isValid(courseId)) return null
  const { CourseModel, OrganizationModel } = await import('@/models/schema.ts')
  const course = await CourseModel.findById(courseId).select('title organizationId').lean<{ title?: string; organizationId?: Types.ObjectId }>()
  if (!course?.title || !course.organizationId || String(course.organizationId) === String(studentOrgId)) return null
  const own = await CourseModel.findOne({
    organizationId: new Types.ObjectId(String(studentOrgId)),
    title:          sameTitle(course.title),
    status:         'published',
  }).select('title').lean<{ _id: Types.ObjectId; title: string }>()
  if (!own) return null
  const org = await OrganizationModel.findById(studentOrgId).select('name').lean<{ name?: string }>()
  return { courseId: String(own._id), title: own.title, academy: org?.name ?? 'their own academy' }
}

export const wrongAcademyMessage = (c: OwnAcademyCopy) =>
  `This is the other academy's copy. This student belongs to ${c.academy} — enrol them in the ${c.academy} copy of "${c.title}" instead.`
