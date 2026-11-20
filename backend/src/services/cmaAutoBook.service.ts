import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'

/* ─────────────────────────────────────────────────────
   CMA classes book themselves (the user, 2026-11-20)
   ─────────────────────────────────────────────────────
   Every upcoming class of a CMA course (its program 'cma') holds a seat for every student who may attend it: enrolled
   (not dropped), an approved and active student account, and the class's module open to them — the same verdict a
   student's own booking gets (resolveClassEntitlement). A full class is made bigger (reserveFlatSeats keeps room for
   all, and ten to spare). A student who cancels their seat is never booked into that class again: any booking row
   for the class, cancelled or not, means "leave them". An in-person class with an online twin is left to the online
   one (a student may hold only one of the pair).

   Every few minutes (reminders.job.ts): new CMA classes, new enrolments, approvals and unblocked modules all come
   through the same sweep. Each student is then told ONCE for all of a sweep's new seats — in the app, in the
   e-mail digest, and on WhatsApp (new_class_scheduled_v1@cma, its button their own sign-in link to the schedule). Their
   personal join link comes as for every booked student: 5 minutes before (e-mail and, for CMA, WhatsApp) and at the
   start.

   CMA_AUTO_BOOK: off unless 'on' (tests: on). scripts/cma-autobook.ts previews what the first run would do. */

export const CMA = 'cma'
const LOOK_AHEAD_MS = 30 * 864e5
const NOT_BEFORE_MS = 5 * 60_000
/* A class just made is told about a few minutes later, so an import's classes go out in one message. */
const NOTICE_SETTLE_MS = 3 * 60_000

export function cmaAutoBookOn(): boolean {
  const raw = (process.env['CMA_AUTO_BOOK'] ?? '').trim().toLowerCase()
  if (!raw) return process.env['NODE_ENV'] === 'test'
  return /^(on|true|yes|1)$/.test(raw)
}

let cache: { at: number; ids: Set<string> } | null = null
/** CMA courses, by id — kept a minute. */
export async function cmaCourseIds(fresh = false): Promise<Set<string>> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.ids
  const { CourseModel } = await import('@/models/schema.ts')
  const rows = await CourseModel.find({ program: CMA }).select('_id').lean() as Array<{ _id: Types.ObjectId }>
  cache = { at: Date.now(), ids: new Set(rows.map(r => String(r._id))) }
  return cache.ids
}
export async function isCmaCourse(courseId: unknown): Promise<boolean> {
  return !!courseId && (await cmaCourseIds()).has(String(courseId))
}

export interface CmaPlanRow { classId: string; title: string; start: Date; students: string[] }
export interface CmaSweep { classes: number; booked: number; plan: CmaPlanRow[]; told: number }

