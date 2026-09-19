/* ─────────────────────────────────────────────────────
   Minting join tickets for a live class  (Phase 3)
   ─────────────────────────────────────────────────────
   The LMS is the entitlement authority: it decides who may enter a room and
   with what powers, and CLT Connect simply honours that decision. So every
   authorisation question is answered HERE, and the answer travels in the
   ticket. CLT never queries Mongo and never re-derives a grant.

   Two callers, two very different bars:

     host  — the instructor assigned to this class (or an admin). May start the
             room, so `roomAdmin` is granted.
     join  — a booked student. Read-only on the room's control surface, and
             gated on booking, enrolment, module access, org and time window.

   Room provisioning is LAZY here on purpose. Phase 2 provisions at class
   creation, but that is best-effort — CLT may have been down. Doing it again
   before minting a host ticket means the first person to actually host repairs
   the gap, rather than meeting a room that does not exist.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { LiveClassModel, type ILiveClass } from '@/models/schema.ts'
import { mintTicket, roomNameFor, type MintedTicket, type TicketRole } from '@/services/integrationTicket.service.ts'
import { tryEnsureRoom, cltConfigured } from '@/services/clt.service.ts'
import { logger } from '@/utils/logger.ts'
import { studentJoinWindow, STUDENT_JOIN_GRACE_MS } from '@/utils/liveStatus.ts'
import { resolveClassEntitlement } from '@/services/classEntitlement.service.ts'

export class JoinError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /** Seconds until the join window opens — lets the UI show a countdown
        instead of a dead error. */
    readonly retryAfter?: number,
  ) { super(message) }
}

/* Who may take ROOM CONTROL without being the assigned instructor.
   Exactly one role. A super admin joining visibly is the platform owner
   stepping into a class, so they moderate; every other administrator is
   oversight and joins as a guest, because watching a colleague teach is not a
   reason to be able to mute or eject them. Never granted while hidden —
   hidden means observation, and an invisible moderator is a trapdoor. */
const ROOM_CONTROL_ROLES = new Set(['super_admin'])

/* Who may drop into a class they are not teaching.
   
   This USED to be defined as "the same set as requireAnyAdmin", so that one
   definition of admin-panel staff served both. It no longer is, and the
   difference is deliberate rather than drift: `support` is admin-panel staff
   and can read a class record, but entering a live classroom full of students
   is not part of handling a support ticket. Being able to open the page is not
   the same permission as being able to walk into the room.
   
   So this set is requireAnyAdmin MINUS support, and it must be maintained by
   hand. A role added to requireAnyAdmin does NOT become an observer by
   default — decide, then add it here.
   
   Instructors are absent for a different reason: an instructor is a peer, not
   oversight, and may only enter their own class. */
export const ADMIN_OBSERVER_ROLES = new Set([
  'super_admin', 'admin', 'sub_admin',
])

/* The window either side of a class in which joining is allowed. Matches CLT's
   own 15-minute grace anchor so the two do not disagree about lateness. */
export const JOIN_WINDOW_BEFORE_MIN = 15
export const JOIN_WINDOW_AFTER_MIN  = 15

export interface JoinContext {
  userId:         string
  name:           string
  email:          string
  /** Shown on the participant tile when the camera is off. */
  avatarUrl?:     string
  role:           string        // LMS role
  organizationId?: string
  /** Programme the caller is confined to, for the roles that carry one
      (sub_admin, whose programme comes from `program`).
      Already normalised to the hyphenated form by injectCategoryScope —
      compare against it, never against `program`, which is spelled
      differently. Undefined means unconfined. */
  categoryScope?: string
  enrollmentStatus?: string
  isActive?:      boolean
}

/** Load the class, or fail with a shaped error. */
async function loadClass(liveClassId: string): Promise<ILiveClass> {
  if (!Types.ObjectId.isValid(liveClassId)) {
    throw new JoinError('INVALID_ID', 'Invalid class id', 400)
  }
  const live = await LiveClassModel.findById(liveClassId)
  if (!live) throw new JoinError('CLASS_NOT_FOUND', 'Class not found', 404)
  return live
}

