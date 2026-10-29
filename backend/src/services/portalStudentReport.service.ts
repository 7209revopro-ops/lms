import { PortalError } from '@/services/portal.service.ts'

/* ─────────────────────────────────────────────────────────────
   The students' report (the user, 2026-10-29: "a students page in the
   reports — today's bookings, a date range past and future, which student
   and which class has the most bookings, the non-active students counted by
   CS with who they are, who attended fully"). For the Root portal's
   Reports → Students tab. Read only.

   GET /service/student-report?from=YYYY-MM-DD&to=YYYY-MM-DD&academy=dubai|bangalore
   - bookings: every seat on a class that starts in the dates (Dubai days),
     a cancelled seat left out (counted). Each seat is upcoming, live (the
     class is on), attended (attendedAt or status attended), or missed
     (status missed, or the class ended without a join). A seat on a class
     the academy cancelled is counted apart, not listed.
   - students / classes: the same seats per student and per class, the most
     booked first. A student attended fully when every seat that was due
     (attended + missed) was attended.
   - inactive: students with an active enrolment and an account that's on,
     not signed in for INACTIVE_DAYS or more (or never) — counted by their CS
     (tetraCs, kept by CS Portal), whatever the dates.
   One academy at a time, by the student's own account; none = both.
───────────────────────────────────────────────────────────── */

const fail = (message: string) => new PortalError('VALIDATION_ERROR', message, 400)
const DAY_MS = 86_400_000
const TZ = '+04:00' // the academy's day (Dubai)
/** Not signed in for this many days or more: non-active. */
export const INACTIVE_DAYS = 14
/** Most seats listed one by one; the counts are always whole. */
const MAX_LISTED = 3000

export type SeatState = 'upcoming' | 'live' | 'attended' | 'missed'
/** One seat's state, now — the CS Portal's rule (portal.service statusOf), with a class that ended unjoined a miss. */
export function seatState(b: { status?: string; attendedAt?: Date | null }, c: { scheduledStart: Date; durationMins?: number }, now = Date.now()): SeatState {
  if (b.attendedAt || b.status === 'attended') return 'attended'
  if (b.status === 'missed') return 'missed'
  const start = new Date(c.scheduledStart).getTime()
  if (start > now) return 'upcoming'
  return start + (c.durationMins ?? 0) * 60_000 > now ? 'live' : 'missed'
}

type Cs = { name: string; team: string; code: string; open: boolean }
const csOf = (u: any): Cs => ({ name: String(u?.tetraCs?.name ?? ''), team: String(u?.tetraCs?.team ?? ''), code: String(u?.tetraCs?.code ?? ''), open: !!u?.tetraCs?.open })