/** Book every student who may attend into every upcoming CMA class they are not in — or, dryRun, only say who. */
export async function bookCmaClasses(now = new Date(), opts: {
  dryRun?: boolean
  /** ONE class, by hand (cma-autobook.ts --class, 2026-11-20): its own course's
      students, even while it is live and whatever the course's programme. */
  classId?: string
} = {}): Promise<{ classes: number; booked: number; plan: CmaPlanRow[] }> {
  const { LiveClassModel, ClassBookingModel, EnrollmentModel, UserModel } = await import('@/models/schema.ts')
  const { resolveClassEntitlement } = await import('@/services/classEntitlement.service.ts')
  const { reserveFlatSeats, reserveSeat, seatStampFrom } = await import('@/services/seatPool.service.ts')
  const out = { classes: 0, booked: 0, plan: [] as CmaPlanRow[] }

  const CLASS_FIELDS = '_id title scheduledStart courseId sectionId organizationId guestCohorts isOnline hybridPairId'
  let courses: Types.ObjectId[]
  let classes: any[]
  if (opts.classId) {
    if (!Types.ObjectId.isValid(opts.classId)) return out
    /* Not over and not cancelled — a class already running still takes students. */
    const one = await LiveClassModel.findOne({ _id: new Types.ObjectId(opts.classId), status: { $in: ['scheduled', 'live'] } }).select(CLASS_FIELDS).lean() as any
    if (!one?.courseId) return out
    courses = [one.courseId]
    classes = [{ ...one, hybridPairId: undefined }]   /* asked for by name: book it, whichever half it is */
  } else {
    courses = [...await cmaCourseIds(true)].map(id => new Types.ObjectId(id))
    if (!courses.length) return out
    classes = await LiveClassModel.find({
      courseId: { $in: courses },
      status: 'scheduled',
      scheduledStart: { $gt: new Date(now.getTime() + NOT_BEFORE_MS), $lt: new Date(now.getTime() + LOOK_AHEAD_MS) },
    }).select(CLASS_FIELDS).lean() as any[]
  }
  out.classes = classes.length

  /* Who is enrolled in each course, and which of them are approved, active students. */
  const enrolments = await EnrollmentModel.find({ courseId: { $in: courses }, status: { $ne: 'dropped' } }).select('userId courseId').lean() as any[]
  const users = await UserModel.find({
    _id: { $in: [...new Set(enrolments.map(e => String(e.userId)))].map(id => new Types.ObjectId(id)) },
    role: 'student', isActive: { $ne: false }, enrollmentStatus: 'approved',
  }).select('_id organizationId').lean() as any[]
  const orgOf = new Map(users.map(u => [String(u._id), u.organizationId ? String(u.organizationId) : null]))
  const byCourse = new Map<string, string[]>()
  for (const e of enrolments) {
    if (!orgOf.has(String(e.userId))) continue
    const k = String(e.courseId)
    byCourse.set(k, [...(byCourse.get(k) ?? []), String(e.userId)])
  }

  for (const cls of classes) {
    const id = String(cls._id)
    try {
      /* An in-person class of an online + in-person pair: the online one holds them. */
      if (cls.hybridPairId && cls.isOnline === false) continue
      const enrolled = [...new Set(byCourse.get(String(cls.courseId)) ?? [])]
      if (!enrolled.length) continue
      /* Anyone with a booking row here — booked, attended, missed or cancelled — is left as they are. */
      const had = new Set((await ClassBookingModel.find({ liveClassId: cls._id, userId: { $in: enrolled.map(u => new Types.ObjectId(u)) } }).select('userId').lean() as any[]).map(b => String(b.userId)))
      let fresh = enrolled.filter(u => !had.has(u))
      if (!fresh.length) continue
      /* …and anyone holding the twin's seat. */
      if (cls.hybridPairId) {
        const twins = await LiveClassModel.find({ hybridPairId: cls.hybridPairId, _id: { $ne: cls._id }, status: { $ne: 'cancelled' } }).select('_id').lean() as any[]
        if (twins.length) {
          const inTwin = new Set((await ClassBookingModel.find({ liveClassId: { $in: twins.map(t => t._id) }, userId: { $in: fresh.map(u => new Types.ObjectId(u)) }, status: { $in: ['booked', 'attended'] } }).select('userId').lean() as any[]).map(b => String(b.userId)))
          fresh = fresh.filter(u => !inTwin.has(u))
        }
      }
      /* The module open to them, as for their own booking. */
      const may: string[] = []
      for (const u of fresh) {
        const verdict = await resolveClassEntitlement(cls, u, orgOf.get(u) ?? null, 'notDropped')
        if (verdict.ok) may.push(u)
      }
      if (!may.length) continue
      out.plan.push({ classId: id, title: cls.title, start: new Date(cls.scheduledStart), students: may })
      if (opts.dryRun) { out.booked += may.length; continue }

      const door = { organizationId: cls.organizationId ? String(cls.organizationId) : null, courseId: String(cls.courseId), sectionId: cls.sectionId ? String(cls.sectionId) : null }
      const stampBase = { status: 'booked' as const, bookedAt: now, autoBookedAt: now }
      if (await reserveFlatSeats(id, may.length)) {
        /* The whole lot in one go; a seat a booking made in between took is given back. */
        let inserted = 0
        try {
          const r = await ClassBookingModel.insertMany(may.map(userId => ({ userId: new Types.ObjectId(userId), liveClassId: cls._id, ...stampBase, ...seatStampFrom({ pool: { kind: 'flat' } } as any, door) })), { ordered: false })
          inserted = r.length
        } catch (err: any) {
          inserted = err?.insertedDocs?.length ?? err?.result?.insertedCount ?? 0
        }
        if (inserted < may.length) await reserveFlatSeats(id, inserted - may.length)
        out.booked += inserted
      } else {
        /* A class with academy floors: seat by seat through its pools; a full pool is made bigger first. */
        const { LiveClassService } = await import('@/services/liveClass.service.ts')
        for (const u of may) {
          let seat = await reserveSeat(id, orgOf.get(u) ?? null)
          if (!seat) {
            const cur = await LiveClassModel.findById(cls._id).select('sessionCapacity').lean() as any
            await new LiveClassService().update(id, { sessionCapacity: (cur?.sessionCapacity ?? 30) + Math.max(10, may.length) })
            seat = await reserveSeat(id, orgOf.get(u) ?? null)
          }
          if (!seat) continue
          try {
            await ClassBookingModel.create({ userId: new Types.ObjectId(u), liveClassId: cls._id, ...stampBase, ...seatStampFrom(seat, door) })
            out.booked++
          } catch (err: any) {
            if (err?.code !== 11000) throw err
          }
        }
      }
    } catch (err) {
      logger.error({ err, classId: id }, '[CMA] auto-booking one class failed')
    }
  }
  return out
}