/** Shared checks: the class must be a live-capable LiveKit class. */
function assertJoinable(live: ILiveClass): void {
  if ((live as { provider?: string }).provider !== 'livekit') {
    throw new JoinError('NOT_A_LIVEKIT_CLASS',
      'This class does not use the interactive room.', 400)
  }
  if (live.status === 'cancelled') {
    throw new JoinError('CLASS_CANCELLED', 'This class was cancelled.', 409)
  }
  if (live.status === 'ended') {
    throw new JoinError('CLASS_ENDED', 'This class has already ended.', 409)
  }
}

/**
 * Ensure the CLT room exists, repairing a failed Phase-2 provisioning.
 * Returns the room name either way — an unprovisioned room still has a
 * deterministic name, and CLT answers 404 rather than misrouting.
 */
async function ensureRoomFor(live: ILiveClass): Promise<string> {
  const roomName = live.cltRoomName ?? roomNameFor(live.id)

  if (!live.cltCourseId && cltConfigured()) {
    const room = await tryEnsureRoom({
      liveClassId:    live.id,
      roomName,
      title:          live.title,
      /* Always with an offset — the LMS runs Asia/Dubai, CLT computes UTC. */
      scheduledStart: live.scheduledStart.toISOString(),
      durationMins:   live.durationMins,
      capacity:       live.sessionCapacity,
    })
    if (room?.courseId) {
      await LiveClassModel.updateOne(
        { _id: live._id },
        { $set: { cltRoomName: roomName, cltCourseId: room.courseId } },
      )
    } else {
      await LiveClassModel.updateOne({ _id: live._id }, { $set: { cltRoomName: roomName } })
    }
  }
  return roomName
}

/* ─────────────────────────────────────────────────────
   Which classes may an admin observer enter?
   ─────────────────────────────────────────────────────
   Membership of ADMIN_OBSERVER_ROLES answers "may you watch classes at all".
   It does not answer "which ones", and until this existed the answer was
   "every one of them" — a Dubai admin could sit in a Bangalore class, and a
   digital-marketing sub-admin could sit silently in a JURA one. Both accounts
   are refused the far weaker act of READING those same records through the
   admin API, so entering the live room was the softest door in the building.

   The two gates below are the ones the admin panel already applies to a live
   session, in the same order and with the same conventions:

     tenancy  — LiveClassController.#canManage
     scope    — the guard on GET /admin/live-classes/:id

   Watching is oversight, and oversight is bounded by the same walls as every
   other administrative act. Only super_admin is deliberately unbounded. */
async function assertAdminMayObserve(live: ILiveClass, ctx: JoinContext): Promise<void> {
  if (ctx.role === 'super_admin') return

  /* 1. Tenancy. A caller with no academy on record, or a class that predates
     the field, stays unscoped — the convention every other org guard in this
     codebase follows. Only a genuine mismatch is a refusal. */
  /* An admin of any SERVING academy may observe: the host's, or any guest
     academy the class was shared with. Until sharing is switched on this is
     exactly the host comparison it replaces, falsy guards included. */
  const { doorsFor } = await import('@/services/classEntitlement.service.ts')
  /* KEEP THE DOOR, do not just prove one exists. Gate 2 below needs to know
     WHICH door admitted this caller: it used to admit through any serving door
     and then read live.courseId — the HOST's — for the programme check.

     That failed in both directions. A programme admin who owns the guest
     cohort was locked out whenever the two academies file their equivalent
     courses under different programmes, which they routinely do. And worse, a
     sub-admin whose scope happened to match the HOST course was admitted to a
     class they have nothing to do with, because nothing ever looked at the
     door they actually came through.

     doorsFor returns the host door first, so a host caller matches exactly
     what they matched before and this is verdict-identical for them. */
  const admittedDoor = doorsFor(live).find(d =>
    !d.organizationId || !ctx.organizationId || String(d.organizationId) === String(ctx.organizationId))
  if (!admittedDoor) {
    throw new JoinError('WRONG_ACADEMY', 'This class belongs to another academy.', 403)
  }

  /* 2. Programme. Only the scoped roles carry a categoryScope; for everyone
     else this is a no-op. The programme lives on the course of THE DOOR THEY
     CAME THROUGH, which for a guest academy's staff is their own course — the
     same one their admin panel reads it from. */
  const doorCourseId = admittedDoor.courseId ?? live.courseId
  if (ctx.categoryScope && doorCourseId) {
    const { CourseModel } = await import('@/models/schema.ts')
    const course = await CourseModel.findById(String(doorCourseId)).select('program').lean()
    if (!course || (course as { program?: string }).program !== ctx.categoryScope) {
      throw new JoinError('OUT_OF_SCOPE',
        'This class belongs to another programme.', 403)
    }
  }
}

