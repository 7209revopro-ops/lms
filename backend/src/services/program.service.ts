import crypto from 'node:crypto'
import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'
import { academyClock } from '@/utils/academyClock.ts'

/* ─────────────────────────────────────────────────────────────────────────────
   Programs (Tetra Commission's user, 2026-10-09) — a live class that repeats
   weekly on chosen days, or monthly on a date, until an end date, for the
   students picked for it and nobody else.

   Behind each program:
     · a hidden course (status draft, CourseModel.programId) its students are
       enrolled in — so every class of it admits them through the usual door
       (classEntitlement.service.ts) and nobody else;
     · one ordinary LiveClass per date (programId, seriesId = the program), made
       on the form's own path (LiveClassController.createForProgram: Meet link,
       instructor checks), with a seat booked for each student — so the usual
       reminders, join window and attendance follow.
   GET /live-classes hides a program's classes from students not on it.

   Changing the students books / frees their seats on the classes still to
   come; moving the program cancels the classes still to come and makes new
   ones; stopping it cancels them. Past classes are never touched.
───────────────────────────────────────────────────────────────────────────── */

export class ProgramError extends Error {
  public readonly code: string
  constructor(message: string, public readonly statusCode = 400) {
    super(message); this.name = 'ProgramError'
    this.code = statusCode === 404 ? 'NOT_FOUND' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR'
  }
}

const MAX_CLASSES = 60
/* A class holds at most 500 seats (LiveClass.sessionCapacity) and a program's
   classes are made with ten spare — so 490 students is as many as one program
   can seat. Picking a whole team or "all students" can go past it. */
export const MAX_PROGRAM_STUDENTS = 490
const tooMany = (n: number) => new ProgramError(`A program can have at most ${MAX_PROGRAM_STUDENTS} students — this would be ${n}. Pick a team or a CS instead of everyone.`)
const DEFAULT_TZ  = 'Asia/Dubai'
const DAY = 864e5

export interface Actor { id?: string; email?: string; name?: string; role: string; organizationId?: string | null }

export interface ScheduleInput {
  repeat?:       'weekly' | 'monthly'
  weekdays?:     number[]
  monthDay?:     number
  startDate?:    string
  endDate?:      string
  time?:         string
  durationMins?: number
}

/* ── Dates ─────────────────────────────────────────────────────────────── */
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayOf(s) !== null
function dayOf(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The dates (YYYY-MM-DD) a schedule falls on, first to last, inclusive. A monthly date past a short month's end takes its last day. */
export function programDates(p: { repeat: string; weekdays?: number[]; monthDay?: number; startDate: string; endDate: string }): string[] {
  const start = dayOf(p.startDate), end = dayOf(p.endDate)
  if (!start || !end || end < start) return []
  const out: string[] = []
  if (p.repeat === 'weekly') {
    const days = new Set(p.weekdays ?? [])
    for (let t = start.getTime(); t <= end.getTime() && out.length <= MAX_CLASSES; t += DAY) {
      const d = new Date(t)
      if (days.has(d.getUTCDay())) out.push(ymd(d))
    }
  } else {
    const want = p.monthDay ?? start.getUTCDate()
    for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); out.length <= MAX_CLASSES; m++) {
      if (m > 11) { y++; m = 0 }
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const d = new Date(Date.UTC(y, m, Math.min(want, last)))
      if (d > end) break
      if (d >= start) out.push(ymd(d))
    }
  }
  return out
}

/** A wall-clock date and time in `tz`, as an instant. */
export function wallToUtc(date: string, time: string, tz: string): Date {
  const asUtc = new Date(`${date}T${time}:00Z`)
  const there = new Date(asUtc.toLocaleString('en-US', { timeZone: tz }))
  const here  = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(asUtc.getTime() - (there.getTime() - here.getTime()))
}

