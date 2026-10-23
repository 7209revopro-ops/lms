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
/* The languages classes are taught in (LiveClass.language). */
export const PROGRAM_LANGUAGES = ['English', 'Hindi', 'Hindi/English', 'Malayalam', 'Tamil', 'Arabic', 'Urdu']
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
  /* One bulk write, not one per student — a program can be thousands of students. */
  for (let i = 0; i < studentIds.length; i += 1000) {
    await EnrollmentModel.bulkWrite(studentIds.slice(i, i + 1000).map(userId => ({
      updateOne: {
        filter: { userId, courseId },
        update: { $set: { status: 'active' }, $setOnInsert: { source: 'admin', enrolledAt: new Date(), progressPercent: 0, blockedLessons: [], ...(orgId ? { organizationId: orgId } : {}) } },
        upsert: true,
      },
    })) as any, { ordered: false })
  }
}

/** A seat on each class for each student who has none yet. No limit on how many: the class's room grows to fit. */
async function bookSeats(classIds: Types.ObjectId[], studentIds: Types.ObjectId[], door: { organizationId: string | null; courseId: string }) {
  const { ClassBookingModel } = await import('@/models/schema.ts')
  const { reserveSeat, reserveFlatSeats, seatStampFrom } = await import('@/services/seatPool.service.ts')
  const flatStamp = seatStampFrom({ pool: { kind: 'flat' } } as any, door)
  for (const liveClassId of classIds) {
    const id = String(liveClassId)
    const existing = await ClassBookingModel.find({ liveClassId, userId: { $in: studentIds } }).select('userId status').lean() as any[]
    const had = new Map(existing.map(b => [String(b.userId), b]))
    const fresh = studentIds.filter(u => !had.has(String(u)))
    const revive = existing.filter(b => b.status === 'cancelled')
    const want = fresh.length + revive.length
    if (!want) continue

    /* Every Program class: all its seats in one go. */
    if (await reserveFlatSeats(id, want)) {
      let inserted = fresh.length
      for (let i = 0; i < fresh.length; i += 1000) {
        try {
          await ClassBookingModel.insertMany(fresh.slice(i, i + 1000).map(userId => ({ userId, liveClassId, status: 'booked', bookedAt: new Date(), ...flatStamp })), { ordered: false })
        } catch (err: any) {
          /* A booking made in between (unique userId+class): that seat was not used — give it back. */
          const ok = err?.insertedDocs?.length ?? err?.result?.insertedCount ?? 0
          inserted -= Math.min(1000, fresh.length - i) - ok
        }
      }
      if (revive.length) {
        await ClassBookingModel.updateMany({ _id: { $in: revive.map(b => b._id) } }, { $set: { status: 'booked', bookedAt: new Date(), ...flatStamp }, $unset: { cancelledAt: '' } })
      }
      if (inserted < fresh.length) await reserveFlatSeats(id, inserted - fresh.length)
      continue
    }

    /* A class with academy floors: one seat at a time through its pools. */
    for (const userId of [...fresh, ...revive.map(b => b.userId)]) {
      const reserved = await reserveSeat(id, null)
      if (!reserved) continue
      const stamp = seatStampFrom(reserved, door)
      const prev = had.get(String(userId))
      if (prev) await ClassBookingModel.updateOne({ _id: prev._id }, { $set: { status: 'booked', bookedAt: new Date(), ...stamp }, $unset: { cancelledAt: '' } })
      else await ClassBookingModel.create({ userId, liveClassId, status: 'booked', bookedAt: new Date(), ...stamp })
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

/* Co-mentors: other instructors (or admins) by id or email — never a student, never the main mentor. */
async function resolveCoMentors(refs: unknown, mainId: unknown): Promise<Types.ObjectId[]> {
  const { UserModel } = await import('@/models/schema.ts')
  const list = (Array.isArray(refs) ? refs : []).map(r => String(r ?? '').trim()).filter(Boolean)
  if (!list.length) return []
  const ids = list.filter(r => Types.ObjectId.isValid(r) && !r.includes('@')).map(r => new Types.ObjectId(r))
  const emails = list.filter(r => r.includes('@')).map(e => e.toLowerCase())
  const users = await UserModel.find({ $or: [{ _id: { $in: ids } }, { email: { $in: emails } }], role: { $ne: 'student' } }).select('_id').lean() as any[]
  if (users.length < list.length) throw new ProgramError('A co-mentor was not found, or is not staff')
  return users.map(u => u._id).filter(id => String(id) !== String(mainId))
}

/* Its picture (the portal, 2026-10-15): an https address, or '' to take it off. The student app shows it on the class
   cards through the program's hidden course. */
function imageOf(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const url = String(v).trim()
  if (!url) return ''
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 2048) throw new ProgramError('The picture must be an https address')
  return url
}

/* How its classes meet. 'link' needs a Google Meet link; 'app' is online only. */
function meetingChoice(input: Record<string, any>, isOnline: boolean): { mode: 'auto' | 'link' | 'app'; url?: string } {
  const mode = input.meetingMode === 'link' || input.meetingMode === 'app' ? input.meetingMode : 'auto'
  if (!isOnline) return { mode: 'auto' }
  if (mode === 'link') {
    const url = String(input.meetingUrl ?? '').trim()
    if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i.test(url)) {
      throw new ProgramError('Paste a Google Meet link — https://meet.google.com/abc-defg-hij')
    }
    return { mode, url }
  }
  return { mode }
}

/** Every date of the program still ahead, as a class with the students booked. Returns how many were made. */
async function makeClasses(p: any, actor: Actor): Promise<number> {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const { LiveClassController } = await import('@/controllers/liveClass.controller.ts')
  const ctrl = new LiveClassController()
  const now = Date.now()
  const made: Types.ObjectId[] = []
  const { UserModel } = await import('@/models/schema.ts')
  const { effectiveMeetEmail } = await import('@/services/googleMeet.service.ts')
  const coIds: Types.ObjectId[] = p.coInstructorIds ?? []
  const cohostEmails = coIds.length
    ? (await UserModel.find({ _id: { $in: coIds } }).select('email meetEmail').lean() as any[]).map(u => effectiveMeetEmail(u)).filter(Boolean) as string[]
    : []
  const how = { meetingMode: (p.meetingMode ?? 'auto') as 'auto' | 'link' | 'app', ...(p.meetingUrl ? { meetingUrl: p.meetingUrl } : {}), cohostEmails }
  for (const date of programDates(p)) {
    const start = wallToUtc(date, p.time, p.timezone || DEFAULT_TZ)
    if (start.getTime() <= now) continue
    const { live } = await ctrl.createForProgram({
      courseId: String(p.courseId), title: p.title, description: p.description, scheduledStart: start, durationMins: p.durationMins,
      instructorId: String(p.instructorId), sessionCapacity: Math.max(30, (p.studentIds?.length ?? 0) + 10),
      isOnline: p.isOnline, location: p.location, language: p.language || 'English', ...(p.organizationId ? { organizationId: String(p.organizationId) } : {}),
    }, { id: actor.id && Types.ObjectId.isValid(actor.id) ? actor.id : String(p.instructorId), role: actor.role === 'portal' ? 'admin' : actor.role, ...(p.organizationId ? { organizationId: String(p.organizationId) } : {}) }, String(p._id), how)
    await LiveClassModel.updateOne({ _id: (live as any)._id }, { $set: { programId: p._id, ...(coIds.length ? { coInstructorIds: coIds } : {}) } })
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
/* ── The shareable link (2026-10-17) ───────────────────────────────────────
   {CLIENT_URL}/p/{joinCode}: an LMS student on it signs in and joins as usual; anyone else fills in a short form
   (name, email, phone) and gets the class's Join button. Copied from the LMS admin's and the commission portal's
   programme lists. */
const JOIN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const newJoinCode = () => Array.from(crypto.randomBytes(8), b => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join('')
export const programJoinUrl = (code: string) => `${String(process.env['CLIENT_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '')}/p/${code}`

/** Its join code — made the first time a program is shown, for programs made before links existed. */
async function joinCodeOf(p: any): Promise<string> {
  if (p.joinCode) return p.joinCode
  const { ProgramModel } = await import('@/models/schema.ts')
  for (let i = 0; i < 5; i++) {
    const code = newJoinCode()
    try {
      const r = await ProgramModel.updateOne({ _id: p._id, joinCode: { $exists: false } }, { $set: { joinCode: code } })
      if (r.modifiedCount) { p.joinCode = code; return code }
      const again = await ProgramModel.findById(p._id).select('joinCode').lean<{ joinCode?: string }>()
      if (again?.joinCode) { p.joinCode = again.joinCode; return again.joinCode }
    } catch { /* a code already taken (unique) — try another */ }
  }
  throw new ProgramError('Could not make a link for this program', 500)
}

/* The class a link opens: the one on now, else the next. Joinable from 15 minutes before it starts until it ends. */
async function currentClassOf(programId: unknown) {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const now = Date.now()
  const rows = await LiveClassModel.find({ programId, status: { $in: ['scheduled', 'live'] } })
    .sort({ scheduledStart: 1 }).select('scheduledStart durationMins status type meetingUrl isOnline location').lean() as any[]
  const cls = rows.find(c => new Date(c.scheduledStart).getTime() + (c.durationMins ?? 60) * 60_000 > now)
  if (!cls) return null
  const start = new Date(cls.scheduledStart).getTime(), end = start + (cls.durationMins ?? 60) * 60_000
  return { cls, start, end, joinable: now >= start - 15 * 60_000 && now < end }
}

/** What the link's page shows — public, so nothing about who is on it. */
export async function programPublic(code: string) {
  const { ProgramModel, UserModel } = await import('@/models/schema.ts')
  const p: any = /^[a-z0-9]{6,16}$/.test(code) ? await ProgramModel.findOne({ joinCode: code }).lean() : null
  if (!p) throw new ProgramError('This program link is not valid', 404)
  const mentor = await UserModel.findById(p.instructorId).select('name').lean() as any
  const cur = p.status === 'active' ? await currentClassOf(p._id) : null
  return {
    title: p.title, description: p.description ?? '', mentor: mentor?.name ?? '', language: p.language || 'English',
    thumbnailUrl: p.thumbnailUrl ?? '', isOnline: p.isOnline !== false, location: p.location ?? '',
    status: p.status, repeat: p.repeat, weekdays: p.weekdays ?? [], monthDay: p.monthDay ?? null, time: p.time, timezone: p.timezone,
    nextClass: cur ? { id: String(cur.cls._id), startsAt: new Date(cur.start).toISOString(), endsAt: new Date(cur.end).toISOString(), joinable: cur.joinable } : null,
  }
}

/**
 * Someone without an LMS account fills in the link's form: kept as a guest of the program (one per email), and given
 * the class's join link when it can be joined. An LMS student on the program is told to sign in instead.
 */
export async function joinAsGuest(code: string, input: { name?: unknown; email?: unknown; phone?: unknown }) {
  const { ProgramModel, ProgramGuestModel, UserModel } = await import('@/models/schema.ts')
  const name = String(input.name ?? '').trim(), email = String(input.email ?? '').trim().toLowerCase(), phone = String(input.phone ?? '').trim()
  if (name.length < 2 || name.length > 120) throw new ProgramError('Please enter your name')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new ProgramError('Please enter a valid email')
  if (phone.replace(/\D/g, '').length < 8 || phone.length > 30) throw new ProgramError('Please enter your phone number with the country code')
  const p: any = /^[a-z0-9]{6,16}$/.test(code) ? await ProgramModel.findOne({ joinCode: code }).lean() : null
  if (!p) throw new ProgramError('This program link is not valid', 404)
  if (p.status !== 'active') throw new ProgramError('This program has ended')

  const cur = await currentClassOf(p._id)
  const meet = meetLinkOf(p, cur)

  /* An LMS student on the program goes straight to Meet too (2026-10-18, the user: "everyone to go
     straight to Meet, not to the LMS") — their join recorded as from the class page. Only with no
     Meet link to give (an in-app stream) are they still sent to sign in. */
  const member = await UserModel.findOne({ email, _id: { $in: p.studentIds ?? [] } }).select('_id').lean() as { _id: unknown } | null
  if (member) {
    if (!meet) return { member: true as const, joinUrl: null }
    await recordProgramJoin(member._id, cur)
    return { member: true as const, joinUrl: meet, nextClass: cur ? { startsAt: new Date(cur.start).toISOString(), endsAt: new Date(cur.end).toISOString(), joinable: cur.joinable } : null, note: '' }
  }

  await ProgramGuestModel.updateOne(
    { programId: p._id, email },
    { $set: { name, phone, ...(meet ? { lastJoinAt: new Date() } : {}) }, $inc: { joins: meet ? 1 : 0 } },
    { upsert: true },
  )
  return {
    member: false as const,
    nextClass: cur ? { startsAt: new Date(cur.start).toISOString(), endsAt: new Date(cur.end).toISOString(), joinable: cur.joinable } : null,
    joinUrl: meet,
    /* An in-app (LMS) stream or an in-person class has no link to give a guest. */
    note: meet ? ''
      : !cur ? 'No class is coming up for this program.'
      : cur.cls.isOnline === false ? `This class is in person${cur.cls.location ? ` — ${cur.cls.location}` : ''}.`
      : 'This class is in the LMS app — ask your counsellor for an LMS account to join.',
  }
}

/** The visitor of a programme's link: signed in as a student, and on it? With the Meet link to go
    straight to (2026-10-18), else the class to open. */
export async function programVisitor(code: string, studentId: string | null) {
  const { ProgramModel } = await import('@/models/schema.ts')
  if (!studentId) return { signedIn: false, member: false, classId: null, joinable: false, meetUrl: null }
  const p: any = /^[a-z0-9]{6,16}$/.test(code) ? await ProgramModel.findOne({ joinCode: code }).select('studentIds status isOnline meetingUrl').lean() : null
  if (!p) throw new ProgramError('This program link is not valid', 404)
  const member = (p.studentIds ?? []).some((id: unknown) => String(id) === studentId)
  const cur = member && p.status === 'active' ? await currentClassOf(p._id) : null
  const meetUrl = member && p.status === 'active' ? meetLinkOf(p, cur) : null
  if (meetUrl) await recordProgramJoin(studentId, cur)
  return { signedIn: true, member, classId: cur ? String(cur.cls._id) : null, joinable: !!cur?.joinable, meetUrl }
}

/** The Google Meet link a program's link hands over: the coming class's, else the program's own pasted link.
    Any time, not only near class time (2026-10-18, the user: "redirect to Google Meet any time"). In person,
    or an in-app stream: none. */
function meetLinkOf(p: any, cur: Awaited<ReturnType<typeof currentClassOf>>): string | null {
  const isMeet = (u: unknown) => /^https:\/\/meet\.google\.com\//i.test(String(u ?? ''))
  if (cur && cur.cls.isOnline !== false && cur.cls.type === 'external' && isMeet(cur.cls.meetingUrl)) return String(cur.cls.meetingUrl)
  if ((!cur || cur.cls.isOnline !== false) && p.isOnline !== false && isMeet(p.meetingUrl)) return String(p.meetingUrl)
  return null
}

/* An LMS student taken to Meet from the program's link: their seat marked joined, as a click on the class
   page's Join does (first click wins; runAttendanceFinalization makes it 'attended'). Only while the class
   can be joined (15 minutes before to its end) — opening the link a day early is not attending. */
async function recordProgramJoin(studentId: unknown, cur: Awaited<ReturnType<typeof currentClassOf>>) {
  if (!cur?.joinable) return
  const { ClassBookingModel } = await import('@/models/schema.ts')
  await ClassBookingModel.updateOne(
    { userId: new Types.ObjectId(String(studentId)), liveClassId: cur.cls._id, status: 'booked', attendedAt: { $exists: false } },
    { $set: { attendedAt: new Date(), attendanceSource: 'click' } },
  ).catch(err => logger.warn({ err, liveClassId: String(cur.cls._id) }, 'program link: join not recorded'))
}

/** Who filled in the program's form — for who may see the program. */
export async function listProgramGuests(id: string, actor: Actor) {
  const { ProgramGuestModel } = await import('@/models/schema.ts')
  const p = await load(id, actor)
  const rows = await ProgramGuestModel.find({ programId: p._id }).sort({ createdAt: -1 }).limit(2000).lean() as any[]
  return rows.map(g => ({ id: String(g._id), name: g.name, email: g.email, phone: g.phone, joins: g.joins ?? 0, firstAt: g.createdAt, lastJoinAt: g.lastJoinAt ?? null }))
}

async function present(p: any) {
  const { LiveClassModel, UserModel } = await import('@/models/schema.ts')
  const joinCode = await joinCodeOf(p)
  const [students, mentor, classes, coMentors] = await Promise.all([
    UserModel.find({ _id: { $in: p.studentIds ?? [] } }).select('name email').lean() as Promise<any[]>,
    UserModel.findById(p.instructorId).select('name email').lean() as Promise<any>,
    LiveClassModel.find({ programId: p._id }).sort({ scheduledStart: 1 }).select('scheduledStart status durationMins googleMeetCode').lean() as Promise<any[]>,
    UserModel.find({ _id: { $in: p.coInstructorIds ?? [] } }).select('name email').lean() as Promise<any[]>,
  ])
  const now = Date.now()
  return {
    id: String(p._id), title: p.title, description: p.description ?? '', status: p.status, source: p.source,
    repeat: p.repeat, weekdays: p.weekdays ?? [], monthDay: p.monthDay ?? null, startDate: p.startDate, endDate: p.endDate,
    time: p.time, timezone: p.timezone, durationMins: p.durationMins, isOnline: p.isOnline, location: p.location ?? '',
    mentor: mentor ? { id: String(mentor._id), name: mentor.name, email: mentor.email } : null,
    coMentors: coMentors.map(m => ({ id: String(m._id), name: m.name, email: m.email })),
    meetingMode: p.meetingMode ?? 'auto', meetingUrl: p.meetingUrl ?? '', language: p.language || 'English',
    thumbnailUrl: p.thumbnailUrl ?? '',
    students: students.map(s => ({ id: String(s._id), name: s.name, email: s.email })),
    createdByName: p.createdByName ?? '', createdByEmail: p.createdByEmail ?? '',
    joinCode, joinUrl: programJoinUrl(joinCode),
    /* Each class's Google Meet link — the program's own link, else the room made for that class (2026-10-15: the portal
       shows the program's link). In person, none. */
    classes: classes.map(c => ({ id: String(c._id), startsAt: c.scheduledStart, status: c.status,
      meetUrl: !p.isOnline ? '' : p.meetingMode === 'link' && p.meetingUrl ? p.meetingUrl : c.googleMeetCode ? `https://meet.google.com/${c.googleMeetCode}` : '' })),
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
  const coMentorIds = await resolveCoMentors(input.coInstructorIds ?? input.coMentorEmails, mentor._id)
  const meeting = meetingChoice(input, isOnline)
  const language = input.language == null || input.language === '' ? 'English' : String(input.language)
  if (!PROGRAM_LANGUAGES.includes(language)) throw new ProgramError(`Pick a language: ${PROGRAM_LANGUAGES.join(', ')}`)

  const { ids, missing } = await resolveStudents(input.students ?? input.studentIds, orgId)
  if (!ids.length) throw new ProgramError(missing.length ? `Not students on the LMS: ${missing.join(', ')}` : 'Add at least one student')

  const image = imageOf(input.thumbnailUrl)
  const programId = new Types.ObjectId()
  const course = await CourseModel.create({
    title: `Program: ${title}`, slug: `program-${crypto.randomBytes(6).toString('hex')}`, description: String(input.description ?? '').trim() || title,
    ...(image ? { thumbnailUrl: image } : {}),
    instructorId: mentor._id, price: 0, isFree: true, status: 'draft', language: 'English', programId,
    ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
  } as any)
  const p: any = await ProgramModel.create({
    _id: programId, title, description: String(input.description ?? '').trim(), ...(orgId ? { organizationId: new Types.ObjectId(orgId) } : {}),
    instructorId: mentor._id, ...(coMentorIds.length ? { coInstructorIds: coMentorIds } : {}),
    meetingMode: meeting.mode, ...(meeting.url ? { meetingUrl: meeting.url } : {}), language,
    ...(image ? { thumbnailUrl: image } : {}),
    courseId: course._id, ...s, timezone: DEFAULT_TZ, isOnline, location: String(input.location ?? '').trim(),
    studentIds: ids, status: 'active', source: actor.role === 'portal' ? 'portal' : 'lms', joinCode: newJoinCode(),
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
  // Its picture alone (2026-10-15): saved on it and its hidden course — the classes stay as they are.
  const image = imageOf(input.thumbnailUrl)
  if (image !== undefined) {
    const { CourseModel } = await import('@/models/schema.ts')
    p.thumbnailUrl = image || undefined
    await CourseModel.updateOne({ _id: p.courseId }, image ? { $set: { thumbnailUrl: image } } : { $unset: { thumbnailUrl: '' } })
  }
  const SCHEDULE_KEYS = ['repeat', 'weekdays', 'monthDay', 'startDate', 'endDate', 'time', 'durationMins', 'isOnline', 'location']
  if (!SCHEDULE_KEYS.some(k => input[k] !== undefined)) {
    if (typeof input.title === 'string' && input.title.trim().length >= 3) p.title = input.title.trim()
    if (typeof input.description === 'string') p.description = input.description.trim()
    await p.save()
    return present(p)
  }
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

/** The students of one team, one CS (optionally within a team), or everyone. */
export async function programAudienceStudents(orgId: string | null, pick: { team?: string; cs?: string; all?: boolean }): Promise<Array<{ id: string; name: string; email: string }>> {
  const { UserModel } = await import('@/models/schema.ts')
  const q: Record<string, unknown> = pickable(orgId)
  if (pick.team) q['tetraCs.team'] = pick.team
  if (pick.cs) q['tetraCs.name'] = pick.cs
  if (!pick.team && !pick.cs && !pick.all) return []
  const rows = await UserModel.find(q).select('name email').sort({ name: 1 }).lean() as any[]
  return rows.map(u => ({ id: String(u._id), name: u.name, email: u.email }))
}

/* ── Telling the students a program was made for them ─────────────────────
   In the app only (2026-10-17 — no email, no WhatsApp; the one programme WhatsApp
   is "Join now" at each class's start). The days and time in each READER's
   academy clock, read off the classes actually made. */
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
  const lang = p.language && p.language !== 'English' ? ` in ${p.language}` : ''
  const where = p.isOnline ? 'online' : `at ${p.location}`
  /* How to get in — a pasted link is the same every class, so it is given now; a room made per class
     comes with its own link 5 minutes before each class. */
  const join = !p.isOnline ? ''
    : p.meetingMode === 'link' && p.meetingUrl ? ` Join on Google Meet: ${p.meetingUrl}`
    : p.meetingMode === 'app' ? ' Join from your Class Schedule in the app.'
    : " Each class's Google Meet link comes on WhatsApp 5 minutes before it starts."
  return `${n} class${n === 1 ? '' : 'es'}${lang}, ${when} at ${time}, ${where} — from ${first} to ${last}. You are booked on every one.${join}`
}

export async function notifyProgramCreated(p: any): Promise<{ notified: number; emailed: number; whatsapp: number }> {
  const { UserModel, LiveClassModel } = await import('@/models/schema.ts')
  const { NotificationService } = await import('@/services/notification.service.ts')
  const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { SCHEDULE_LINK } = await import('@/utils/clientLinks.ts')
  const notifications = new NotificationService()
  await ensureOrgSlugs().catch(() => {})
  const starts = (await LiveClassModel.find({ programId: p._id, status: 'scheduled', scheduledStart: { $gt: new Date() } })
    .sort({ scheduledStart: 1 }).select('scheduledStart').lean() as any[]).map(c => new Date(c.scheduledStart))
  const students = await UserModel.find({ _id: { $in: p.studentIds ?? [] } }).select('name email organizationId enrollmentApplication.phone').lean() as any[]
  const tally = { notified: 0, emailed: 0, whatsapp: 0 }
  for (const u of students) {
    const schedule = scheduleFor(p, starts, orgSlugFor(u.organizationId))
    try {
      await notifications.create(String(u._id), { kind: 'system', title: `New program: ${p.title}`, body: schedule, link: SCHEDULE_LINK })
      tally.notified++
    } catch (err) { logger.warn({ err, userId: String(u._id) }, 'program: in-app notice failed') }
    /* No email and no WhatsApp (2026-10-17, the user): a program's students are told in the app only; the one
       WhatsApp they get is "Join now" when each class starts. */
  }
  logger.info({ programId: String(p._id), students: students.length, ...tally }, 'program: students told')
  return tally
}