/* ─────────────────────────────────────────────────────
   HOST — the instructor assigned to this class
───────────────────────────────────────────────────── */
export async function mintHostTicket(
  liveClassId: string,
  ctx: JoinContext,
  opts: { visible?: boolean } = {},
): Promise<MintedTicket & { roomName: string; hidden: boolean }> {
  const live = await loadClass(liveClassId)
  assertJoinable(live)

  const isAdmin = ADMIN_OBSERVER_ROLES.has(ctx.role)
  const isAssigned = String(live.instructorId) === ctx.userId
  if (!isAdmin && !isAssigned) {
    /* Being an instructor is not enough — it must be THIS class. Otherwise any
       instructor could take room control of a colleague's session, and an
       instructor is a peer rather than oversight. */
    throw new JoinError('NOT_YOUR_CLASS',
      'Only the instructor assigned to this class, or admin staff, can join it.', 403)
  }

  /* Only for someone entering AS an observer. An admin who is also the
     assigned instructor of this class is hosting it, not overseeing it, and
     is bounded by the assignment itself. */
  if (!isAssigned) await assertAdminMayObserve(live, ctx)

  const roomName = await ensureRoomFor(live)
  const role: TicketRole = isAssigned ? 'instructor' : 'admin'

  const ticket = await mintTicket({
    userId: ctx.userId, name: ctx.name, email: ctx.email, role,
    liveClassId: live.id, roomName,
    ...(ctx.organizationId ? { orgSlug: ctx.organizationId } : {}),
    ...(ctx.avatarUrl ? { avatarUrl: ctx.avatarUrl } : {}),
    grants: role === 'instructor'
      ? { canPublish: true, roomAdmin: true, bypassLobby: true, hidden: false }
      /* An admin observes silently BY DEFAULT: hidden, no publish. Watching a
         class must not be indistinguishable from taking part in it.

         `visible` is the deliberate opt-out, for when an admin actually wants
         to speak to the room. It is a choice made per join, never a default,
         so nobody becomes visible by forgetting a flag.

         Room control rides on BOTH being visible and holding a role in
         ROOM_CONTROL_ROLES — today only super_admin. An org admin or a
         programme sub-admin joins as a guest who can speak, not as a second
         host, and no one moderates from behind a hidden identity. */
      : {
          canPublish: !!opts.visible,
          roomAdmin:  !!opts.visible && ROOM_CONTROL_ROLES.has(ctx.role),
          bypassLobby: true,
          hidden: !opts.visible,
          /* The LMS permitting an in-room change of mind. Whether they
             ARRIVE hidden is `hidden`; whether they may CHANGE it is this.
             Both are the LMS's call, and CLT only ever honours them. */
          mayUnhide: true,
        },
  })

  const hidden = role === 'admin' && !opts.visible
  logger.info({ liveClassId: live.id, actor: ctx.userId, role, hidden }, 'LMS host ticket minted')
  return { ...ticket, roomName, hidden }
}