function checkSchedule(s: Required<Pick<ScheduleInput, 'repeat' | 'startDate' | 'endDate' | 'time' | 'durationMins'>> & ScheduleInput) {
  if (!['weekly', 'monthly'].includes(s.repeat)) throw new ProgramError('Say how it repeats: weekly or monthly')
  if (!isDate(s.startDate) || !isDate(s.endDate)) throw new ProgramError('Give a first date and an end date')
  if (s.endDate < s.startDate) throw new ProgramError('The end date is before the first date')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new ProgramError('Give a time like 19:00')
  if (!Number.isFinite(s.durationMins) || s.durationMins < 15 || s.durationMins > 480) throw new ProgramError('The length is 15 minutes to 8 hours')
  if (s.repeat === 'weekly' && !(s.weekdays ?? []).some(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new ProgramError('Pick the weekdays it runs on')
  if (s.repeat === 'monthly' && s.monthDay != null && !(Number.isInteger(s.monthDay) && s.monthDay >= 1 && s.monthDay <= 31)) throw new ProgramError('The day of the month is 1 to 31')
  const n = programDates(s as any).length
  if (n === 0) throw new ProgramError('No class falls between those dates')
  if (n > MAX_CLASSES) throw new ProgramError(`That makes more than ${MAX_CLASSES} classes — pick a nearer end date`)
}

/* ── Who may manage ────────────────────────────────────────────────────── */
const ADMINS = new Set(['super_admin', 'admin', 'sub_admin', 'support'])
function mayManage(p: any, actor: Actor): boolean {
  if (actor.role === 'portal') return true
  if (ADMINS.has(actor.role)) return !actor.organizationId || !p.organizationId || String(p.organizationId) === String(actor.organizationId)
  return !!actor.id && (String(p.instructorId) === actor.id || String(p.createdById ?? '') === actor.id)
}

/* ── Students ──────────────────────────────────────────────────────────── */
/** Students by id or email, of this academy. Unknown ones come back in `missing`. */
export async function resolveStudents(refs: unknown, orgId: string | null): Promise<{ ids: Types.ObjectId[]; missing: string[] }> {
  const { UserModel } = await import('@/models/schema.ts')
  const list = (Array.isArray(refs) ? refs : []).map(r => String(r ?? '').trim()).filter(Boolean)
  const ids = list.filter(r => Types.ObjectId.isValid(r) && !r.includes('@'))
  const emails = list.filter(r => r.includes('@')).map(e => e.toLowerCase())
  const users = await UserModel.find({
    role: 'student',
    $or: [{ _id: { $in: ids.map(i => new Types.ObjectId(i)) } }, { email: { $in: emails } }],
    ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
  }).select('_id email').lean() as any[]
  const found = new Set(users.flatMap(u => [String(u._id), String(u.email ?? '').toLowerCase()]))
  return { ids: users.map(u => u._id), missing: list.filter(r => !found.has(r.toLowerCase())) }
}

async function enrol(courseId: Types.ObjectId, studentIds: Types.ObjectId[], orgId: unknown) {
  const { EnrollmentModel } = await import('@/models/schema.ts')
  for (const userId of studentIds) {
    await EnrollmentModel.updateOne(
      { userId, courseId },
      { $set: { status: 'active' }, $setOnInsert: { source: 'admin', enrolledAt: new Date(), progressPercent: 0, blockedLessons: [], ...(orgId ? { organizationId: orgId } : {}) } },
      { upsert: true },
    )
  }
}

/** A seat on each class for each student who has none yet. */
async function bookSeats(classIds: Types.ObjectId[], studentIds: Types.ObjectId[], door: { organizationId: string | null; courseId: string }) {
  const { ClassBookingModel } = await import('@/models/schema.ts')
  const { reserveSeat, seatStampFrom } = await import('@/services/seatPool.service.ts')
  for (const liveClassId of classIds) {
    for (const userId of studentIds) {
      const had: any = await ClassBookingModel.findOne({ userId, liveClassId }).lean()
      if (had && had.status !== 'cancelled') continue
      const reserved = await reserveSeat(String(liveClassId), null)
      if (!reserved) continue
      const stamp = seatStampFrom(reserved, door)
      if (had) {
        await ClassBookingModel.updateOne({ _id: had._id }, { $set: { status: 'booked', bookedAt: new Date(), ...stamp }, $unset: { cancelledAt: '' } })
      } else {
        await ClassBookingModel.create({ userId, liveClassId, status: 'booked', bookedAt: new Date(), ...stamp })
      }
    }
  }
}

async function freeSeats(classIds: Types.ObjectId[], studentIds: Types.ObjectId[]) {
  const { ClassBookingModel } = await import('@/models/schema.ts')
  const { releaseSeat } = await import('@/services/seatPool.service.ts')
  const rows = await ClassBookingModel.find({ liveClassId: { $in: classIds }, userId: { $in: studentIds }, status: 'booked' }).lean() as any[]
  for (const b of rows) {
    const r = await ClassBookingModel.updateOne({ _id: b._id, status: 'booked' }, { $set: { status: 'cancelled', cancelledAt: new Date() } })
    if (r.modifiedCount) await releaseSeat(b)
  }
}

/* ── Classes ───────────────────────────────────────────────────────────── */
async function upcomingClassIds(programId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  return (await LiveClassModel.find({ programId, status: 'scheduled', scheduledStart: { $gt: new Date() } }).select('_id').lean() as any[]).map(c => c._id)
}

/** Every date of the program still ahead, as a class with the students booked. Returns how many were made. */
async function makeClasses(p: any, actor: Actor): Promise<number> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const { LiveClassController } = await import('@/controllers/liveClass.controller.ts')
  const ctrl = new LiveClassController()
  const now = Date.now()
  const made: Types.ObjectId[] = []
  for (const date of programDates(p)) {
    const start = wallToUtc(date, p.time, p.timezone || DEFAULT_TZ)
    if (start.getTime() <= now) continue
    const { live } = await ctrl.createForProgram({
      courseId: String(p.courseId), title: p.title, description: p.description, scheduledStart: start, durationMins: p.durationMins,
      instructorId: String(p.instructorId), sessionCapacity: Math.max(30, (p.studentIds?.length ?? 0) + 10),
      isOnline: p.isOnline, location: p.location, ...(p.organizationId ? { organizationId: String(p.organizationId) } : {}),
    }, { id: actor.id && Types.ObjectId.isValid(actor.id) ? actor.id : String(p.instructorId), role: actor.role === 'portal' ? 'admin' : actor.role, ...(p.organizationId ? { organizationId: String(p.organizationId) } : {}) }, String(p._id))
    await LiveClassModel.updateOne({ _id: (live as any)._id }, { $set: { programId: p._id } })
    made.push((live as any)._id)
  }
  await bookSeats(made, p.studentIds ?? [], { organizationId: p.organizationId ? String(p.organizationId) : null, courseId: String(p.courseId) })
  return made.length
}

async function cancelUpcoming(programId: Types.ObjectId, reason: string): Promise<number> {
  const { LiveClassService } = await import('@/services/liveClass.service.ts')
  const svc = new LiveClassService()
  const ids = await upcomingClassIds(programId)
  for (const id of ids) await svc.update(String(id), { status: 'cancelled', rescheduledReason: reason })
  return ids.length
}

/* ── The answer ────────────────────────────────────────────────────────── */
async function present(p: any) {
  const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
  const [students, mentor, classes] = await Promise.all([
    UserModel.find({ _id: { $in: p.studentIds ?? [] } }).select('name email').lean() as Promise<any[]>,
    UserModel.findById(p.instructorId).select('name email').lean() as Promise<any>,
    LiveClassModel.find({ programId: p._id }).sort({ scheduledStart: 1 }).select('scheduledStart status durationMins').lean() as Promise<any[]>,
  ])
  const now = Date.now()
  return {
    id: String(p._id), title: p.title, description: p.description ?? '', status: p.status, source: p.source,
    repeat: p.repeat, weekdays: p.weekdays ?? [], monthDay: p.monthDay ?? null, startDate: p.startDate, endDate: p.endDate,
    time: p.time, timezone: p.timezone, durationMins: p.durationMins, isOnline: p.isOnline, location: p.location ?? '',
    mentor: mentor ? { id: String(mentor._id), name: mentor.name, email: mentor.email } : null,
    students: students.map(s => ({ id: String(s._id), name: s.name, email: s.email })),
    createdByName: p.createdByName ?? '', createdByEmail: p.createdByEmail ?? '',
    classes: classes.map(c => ({ id: String(c._id), startsAt: c.scheduledStart, status: c.status })),
    nextClassAt: classes.find(c => c.status === 'scheduled' && new Date(c.scheduledStart).getTime() > now)?.scheduledStart ?? null,
  }
}

async function load(id: string, actor: Actor) {
  const { ProgramModel } = await import('@/models/schema.ts')
  if (!Types.ObjectId.isValid(id)) throw new ProgramError('No such program', 404)
  const p: any = await ProgramModel.findById(id)
  if (!p || (actor.organizationId && p.organizationId && String(p.organizationId) !== String(actor.organizationId))) throw new ProgramError('No such program', 404)
  if (!mayManage(p, actor)) throw new ProgramError('Only who made this program, its mentor or an admin can change it', 403)
  return p
}

/* ── API ───────────────────────────────────────────────────────────────── */
export async function createProgram(input: Record<string, any>, actor: Actor) {
  const { ProgramModel, CourseModel, UserModel } = await import('@/models/schema.ts')
  const title = String(input.title ?? '').trim()
  if (title.length < 3) throw new ProgramError('Give the program a title')
  const orgId = actor.organizationId ?? (input.organizationId ? String(input.organizationId) : null)
  const s = {
    repeat: input.repeat, weekdays: (input.weekdays ?? []).map(Number), monthDay: input.monthDay == null || input.monthDay === '' ? undefined : Number(input.monthDay),
    startDate: String(input.startDate ?? ''), endDate: String(input.endDate ?? ''), time: String(input.time ?? ''), durationMins: Number(input.durationMins),
  }
  checkSchedule(s as any)
  const isOnline = input.isOnline !== false
  if (!isOnline && String(input.location ?? '').trim().length < 2) throw new ProgramError('Say where it happens')

  // The mentor: given by id or email; an instructor making it is the mentor unless they name another.
  const mentorRef = String(input.instructorId ?? input.mentorEmail ?? '').trim()
  const mentor: any = mentorRef
    ? await UserModel.findOne(mentorRef.includes('@') ? { email: mentorRef.toLowerCase() } : { _id: Types.ObjectId.isValid(mentorRef) ? mentorRef : null }).select('_id role organizationId sharedAcrossOrgs').lean()
    : actor.role === 'instructor' && actor.id ? await UserModel.findById(actor.id).select('_id role organizationId').lean() : null
  if (!mentor || mentor.role === 'student') throw new ProgramError('Pick the mentor who takes it')

  const { ids, missing } = await resolveStudents(input.students ?? input.studentIds, orgId)
  if (!ids.length) throw new ProgramError(missing.length ? `Not students on the LMS: ${missing.join(', ')}` : 'Add at least one student')
  if (ids.length > MAX_PROGRAM_STUDENTS) throw tooMany(ids.length)

  const programId = new Types.ObjectId()
  const course = await CourseModel.create({
    title: `Program: ${title}`, slug: `program-${crypto.randomBytes(6).toString('hex')}`, description: String(input.description ?? '').trim() || title,
    instructorId: mentor._id, price: 0, isFree: true, status: 'draft', language: 'English', programId,
    ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
  } as any)
  const p: any = await ProgramModel.create({
    _id: programId, title, description: String(input.description ?? '').trim(), ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
    instructorId: mentor._id, courseId: course._id, ...s, timezone: DEFAULT_TZ, isOnline, location: String(input.location ?? '').trim(),
    studentIds: ids, status: 'active', source: actor.role === 'portal' ? 'portal' : 'lms',
    ...(actor.id && Types.ObjectId.isValid(actor.id) ? { createdById: new Types.ObjectId(actor.id) } : {}),
    createdByEmail: actor.email ?? String(input.createdByEmail ?? ''), createdByName: actor.name ?? String(input.createdByName ?? ''),
  })
  await enrol(course._id, ids, p.organizationId)
  try {
    await makeClasses(p, actor)
  } catch (err) {
    // Nothing half-made: no class could be made (a Meet outage, a mentor of another academy) → undo it all.
    await cancelUpcoming(p._id, 'Program not created').catch(() => {})
    const { EnrollmentModel } = await import('@/models/schema.ts')
    await Promise.all([ProgramModel.deleteOne({ _id: p._id }), EnrollmentModel.deleteMany({ courseId: course._id }), CourseModel.deleteOne({ _id: course._id })])
    throw err
  }
  /* Its students are told it exists — in-app, email and WhatsApp. Only here, at
     creation; students added later are not messaged. Not awaited: a team is
     hundreds of messages, and the program is already made. */
  void notifyProgramCreated(p).catch(err => logger.error({ err, programId: String(p._id) }, 'program: telling its students failed'))
  return { ...(await present(p)), missing }
}

export async function listPrograms(actor: Actor, opts: { studentEmails?: string[]; mine?: boolean } = {}) {
  const { ProgramModel, UserModel } = await import('@/models/schema.ts')
  const q: Record<string, unknown> = {}
  if (actor.organizationId) q['organizationId'] = new Types.ObjectId(actor.organizationId)
  if (actor.role === 'instructor' && actor.id) q['$or'] = [{ instructorId: new Types.ObjectId(actor.id) }, { createdById: new Types.ObjectId(actor.id) }]
  if (opts.studentEmails) {
    const ids = (await UserModel.find({ email: { $in: opts.studentEmails.map(e => e.toLowerCase()) }, role: 'student' }).select('_id').lean() as any[]).map(u => u._id)
    q['studentIds'] = { $in: ids }
  }
  const rows = await ProgramModel.find(q).sort({ createdAt: -1 }).limit(300).lean()
  return Promise.all(rows.map(present))
}

export async function getProgram(id: string, actor: Actor) {
  return present(await load(id, actor))
}

/** Add and/or take away students: seats booked or freed on the classes still to come. */
export async function changeStudents(id: string, input: { add?: unknown; remove?: unknown }, actor: Actor) {
  const p = await load(id, actor)
  if (p.status !== 'active') throw new ProgramError('This program is stopped')
  const orgId = p.organizationId ? String(p.organizationId) : null
  const add = await resolveStudents(input.add, orgId)
  const remove = await resolveStudents(input.remove, orgId)
  const have = new Set((p.studentIds ?? []).map(String))
  const added = add.ids.filter(i => !have.has(String(i)))
  const removed = remove.ids.filter(i => have.has(String(i)))
  const after = have.size + added.length - removed.length
  if (after > MAX_PROGRAM_STUDENTS) throw tooMany(after)
  const upcoming = await upcomingClassIds(p._id)
  if (added.length) {
    await enrol(p.courseId, added, p.organizationId)
    await bookSeats(upcoming, added, { organizationId: orgId, courseId: String(p.courseId) })
  }
  if (removed.length) {
    const { EnrollmentModel } = await import('@/models/schema.ts')
    await EnrollmentModel.updateMany({ courseId: p.courseId, userId: { $in: removed } }, { $set: { status: 'dropped' } })
    await freeSeats(upcoming, removed)
  }
  const gone = new Set(removed.map(String))
  p.studentIds = [...(p.studentIds ?? []).filter((i: any) => !gone.has(String(i))), ...added]
  await p.save()
  return { ...(await present(p)), missing: [...add.missing, ...remove.missing] }
}

/** New time, days, dates or length: the classes still to come are cancelled and made again. */
export async function rescheduleProgram(id: string, input: Record<string, any>, actor: Actor) {
  const p = await load(id, actor)
  if (p.status !== 'active') throw new ProgramError('This program is stopped')
  const s = {
    repeat: input.repeat ?? p.repeat, weekdays: (input.weekdays ?? p.weekdays ?? []).map(Number),
    monthDay: input.monthDay === undefined ? p.monthDay : (input.monthDay === null || input.monthDay === '' ? undefined : Number(input.monthDay)),
    startDate: String(input.startDate ?? p.startDate), endDate: String(input.endDate ?? p.endDate), time: String(input.time ?? p.time), durationMins: Number(input.durationMins ?? p.durationMins),
  }
  checkSchedule(s as any)
  if (typeof input.title === 'string' && input.title.trim().length >= 3) p.title = input.title.trim()
  if (typeof input.description === 'string') p.description = input.description.trim()
  if (typeof input.isOnline === 'boolean') p.isOnline = input.isOnline
  if (typeof input.location === 'string') p.location = input.location.trim()
  if (!p.isOnline && String(p.location ?? '').length < 2) throw new ProgramError('Say where it happens')
  Object.assign(p, s)
  await cancelUpcoming(p._id, 'Program moved')
  await p.save()
  await makeClasses(p, actor)
  return present(p)
}

/** Stopped: the classes still to come are cancelled; the past ones stay. */
export async function stopProgram(id: string, actor: Actor) {
  const p = await load(id, actor)
  if (p.status === 'stopped') return present(p)
  await cancelUpcoming(p._id, 'Program stopped')
  p.status = 'stopped'
  await p.save()
  return present(p)
}

/* ── Picking students by commission team, by CS, or all ────────────────────
   Tetra Commission (the commission portal) gives every Forex student a team and
   a CS, and the LMS keeps both on the student (User.tetraCs). The program form
   picks from those the way the portal groups its students. Approved, active
   students of the academy only. */
const pickable = (orgId: string | null) => ({
  role: 'student', isActive: { $ne: false }, enrollmentStatus: 'approved',
  ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
})

/** The academy's commission teams and CS, each with how many students it has, and the total. */
export async function programAudiences(orgId: string | null): Promise<{
  total: number; teams: Array<{ team: string; count: number }>; cs: Array<{ name: string; team: string; count: number }>
}> {
  const { UserModel } = await import('@/models/schema.ts')
  const base = pickable(orgId)
  const [total, teams, cs] = await Promise.all([
    UserModel.countDocuments(base),
    UserModel.aggregate([{ $match: { ...base, 'tetraCs.team': { $nin: [null, ''] } } },
      { $group: { _id: '$tetraCs.team', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    UserModel.aggregate([{ $match: { ...base, 'tetraCs.name': { $nin: [null, ''] } } },
      { $group: { _id: { name: '$tetraCs.name', team: '$tetraCs.team' }, count: { $sum: 1 } } }, { $sort: { '_id.team': 1, '_id.name': 1 } }]),
  ])
  return {
    total,
    teams: (teams as any[]).map(t => ({ team: String(t._id), count: t.count })),
    cs: (cs as any[]).map(c => ({ name: String(c._id.name), team: String(c._id.team ?? ''), count: c.count })),
  }
}

/** The students of one team, one CS (optionally within a team), or everyone — at most MAX + 1, so a caller can tell it went over. */
export async function programAudienceStudents(orgId: string | null, pick: { team?: string; cs?: string; all?: boolean }): Promise<Array<{ id: string; name: string; email: string }>> {
  const { UserModel } = await import('@/models/schema.ts')
  const q: Record<string, unknown> = pickable(orgId)
  if (pick.team) q['tetraCs.team'] = pick.team
  if (pick.cs) q['tetraCs.name'] = pick.cs
  if (!pick.team && !pick.cs && !pick.all) return []
  const rows = await UserModel.find(q).select('name email').sort({ name: 1 }).limit(MAX_PROGRAM_STUDENTS + 1).lean() as any[]
  return rows.map(u => ({ id: String(u._id), name: u.name, email: u.email }))
}

/* ── Telling the students a program was made for them ─────────────────────
   In-app, an email, and WhatsApp course_update_v1 ("there's an update about
   your course {program}: {when it meets}") with a sign-in button to their Class
   Schedule. The days and time in each READER's academy clock, read off the
   classes actually made. */
function scheduleFor(p: any, starts: Date[], slug: string | null | undefined): string {
  if (!starts.length) return 'No classes are left to come.'
  const zone = academyClock(starts[0]!, slug).zone
  const day = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { ...o, timeZone: zone })
  const time = academyClock(starts[0]!, slug).time
  const first = day(starts[0]!, { weekday: 'short', day: 'numeric', month: 'short' })
  const last = day(starts[starts.length - 1]!, { weekday: 'short', day: 'numeric', month: 'short' })
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const when = p.repeat === 'monthly'
    ? `every month on the ${day(starts[0]!, { day: 'numeric' })}`
    : `every ${[...new Set(starts.map(d => day(d, { weekday: 'short' })))].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ')}`
  const n = starts.length
  const where = p.isOnline ? 'online' : `at ${p.location}`
  return `${n} class${n === 1 ? '' : 'es'}, ${when} at ${time}, ${where} — from ${first} to ${last}. You are booked on every one.`
}

export async function notifyProgramCreated(p: any): Promise<{ notified: number; emailed: number; whatsapp: number }> {
  const { UserModel, LiveClassModel } = await import('@/models/schema.ts')
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { sendProgramAdded } = await import('@/services/email.service.ts')
  const { sendTemplateMessage } = await import('@/services/whatsapp.service.ts')
  const { mintSigninCode } = await import('@/services/signinLink.service.ts')
  const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { SCHEDULE_LINK } = await import('@/utils/clientLinks.ts')
  const notifications = new NotificationService()
  await ensureOrgSlugs().catch(() => {})
  const starts = (await LiveClassModel.find({ programId: p._id, status: 'scheduled', scheduledStart: { $gt: new Date() } })
    .sort({ scheduledStart: 1 }).select('scheduledStart').lean() as any[]).map(c => new Date(c.scheduledStart))
  const mentor = await UserModel.findById(p.instructorId).select('name').lean() as any
  const students = await UserModel.find({ _id: { $in: p.studentIds ?? [] } }).select('name email organizationId enrollmentApplication.phone').lean() as any[]
  const tally = { notified: 0, emailed: 0, whatsapp: 0 }
  for (const u of students) {
    const schedule = scheduleFor(p, starts, orgSlugFor(u.organizationId))
    try {
      await notifications.create(String(u._id), { kind: 'system', title: `New program: ${p.title}`, body: schedule, link: SCHEDULE_LINK })
      tally.notified++
    } catch (err) { logger.warn({ err, userId: String(u._id) }, 'program: in-app notice failed') }
    if (u.email) {
      try { await sendProgramAdded(u.email, u.name ?? '', p.title, schedule, mentor?.name ?? '', p.description ?? ''); tally.emailed++ }
      catch (err) { logger.warn({ err, to: u.email }, 'program: email failed') }
    }
    const phone = u.enrollmentApplication?.phone
    if (phone) {
      try {
        const code = await mintSigninCode(String(u._id), '/class-bookings')
        await sendTemplateMessage(phone, 'course_update_v1', [u.name || 'there', p.title, `You have been added to this program. ${schedule}`], code)
        tally.whatsapp++
      } catch (err) { logger.warn({ err, userId: String(u._id) }, 'program: WhatsApp failed') }
    }
  }
  logger.info({ programId: String(p._id), students: students.length, ...tally }, 'program: students told')
  return tally
}