/** Tell each student once about their new auto-booked seats (settled a few minutes, still ahead). */
export async function tellCmaStudents(now = new Date(), deps: {
  whatsapp?: (phone: string, name: string, courseTitle: string, what: string, day: string, time: string, code: string) => Promise<void>
} = {}, settleMs = NOTICE_SETTLE_MS): Promise<number> {
  const { ClassBookingModel, CourseModel } = await import('@/models/schema.ts')
  const fresh = await ClassBookingModel.find({
    autoBookedAt: { $lte: new Date(now.getTime() - settleMs) },
    autoNoticeSentAt: { $exists: false },
    status: 'booked',
  }).select('_id userId liveClassId')
    .populate('liveClassId', 'title scheduledStart courseId status organizationId')
    .populate('userId', 'name email isActive organizationId enrollmentApplication.phone')
    .lean() as any[]
  const live = fresh.filter(b => b.liveClassId && b.userId && b.liveClassId.status === 'scheduled' && new Date(b.liveClassId.scheduledStart).getTime() > now.getTime())
  /* Gone by now (cancelled, started, the student deactivated): nothing to say — just closed. */
  const closeIds = fresh.filter(b => !live.includes(b)).map(b => b._id)
  if (closeIds.length) await ClassBookingModel.updateMany({ _id: { $in: closeIds } }, { $set: { autoNoticeSentAt: now } })

  const byUser = new Map<string, any[]>()
  for (const b of live) byUser.set(String(b.userId._id), [...(byUser.get(String(b.userId._id)) ?? []), b])
  if (!byUser.size) return 0

  const { NotificationService } = await import('@/services/notification.service.ts')
  const { queueDigestItem } = await import('@/jobs/digest.job.ts')
  const { mintSigninCode } = await import('@/services/signinLink.service.ts')
  const { sendNewClassScheduledWhatsApp } = await import('@/services/whatsapp.service.ts')
  const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { zoneForAcademy, zoneTag } = await import('@/utils/academyClock.ts')
  await ensureOrgSlugs().catch(() => {})
  const courseTitles = new Map((await CourseModel.find({ _id: { $in: [...new Set(live.map(b => String(b.liveClassId.courseId)))] } }).select('title').lean() as any[]).map(c => [String(c._id), c.title as string]))
  const notes = new NotificationService()
  const whatsapp = deps.whatsapp ?? ((phone, name, course, what, day, time, code) => sendNewClassScheduledWhatsApp(phone, name, course, what, day, time, code, 'cma'))

  let told = 0
  for (const [userId, rows] of byUser) {
    const u = rows[0].userId
    const list = rows.sort((a, b) => +new Date(a.liveClassId.scheduledStart) - +new Date(b.liveClassId.scheduledStart))
    const first = list[0].liveClassId
    const zone = zoneForAcademy(orgSlugFor(u.organizationId) ?? orgSlugFor(first.organizationId) ?? null)
    const day = (d: Date) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).replace(/^(\w{3}) /, '$1, ')
    const time = (d: Date) => `${new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })} ${zoneTag(zone)}`
    const courseTitle = courseTitles.get(String(first.courseId)) ?? 'your CMA course'
    const what = list.length === 1 ? first.title : `${first.title} + ${list.length - 1} more class${list.length > 2 ? 'es' : ''}`
    const lines = list.map(b => `• ${b.liveClassId.title} — ${day(b.liveClassId.scheduledStart)}, ${time(b.liveClassId.scheduledStart)}`).join('\n')
    const title = list.length === 1 ? `You're booked: ${first.title}` : `You're booked into ${list.length} ${courseTitle} classes`
    const body = `${list.length === 1 ? 'Your seat is saved' : 'Your seats are saved'} — no need to book. Your joining link comes 5 minutes before each class.\n${lines}`
    try { await notes.create(userId, { kind: 'booking-confirmed', title, body, link: '/class-bookings' }) } catch (err) { logger.warn({ err, userId }, '[CMA] in-app notice failed') }
    try { await queueDigestItem({ userId, kind: 'new-session', title, body, link: '/class-bookings' }) } catch (err) { logger.warn({ err, userId }, '[CMA] e-mail digest failed') }
    const phone = u.enrollmentApplication?.phone
    if (phone && u.isActive !== false) {
      try {
        const code = await mintSigninCode(userId, '/class-bookings')
        await whatsapp(phone, u.name ?? '', courseTitle, what, day(first.scheduledStart), time(first.scheduledStart), code)
      } catch (err) { logger.warn({ err, userId }, '[CMA] WhatsApp failed') }
    }
    await ClassBookingModel.updateMany({ _id: { $in: rows.map(b => b._id) } }, { $set: { autoNoticeSentAt: now } })
    told++
  }
  return told
}

