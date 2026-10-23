import mongoose from 'mongoose'
import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   The mentors' report (Tetra Commission's user, 2026-10-23): for each
   instructor and each day (Dubai time) — their live classes (held,
   cancelled), the students' bookings on them (cancelled, attended, missed),
   their 1:1 mentor meetings (booked, cancelled) and the reviews students
   left that day. The portal shows a chief mentor their own team's, matched
   by address. Read only; counts and names, never a student.
───────────────────────────────────────────────────────────── */

const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const DAY_MS = 86_400_000
const TZ = '+04:00' // the academy's day (Dubai)

type Day = {
  classes: number; held: number; classesCancelled: number
  bookings: number; bookingsCancelled: number; attended: number; missed: number
  meetings: number; meetingsCancelled: number
  reviews: number; ratingSum: number; lowRatings: number
  /** How many of each star, 1 … 5 (2026-10-23: the breakdown). */
  r1: number; r2: number; r3: number; r4: number; r5: number
}
const blank = (): Day => ({ classes: 0, held: 0, classesCancelled: 0, bookings: 0, bookingsCancelled: 0, attended: 0, missed: 0, meetings: 0, meetingsCancelled: 0, reviews: 0, ratingSum: 0, lowRatings: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 })
const dayOf = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10)

export async function mentorReportForPortal(q: { from?: unknown; to?: unknown; emails?: unknown }) {
  const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDay(q.from) || !isDay(q.to)) throw fail('from and to are days (YYYY-MM-DD)')
  const start = new Date(`${q.from}T00:00:00${TZ}`), end = new Date(new Date(`${q.to}T00:00:00${TZ}`).getTime() + DAY_MS)
  if (!(end > start)) throw fail('to comes before from')
  if (end.getTime() - start.getTime() > 93 * DAY_MS) throw fail('Three months at most')
  const emails = typeof q.emails === 'string' && q.emails.trim()
    ? [...new Set(q.emails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean))] : null

  const { UserModel, LiveClassModel, ClassBookingModel, MentorMeetingModel, InstructorReviewModel } = await import('@/models/schema.ts')
  // Only these instructors when the portal names them (a chief's team); otherwise everyone who taught, met or was reviewed.
  const named = emails
    ? await UserModel.find({ email: { $in: emails } }, { name: 1, email: 1 }).lean() as any[]
    : null
  const only = named ? { $in: named.map(u => u._id) } : undefined

  const classes = await LiveClassModel.find(
    { scheduledStart: { $gte: start, $lt: end }, ...(only ? { instructorId: only } : {}) },
    { instructorId: 1, scheduledStart: 1, status: 1, startedAt: 1 },
  ).lean() as any[]
  const classById = new Map(classes.map(c => [String(c._id), c]))
  const bookings = classes.length
    ? await ClassBookingModel.aggregate([
        { $match: { liveClassId: { $in: classes.map(c => c._id) } } },
        { $group: { _id: { c: '$liveClassId', s: '$status' }, n: { $sum: 1 } } },
      ])
    : []
  const meetings = await MentorMeetingModel.find(
    { scheduledStart: { $gte: start, $lt: end }, ...(only ? { mentorId: only } : {}) },
    { mentorId: 1, scheduledStart: 1, cancelledAt: 1 },
  ).lean() as any[]
  const reviews = await InstructorReviewModel.find(
    { createdAt: { $gte: start, $lt: end }, ...(only ? { instructorId: only } : {}) },
    { instructorId: 1, rating: 1, createdAt: 1 },
  ).lean() as any[]

  const table = new Map<string, Map<string, Day>>()
  const cell = (who: unknown, at: Date) => {
    const id = String(who ?? ''), day = dayOf(new Date(at))
    let days = table.get(id)
    if (!days) table.set(id, days = new Map())
    let d = days.get(day)
    if (!d) days.set(day, d = blank())
    return d
  }
  for (const c of classes) {
    const d = cell(c.instructorId, c.scheduledStart)
    if (c.status === 'cancelled') { d.classesCancelled++; continue }
    d.classes++
    if (c.status === 'ended' || c.status === 'live' || c.startedAt) d.held++
  }
  for (const b of bookings as any[]) {
    const c = classById.get(String(b._id.c))
    if (!c) continue
    const d = cell(c.instructorId, c.scheduledStart)
    d.bookings += b.n
    if (b._id.s === 'cancelled') d.bookingsCancelled += b.n
    else if (b._id.s === 'attended') d.attended += b.n
    else if (b._id.s === 'missed') d.missed += b.n
  }
  for (const m of meetings) {
    const d = cell(m.mentorId, m.scheduledStart)
    d.meetings++
    if (m.cancelledAt) d.meetingsCancelled++
  }
  for (const r of reviews) {
    const d = cell(r.instructorId, r.createdAt)
    d.reviews++; d.ratingSum += Number(r.rating) || 0
    if (Number(r.rating) <= 2) d.lowRatings++
    const star = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0))) as 1 | 2 | 3 | 4 | 5
    d[`r${star}`]++
  }

  const people = named ?? await UserModel.find({ _id: { $in: [...table.keys()].filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id)) } }, { name: 1, email: 1 }).lean() as any[]
  const finish = (d: Day) => {
    const { ratingSum, r1, r2, r3, r4, r5, ...rest } = d
    return { ...rest, avgRating: d.reviews ? Math.round((ratingSum / d.reviews) * 10) / 10 : null, ratingCounts: { 1: r1, 2: r2, 3: r3, 4: r4, 5: r5 } }
  }
  return {
    from: q.from, to: q.to, timezone: 'Asia/Dubai',
    mentors: people.map(u => {
      const days = [...(table.get(String(u._id)) ?? new Map<string, Day>()).entries()].sort(([a], [b]) => b.localeCompare(a))
      const total = days.reduce((t, [, d]) => {
        for (const k of Object.keys(t) as (keyof Day)[]) t[k] += d[k]
        return t
      }, blank())
      return { instructorId: String(u._id), name: u.name ?? '', email: String(u.email ?? '').toLowerCase(), total: finish(total), days: days.map(([day, d]) => ({ day, ...finish(d) })) }
    }),
  }
}