/* ─────────────────────────────────────────────────────
   JOIN — a booked student  (wired up in Phase 4)
───────────────────────────────────────────────────── */
/* The student gate is shared by two doors with different clocks:

     LiveKit room  — 15 min before start … 15 min after the end. A room can be
                     entered early and lingers, because the LMS hosts it.
     Google Meet   — start … start + STUDENT_JOIN_GRACE. The link is not ours
                     to keep open, so it is handed out only while it is for
                     the class it names. See liveStatus.studentJoinWindow.

   Everything before the clock — account, enrolment, academy, booking, module —
   is identical for both, which is the point of sharing it: a student who is
   refused a room for a permanent reason must be refused the link for the same
   one. Only the window differs, so only the window is a parameter. */
export interface StudentJoinWindow {
  opensAt:    number
  closesAt:   number
  /** Booking statuses that count as holding a seat. */
  seatStatuses: readonly string[]
  tooEarly:   string
  closed:     { code: string; message: string }
}

const LIVEKIT_WINDOW = (live: ILiveClass): StudentJoinWindow => {
  const startMs = live.scheduledStart.getTime()
  return {
    opensAt:  startMs - JOIN_WINDOW_BEFORE_MIN * 60_000,
    closesAt: startMs + (live.durationMins + JOIN_WINDOW_AFTER_MIN) * 60_000,
    seatStatuses: ['booked'],
    tooEarly: `This class opens ${JOIN_WINDOW_BEFORE_MIN} minutes before it starts.`,
    closed:   { code: 'CLASS_OVER', message: 'This class is over.' },
  }
}

export const MEET_WINDOW = (live: ILiveClass): StudentJoinWindow => {
  const { opensAt, closesAt } = studentJoinWindow(live.scheduledStart)
  const graceMin = Math.round(STUDENT_JOIN_GRACE_MS / 60_000)
  return {
    opensAt:  opensAt.getTime(),
    closesAt: closesAt.getTime(),
    /* A seat an admin has already marked attended is still a seat: somebody
       who dropped off the call and comes back must not be refused. */
    seatStatuses: ['booked', 'attended'],
    tooEarly: 'The join link opens when the class starts.',
    closed:   { code: 'JOIN_WINDOW_CLOSED',
                message: `The join link closes ${graceMin} minutes after the class starts.` },
  }
}

export async function assertStudentMayJoin(
  live: ILiveClass,
  ctx: JoinContext,
  window: StudentJoinWindow = LIVEKIT_WINDOW(live),
): Promise<void> {
  if (ctx.isActive === false) {
    throw new JoinError('ACCOUNT_DISABLED', 'This account is disabled.', 403)
  }
  if (ctx.enrollmentStatus && ctx.enrollmentStatus !== 'approved') {
    throw new JoinError('ENROLMENT_NOT_APPROVED',
      'Your enrolment is not approved yet.', 403)
  }
  /* ACADEMY, ENROLMENT AND MODULE, ASKED OF ONE DOOR.

     These were three hand-written checks here, and near-identical copies lived
     in seven other files. They are one call now — see
     services/classEntitlement.service.ts for why the module gate cannot be
     asked of a different course than the enrolment was found in.

     The ORDER of this function's refusals is a contract the client depends on:
     everything above and including this is a PERMANENT no, and the time window
     below is a "not yet" answered as 425 with Retry-After. That ordering is
     unchanged. */
  const entitlement = await resolveClassEntitlement(live, ctx.userId, ctx.organizationId ?? null, 'notDropped')

  if (entitlement.code === 'WRONG_ACADEMY') {
    throw new JoinError('WRONG_ACADEMY', 'This class belongs to another academy.', 403)
  }

  const { ClassBookingModel } = await import('@/models/schema.ts')

  const booking = await ClassBookingModel.findOne({
    userId: new Types.ObjectId(ctx.userId),
    liveClassId: live._id,
    status: { $in: [...window.seatStatuses] },
  }).lean()
  if (!booking) {
    throw new JoinError('NOT_BOOKED', 'You have not booked this class.', 403)
  }

  /* The seat is not enough on its own: it was taken when the student was
     enrolled, and an admin can delete that enrolment afterwards without
     touching the booking row. Requiring the enrolment AT THE CLICK is what
     makes revoking course access actually revoke the class — the watch page
     refuses the same student with NOT_ENROLLED, and the two doors must not
     disagree. A missing enrolment used to read as "nothing blocked" and let
     the link through.

     Both that check and the module gate are now answered by the resolver
     above, against the door this student came through. */
  if (entitlement.code === 'NOT_ENROLLED') {
    throw new JoinError('NOT_ENROLLED', 'You are no longer enrolled in this course.', 403)
  }
  if (entitlement.code === 'MODULE_BLOCKED') {
    throw new JoinError('MODULE_BLOCKED',
      'This module is not available on your plan.', 403)
  }

  /* Time window last: everything above is a permanent no, this one is "not
     yet", and the UI should be able to tell them apart. */
  const now = Date.now()

  if (now < window.opensAt) {
    throw new JoinError('TOO_EARLY', window.tooEarly, 425,
      Math.ceil((window.opensAt - now) / 1000))
  }
  if (now > window.closesAt) {
    throw new JoinError(window.closed.code, window.closed.message, 409)
  }
}

