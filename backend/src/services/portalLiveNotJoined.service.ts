import mongoose from 'mongoose'

/* ─────────────────────────────────────────────────────────────
   Booked but not joined (the user, 2026-10-28: "when a live class is on
   and a student booked it but hasn't joined yet — a popup at class time
   and a page"). For CS Portal. Read only.

   GET /service/live-not-joined — today's online classes (Dubai day) that
   have started, not cancelled: each with its mentor and the students who
   booked a seat (not cancelled) and have no attendance yet (attendedAt —
   the LMS room join or the join link click). `live` while the timetable
   says it runs (start … start + duration); after that it's a no-show.
   Offline classes are left out: nobody joins those online.
───────────────────────────────────────────────────────────── */

const TZ = '+04:00'
const DAY_MS = 86_400_000
const endOf = (c: { scheduledStart: Date; durationMins?: number }) => new Date(new Date(c.scheduledStart).getTime() + (c.durationMins ?? 0) * 60_000)

export async function liveNotJoinedForPortal(_q: unknown = {}, now = new Date()) {
  const { LiveClassModel, ClassBookingModel } = await import('@/models/schema.ts')
  const day = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10)
  const from = new Date(`${day}T00:00:00${TZ}`), to = new Date(from.getTime() + DAY_MS)
  const classes = await LiveClassModel.find(
    { scheduledStart: { $gte: from, $lt: to, $lte: now }, status: { $ne: 'cancelled' }, isOnline: { $ne: false } },
    { title: 1, scheduledStart: 1, durationMins: 1, instructorId: 1, coInstructorIds: 1, courseId: 1, status: 1, language: 1 },
  ).populate('instructorId', 'name email').populate('coInstructorIds', 'name email').populate('courseId', 'title')
    .sort({ scheduledStart: 1 }).lean() as any[]
  if (!classes.length) return { generatedAt: now.toISOString(), day, classes: [] }

  const bookings = await ClassBookingModel.find(
    { liveClassId: { $in: classes.map(c => c._id as mongoose.Types.ObjectId) }, status: { $ne: 'cancelled' } },
    { liveClassId: 1, userId: 1, attendedAt: 1, bookedAt: 1, status: 1 },
  ).populate('userId', 'name email phone').lean() as any[]
  const byClass = new Map<string, any[]>()
  for (const b of bookings) { const k = String(b.liveClassId); byClass.set(k, [...(byClass.get(k) ?? []), b]) }

  const person = (u: any) => u ? { name: u.name ?? '', email: String(u.email ?? '').toLowerCase() } : null
  return {
    generatedAt: now.toISOString(),
    day,
    classes: classes.map(c => {
      const all = byClass.get(String(c._id)) ?? []
      const missing = all.filter(b => !b.attendedAt && b.status !== 'attended' && b.userId)
      const end = endOf(c)
      return {
        id: String(c._id), title: c.title ?? '', course: c.courseId?.title ?? '', language: c.language ?? '',
        startsAt: c.scheduledStart, endsAt: end, live: now.getTime() < end.getTime(),
        mentor: person(c.instructorId), coMentors: (c.coInstructorIds ?? []).map(person).filter(Boolean),
        booked: all.length, joined: all.length - missing.length,
        notJoined: missing.map(b => ({
          bookingId: String(b._id), name: b.userId.name ?? '', email: String(b.userId.email ?? '').toLowerCase(),
          phone: b.userId.phone ?? '', bookedAt: b.bookedAt ?? null,
        })).sort((a, b) => a.name.localeCompare(b.name)),
      }
    }).filter(c => c.notJoined.length),
  }
}