export async function studentReportForPortal(q: { from?: unknown; to?: unknown; academy?: unknown }, nowDate = new Date()) {
  const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDay(q.from) || !isDay(q.to)) throw fail('from and to are days (YYYY-MM-DD)')
  const start = new Date(`${q.from}T00:00:00${TZ}`), end = new Date(new Date(`${q.to}T00:00:00${TZ}`).getTime() + DAY_MS)
  if (!(end > start)) throw fail('to comes before from')
  if (end.getTime() - start.getTime() > 93 * DAY_MS) throw fail('Three months at most')
  const slug = typeof q.academy === 'string' ? q.academy.trim().toLowerCase() : ''
  if (slug && slug !== 'dubai' && slug !== 'bangalore') throw fail('academy is dubai or bangalore')
  const now = nowDate.getTime()

  const { UserModel, LiveClassModel, ClassBookingModel, EnrollmentModel, OrganizationModel } = await import('@/models/schema.ts')
  const orgs = await OrganizationModel.find({}, { name: 1, slug: 1 }).lean() as any[]
  const academyName = new Map(orgs.map(o => [String(o._id), String(o.name ?? '')]))
  const org = slug ? orgs.find(o => o.slug === slug) : null
  if (slug && !org) throw fail(`No ${slug} academy in the LMS`)
  const inAcademy = (u: any) => !org || String(u?.organizationId ?? '') === String(org._id)

  /* ── Seats on the dates' classes ── */
  const classes = await LiveClassModel.find(
    { scheduledStart: { $gte: start, $lt: end } },
    { title: 1, scheduledStart: 1, durationMins: 1, status: 1, instructorId: 1, courseId: 1, organizationId: 1, isOnline: 1 },
  ).populate('instructorId', 'name').populate('courseId', 'title').lean() as any[]
  const classById = new Map(classes.map(c => [String(c._id), c]))
  const seats = classes.length
    ? await ClassBookingModel.find({ liveClassId: { $in: classes.map(c => c._id) } }, { userId: 1, liveClassId: 1, status: 1, attendedAt: 1, bookedAt: 1 }).lean() as any[]
    : []
  const users = seats.length
    ? await UserModel.find({ _id: { $in: [...new Set(seats.map(s => String(s.userId)))] } }, { name: 1, email: 1, phone: 1, organizationId: 1, tetraCs: 1 }).lean() as any[]
    : []
  const userById = new Map(users.map(u => [String(u._id), u]))

  const person = (u: any) => ({ id: String(u._id), name: String(u.name ?? ''), email: String(u.email ?? ''), phone: String(u.phone ?? ''), academy: academyName.get(String(u.organizationId ?? '')) ?? '', cs: csOf(u) })
  const lesson = (c: any) => ({
    id: String(c._id), title: String(c.title ?? ''), course: String(c.courseId?.title ?? ''), mentor: String(c.instructorId?.name ?? ''),
    start: new Date(c.scheduledStart).toISOString(), durationMins: c.durationMins ?? 0, online: c.isOnline !== false,
  })

  const totals = { seats: 0, upcoming: 0, live: 0, attended: 0, missed: 0, cancelledSeats: 0, cancelledClassSeats: 0, students: 0, classes: 0 }
  type Tally = { booked: number; upcoming: number; live: number; attended: number; missed: number }
  const blank = (): Tally => ({ booked: 0, upcoming: 0, live: 0, attended: 0, missed: 0 })
  const perStudent = new Map<string, Tally & { u: any }>()
  const perClass = new Map<string, Tally & { c: any }>()
  const list: any[] = []
  for (const s of seats) {
    const u = userById.get(String(s.userId)), c = classById.get(String(s.liveClassId))
    if (!u || !c || !inAcademy(u)) continue
    if (s.status === 'cancelled') { totals.cancelledSeats++; continue }
    if (c.status === 'cancelled') { totals.cancelledClassSeats++; continue }
    const state = seatState(s, c, now)
    totals.seats++; totals[state]++
    const st = perStudent.get(String(u._id)) ?? { ...blank(), u }
    st.booked++; st[state]++; perStudent.set(String(u._id), st)
    const ct = perClass.get(String(c._id)) ?? { ...blank(), c }
    ct.booked++; ct[state]++; perClass.set(String(c._id), ct)
    list.push({ id: String(s._id), state, bookedAt: s.bookedAt ? new Date(s.bookedAt).toISOString() : '', student: person(u), class: lesson(c) })
  }
  totals.students = perStudent.size
  totals.classes = perClass.size
  list.sort((a, b) => a.class.start.localeCompare(b.class.start) || a.student.name.localeCompare(b.student.name))

  const students = [...perStudent.values()].map(({ u, ...t }) => {
    const due = t.attended + t.missed
    return { ...person(u), ...t, attendance: due ? (t.missed === 0 ? 'full' : t.attended ? 'some' : 'none') : 'not_due' }
  }).sort((a, b) => b.booked - a.booked || b.attended - a.attended || a.name.localeCompare(b.name))
  const fullness = { full: 0, some: 0, none: 0, not_due: 0 }
  for (const s of students) fullness[s.attendance as keyof typeof fullness]++
  const classRows = [...perClass.values()].map(({ c, ...t }) => ({ ...lesson(c), academy: academyName.get(String(c.organizationId ?? '')) ?? '', ...t }))
    .sort((a, b) => b.booked - a.booked || a.start.localeCompare(b.start))

  /* ── Non-active: enrolled, account on, no sign-in for INACTIVE_DAYS ── */
  const cut = new Date(now - INACTIVE_DAYS * DAY_MS)
  const enrolled = await EnrollmentModel.distinct('userId', { status: 'active' })
  const idle = await UserModel.find(
    {
      _id: { $in: enrolled }, role: 'student', isActive: { $ne: false },
      $or: [{ lastLoginAt: { $lt: cut } }, { lastLoginAt: { $exists: false } }, { lastLoginAt: null }],
      ...(org ? { organizationId: org._id } : {}),
    },
    { name: 1, email: 1, phone: 1, organizationId: 1, tetraCs: 1, lastLoginAt: 1, createdAt: 1 },
  ).lean() as any[]
  const byCs = new Map<string, { cs: string; team: string; count: number; never: number }>()
  for (const u of idle) {
    const cs = csOf(u), key = cs.name.toLowerCase()
    const row = byCs.get(key) ?? { cs: cs.name, team: cs.team, count: 0, never: 0 }
    row.count++
    if (!u.lastLoginAt) row.never++
    byCs.set(key, row)
  }
  const idleRows = idle.map(u => ({
    ...person(u),
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '',
    daysAway: u.lastLoginAt ? Math.floor((now - new Date(u.lastLoginAt).getTime()) / DAY_MS) : null,
    joinedAt: u.createdAt ? new Date(u.createdAt).toISOString() : '',
  })).sort((a, b) => (a.lastLoginAt || '0').localeCompare(b.lastLoginAt || '0') || a.name.localeCompare(b.name))

  return {
    generatedAt: nowDate.toISOString(), from: q.from, to: q.to, academy: slug || 'all',
    academies: orgs.map(o => ({ slug: String(o.slug ?? ''), name: String(o.name ?? '') })),
    totals,
    bookings: list.slice(0, MAX_LISTED), bookingsListed: Math.min(list.length, MAX_LISTED),
    students: students.slice(0, MAX_LISTED), fullness,
    classes: classRows.slice(0, MAX_LISTED),
    inactive: {
      days: INACTIVE_DAYS, total: idle.length, never: idle.filter(u => !u.lastLoginAt).length,
      byCs: [...byCs.values()].sort((a, b) => b.count - a.count || (a.cs ? 0 : 1) - (b.cs ? 0 : 1) || a.cs.localeCompare(b.cs)),
      students: idleRows.slice(0, MAX_LISTED * 2), listed: Math.min(idleRows.length, MAX_LISTED * 2),
    },
  }
}