/* ─────────────────────────────────────────────────────
   MEET — the link itself, released only inside the window
   ─────────────────────────────────────────────────────
   For an external Google Meet class the LMS cannot mint a ticket; the only
   thing it controls is WHEN it hands the URL over and TO WHOM. So the URL is
   in no student payload at all — not the schedule, not the feed, not the
   watch page, not the booking list — and this is the one place it leaves the
   server. Authorisation happens here, at the click, the way the handoff
   authorises at exchange rather than at issue: a booking withdrawn a second
   before the click is honoured. */
export async function resolveMeetJoin(
  liveClassId: string,
  ctx: JoinContext,
): Promise<{ url: string; closesAt: Date }> {
  const live = await loadClass(liveClassId)

  const isMeet = live.type === 'external'
    && (live as { isOnline?: boolean }).isOnline !== false
    && !!live.meetingUrl
  if (!isMeet) {
    throw new JoinError('NOT_A_MEET_CLASS', 'This class has no online meeting link.', 400)
  }
  if (live.status === 'cancelled') {
    throw new JoinError('CLASS_CANCELLED', 'This class was cancelled.', 409)
  }
  if (live.status === 'ended') {
    throw new JoinError('CLASS_ENDED', 'This class has already ended.', 409)
  }

  const window = MEET_WINDOW(live)
  await assertStudentMayJoin(live, ctx, window)

  logger.info({ liveClassId: live.id, actor: ctx.userId }, 'Meet link released to booked student')
  return { url: live.meetingUrl!, closesAt: new Date(window.closesAt) }
}

export async function mintStudentTicket(liveClassId: string, ctx: JoinContext): Promise<MintedTicket & { roomName: string }> {
  const live = await loadClass(liveClassId)
  assertJoinable(live)
  await assertStudentMayJoin(live, ctx)

  const roomName = await ensureRoomFor(live)
  const ticket = await mintTicket({
    userId: ctx.userId, name: ctx.name, email: ctx.email, role: 'student',
    liveClassId: live.id, roomName,
    ...(ctx.organizationId ? { orgSlug: ctx.organizationId } : {}),
    ...(ctx.avatarUrl ? { avatarUrl: ctx.avatarUrl } : {}),
    grants: { canPublish: true, roomAdmin: false, bypassLobby: true },
  })

  logger.info({ liveClassId: live.id, actor: ctx.userId }, 'LMS student ticket minted')
  return { ...ticket, roomName }
}
