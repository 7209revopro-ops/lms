/* ─────────────────────────────────────────────────────────────
   A student's programme journey — the level bar on the Class Schedule page.

   Programmes: the student's own (User.categories), plus the programme of any
   course they hold; a student with none set gets just the programmes of the
   courses they hold. Each programme lists its published courses that the
   student's academy may see (its own, or shared by both academies), in
   Course.programOrder, then title.

   Each course is a level:
     completed — their enrolment is 'completed';
     current   — they hold it (active);
     next      — the first course they do not hold after the furthest one
                 they hold, once that one is completed ("Up next");
     locked    — not held.
   Held courses carry their modules: open, or locked — and why (fee not yet
   paid in full, or locked by the academy).
───────────────────────────────────────────────────────────── */
import { Types } from 'mongoose'

export type LevelState = 'completed' | 'current' | 'next' | 'locked'

export interface JourneyModule { id: string; title: string; number: number; locked: boolean }
export interface JourneyLevel {
  courseId: string; title: string; slug?: string; thumbnailUrl?: string; description?: string
  level: number; state: LevelState
  progressPercent: number
  modules: JourneyModule[]; modulesOpen: number; modulesTotal: number
  /** Why modules are locked: the fee (finance) or the academy. */
  lockReason?: 'payment' | 'academy'
  classesAttended: number
}
export interface Journey {
  programmes: Array<{ program: string; label: string; levels: JourneyLevel[] }>
  /* The advisor's name only — their sales team is internal, not for students. */
  advisor: { name?: string } | null
}

const PROGRAM_LABEL: Record<string, string> = {
  '4x-trading': 'Forex', 'digital-marketing': 'Digital Marketing', ai: 'AI Academy', jura: 'JURA',
}

export async function studentJourney(userId: string): Promise<Journey> {
  const { UserModel, CourseModel, EnrollmentModel, SectionModel, LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')
  const uid = new Types.ObjectId(userId)
  const me = await UserModel.findById(uid).select('categories category organizationId tetraCs').lean() as any
  if (!me) return { programmes: [], advisor: null }

  const enrolments = await EnrollmentModel.find({ userId: uid, status: { $ne: 'dropped' } })
    .select('courseId status progressPercent blockedLessons paymentAccess').lean() as any[]
  const held = new Map(enrolments.map(e => [String(e.courseId), e]))
  const heldCourses = enrolments.length
    ? await CourseModel.find({ _id: { $in: enrolments.map(e => e.courseId) } }).select('program').lean() as any[]
    : []

  const own = (me.categories?.length ? me.categories : [me.category]).filter(Boolean) as string[]
  const programmes = [...new Set([...own, ...heldCourses.map(c => c.program).filter(Boolean)])]
    .filter(p => PROGRAM_LABEL[p])

  /* The courses each programme offers this student's academy, plus any course
     they hold in it wherever it lives. */
  const visible: Record<string, unknown> = me.organizationId
    ? { $or: [{ organizationId: me.organizationId }, { sharedAcademies: true }, { _id: { $in: enrolments.map(e => e.courseId) } }] }
    : {}
  const courses = await CourseModel.find({ program: { $in: programmes }, $and: [
    { $or: [{ status: 'published' }, { _id: { $in: enrolments.map(e => e.courseId) } }] }, visible,
  ] }).select('title slug thumbnailUrl description program programOrder').lean() as any[]

  const heldIds = courses.filter(c => held.has(String(c._id))).map(c => c._id)
  const [sections, attended] = await Promise.all([
    heldIds.length ? SectionModel.find({ courseId: { $in: heldIds } }).select('courseId title order').sort({ order: 1, createdAt: 1 }).lean() as Promise<any[]> : Promise.resolve([] as any[]),
    (async () => {
      if (!heldIds.length) return new Map<string, number>()
      /* Attended: marked so, or a recorded join (attendedAt). */
      const bookings = await ClassBookingModel.find({ userId: uid, status: { $ne: 'cancelled' },
        $or: [{ status: 'attended' }, { attendedAt: { $exists: true, $ne: null } }] }).select('liveClassId').lean() as any[]
      const cls = bookings.length ? await LiveClassModel.find({ _id: { $in: bookings.map(b => b.liveClassId) } }).select('courseId').lean() as any[] : []
      const m = new Map<string, number>()
      for (const c of cls) m.set(String(c.courseId), (m.get(String(c.courseId)) ?? 0) + 1)
      return m
    })(),
  ])

  const out: Journey['programmes'] = []
  for (const program of programmes) {
    const list = courses.filter(c => c.program === program).sort((a, b) =>
      (a.programOrder ?? 1e6) - (b.programOrder ?? 1e6) || String(a.title).localeCompare(String(b.title)))
    if (!list.length) continue

    const levels: JourneyLevel[] = list.map((c, i) => {
      const e = held.get(String(c._id))
      const mods = sections.filter(s => String(s.courseId) === String(c._id))
      const blocked = new Set(((e?.blockedLessons ?? []) as unknown[]).map(String))
      const modules = e ? mods.map((s, k) => ({ id: String(s._id), title: s.title, number: k + 1, locked: blocked.has(String(s._id)) })) : []
      const anyLocked = modules.some(m => m.locked)
      const payment = e?.paymentAccess?.status
      return {
        courseId: String(c._id), title: c.title, slug: c.slug, thumbnailUrl: c.thumbnailUrl,
        description: c.description ? String(c.description).slice(0, 280) : undefined,
        level: i + 1,
        state: (e ? (e.status === 'completed' ? 'completed' : 'current') : 'locked') as LevelState,
        progressPercent: Math.round(e?.progressPercent ?? 0),
        modules, modulesTotal: e ? mods.length : 0, modulesOpen: modules.filter(m => !m.locked).length,
        ...(anyLocked ? { lockReason: (payment && payment !== 'paid' ? 'payment' : 'academy') as 'payment' | 'academy' } : {}),
        classesAttended: attended.get(String(c._id)) ?? 0,
      }
    })

    /* "Up next": the first course not held after the furthest one held —
       once that one is completed. */
    let furthest = -1
    levels.forEach((l, i) => { if (l.state !== 'locked') furthest = i })
    if (furthest >= 0 && levels[furthest]!.state === 'completed') {
      const nxt = levels.findIndex((l, i) => i > furthest && l.state === 'locked')
      if (nxt >= 0) levels[nxt]!.state = 'next'
    }
    out.push({ program, label: PROGRAM_LABEL[program] ?? program, levels })
  }

  const cs = me.tetraCs
  return { programmes: out, advisor: cs?.name ? { name: cs.name } : null }
}