/** Tell the students just booked into ONE class by hand (cma-autobook.ts --class) — at once, since it may already be
    running: in-app, an e-mail now (not the daily digest), and WhatsApp with a sign-in link to their bookings, where
    the Join button is. Marks them told, so the sweep never tells them again. */
export async function tellClassNow(classId: string, now = new Date(), deps: {
  whatsapp?: (phone: string, name: string, courseTitle: string, what: string, day: string, time: string, code: string) => Promise<void>
  email?: (to: string, subject: string, body: string, button: { label: string; url: string }) => Promise<void>
} = {}): Promise<number> {
  const { ClassBookingModel, CourseModel, LiveClassModel } = await import('@/models/schema.ts')
  if (!Types.ObjectId.isValid(classId)) return 0
  const cls = await LiveClassModel.findById(classId).select('title scheduledStart courseId status organizationId').lean() as any
  if (!cls) return 0
  const rows = await ClassBookingModel.find({
    liveClassId: cls._id, status: 'booked', autoBookedAt: { $exists: true }, autoNoticeSentAt: { $exists: false },
  }).select('_id userId').populate('userId', 'name email isActive organizationId enrollmentApplication.phone').lean() as any[]
  if (!rows.length) return 0

  const { NotificationService } = await import('@/services/notification.service.ts')
  const { mintSigninCode } = await import('@/services/signinLink.service.ts')
  const { sendNewClassScheduledWhatsApp } = await import('@/services/whatsapp.service.ts')
  const { sendAdminMessageEmail } = await import('@/services/email.service.ts')
  const { SCHEDULE_LINK, scheduleUrl } = await import('@/utils/clientLinks.ts')
  const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
  const { zoneForAcademy, zoneTag } = await import('@/utils/academyClock.ts')
  await ensureOrgSlugs().catch(() => {})
  const course = await CourseModel.findById(cls.courseId).select('title').lean() as any
  const courseTitle = course?.title ?? 'your course'
  const running = cls.status === 'live' || new Date(cls.scheduledStart).getTime() <= now.getTime()
  const notes = new NotificationService()
  const whatsapp = deps.whatsapp ?? ((phone, name, c, what, day, time, code) => sendNewClassScheduledWhatsApp(phone, name, c, what, day, time, code, 'cma'))
  const email = deps.email ?? sendAdminMessageEmail

  let told = 0
  for (const b of rows) {
    const u = b.userId
    if (!u || u.isActive === false) { await ClassBookingModel.updateOne({ _id: b._id }, { $set: { autoNoticeSentAt: now } }); continue }
    const zone = zoneForAcademy(orgSlugFor(u.organizationId) ?? orgSlugFor(cls.organizationId) ?? null)
    const day = new Date(cls.scheduledStart).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).replace(/^(\w{3}) /, '$1, ')
    const time = `${new Date(cls.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })} ${zoneTag(zone)}`
    const title = running ? `Live now — you're booked: ${cls.title}` : `You're booked: ${cls.title}`
    const body = running
      ? `${cls.title} (${courseTitle}) has started and your seat is saved. Open My bookings and tap Join to come in now.`
      : `${cls.title} (${courseTitle}) — ${day}, ${time}. Your seat is saved, no need to book.`
    try { await notes.create(String(u._id), { kind: 'booking-confirmed', title, body, link: SCHEDULE_LINK }) } catch (err) { logger.warn({ err, userId: String(u._id) }, '[CMA] in-app notice failed') }
    if (u.email) {
      try { await email(u.email, title, `Hi ${u.name ?? 'there'},\n\n${body}`, { label: running ? 'Join the class' : 'My bookings', url: scheduleUrl() }) }
      catch (err) { logger.warn({ err, userId: String(u._id) }, '[CMA] e-mail failed') }
    }
    const phone = u.enrollmentApplication?.phone
    if (phone) {
      try {
        const code = await mintSigninCode(String(u._id), SCHEDULE_LINK)
        await whatsapp(phone, u.name ?? '', courseTitle, cls.title, day, time, code)
      } catch (err) { logger.warn({ err, userId: String(u._id) }, '[CMA] WhatsApp failed') }
    }
    await ClassBookingModel.updateOne({ _id: b._id }, { $set: { autoNoticeSentAt: now } })
    told++
  }
  return told
}

/** The sweep the scheduler runs: book, then tell. */
export async function runCmaAutoBook(now = new Date()): Promise<CmaSweep | null> {
  if (!cmaAutoBookOn()) return null
  try {
    const booked = await bookCmaClasses(now)
    const told = await tellCmaStudents(now)
    if (booked.booked || told) logger.info({ classes: booked.classes, booked: booked.booked, told }, '[CMA] auto-booking')
    return { ...booked, told }
  } catch (err) {
    logger.error({ err }, '[CMA] auto-booking sweep failed')
    return null
  }
}
