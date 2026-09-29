/* ─────────────────────────────────────────────────────
   CLT Connect → LMS events  (Phase 5)
   ─────────────────────────────────────────────────────
   The third plane. Identity flows LMS→CLT in a signed ticket, commands flow
   LMS→CLT over HMAC S2S, and facts flow back the other way here: a recording
   finished, a meeting ended, somebody actually turned up.

   Same HMAC scheme as the commands plane, in reverse — CLT signs, the LMS
   verifies. Nothing here asserts an identity, so a shared secret is the right
   tool: the worst a leaked one buys is a forged "class ended", not a forged
   instructor.

   EVERY HANDLER IS IDEMPOTENT. A webhook that is not retried is a webhook that
   silently loses events, so CLT retries — which means the LMS must be able to
   receive the same event twice without double-counting attendance or
   resurrecting an ended class.
───────────────────────────────────────────────────── */
import { Types } from 'mongoose'
import { logger } from '@/utils/logger.ts'

export type CltEventType =
  | 'recording.ready'
  | 'meeting.ended'
  | 'participant.joined'

export interface CltEvent {
  type:      CltEventType
  roomName:  string
  /** ISO-8601 with offset. CLT computes in UTC, the LMS runs Asia/Dubai. */
  occurredAt?: string
  data?:     Record<string, unknown>
}

export class CltWebhookError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** Room name → the live class it belongs to. Indexed (sparse) in Phase 2. */
async function classForRoom(roomName: string) {
  const { LiveClassModel } = await import('@/models/schema.ts')
  const live = await LiveClassModel.findOne({ cltRoomName: roomName })
  if (!live) throw new CltWebhookError(`No live class for room ${roomName}`, 404)
  return live
}

/* ── recording.ready ───────────────────────────────────
   data: { url, durationSecs? }
   The recording itself stays in CLT's R2 bucket; the LMS stores a REFERENCE.
   Copying it would double the storage bill and give two things to keep in
   step, and CLT already serves it through a presigned redirect. */
async function onRecordingReady(evt: CltEvent): Promise<string> {
  /* An ID, not a URL. The CLT stream endpoint requires a CLT admin token that
     no LMS admin holds, and a presigned R2 link expires — either would rot in
     the database. The id is exchanged for a fresh link when somebody plays it. */
  const recordingId = Number(evt.data?.['recordingId'] ?? NaN)
  if (!Number.isInteger(recordingId)) {
    throw new CltWebhookError('recording.ready has no recordingId')
  }

  const live = await classForRoom(evt.roomName)
  if ((live as { cltRecordingId?: number }).cltRecordingId === recordingId) {
    return 'already recorded'
  }

  const duration = Number(evt.data?.['durationSecs'] ?? NaN)
  const { LiveClassModel } = await import('@/models/schema.ts')
  await LiveClassModel.updateOne({ _id: live._id }, {
    $set: {
      cltRecordingId: recordingId,
      ...(Number.isFinite(duration) ? { recordingDurationSecs: duration } : {}),
    },
  })
  logger.info({ liveClassId: live.id, recordingId }, 'CLT recording linked')
  return 'recording linked'
}

/* ── meeting.ended ─────────────────────────────────────
   Marks the class ended so the timetable and the student list stop offering a
   join button. Never re-opens a class: `status` only moves forward. */
async function onMeetingEnded(evt: CltEvent): Promise<string> {
  const live = await classForRoom(evt.roomName)
  if (live.status === 'ended' || live.status === 'cancelled') return 'already closed'

  const endedAt = evt.occurredAt ? new Date(evt.occurredAt) : new Date()
  const { LiveClassModel } = await import('@/models/schema.ts')
  await LiveClassModel.updateOne(
    { _id: live._id },
    { $set: { status: 'ended', endedAt } },
  )
  logger.info({ liveClassId: live.id, room: evt.roomName }, 'CLT meeting ended')
  return 'class closed'
}

/* ── participant.joined ────────────────────────────────
   data: { lmsUserId, joinedAt? }
   Attendance is recorded on the BOOKING, not by changing its status: a booking
   stays 'booked' whether or not the student turned up, and overwriting status
   would erase the difference between a cancellation and a no-show.

   Idempotent via $set of a fixed timestamp — the FIRST join is the one that
   counts, so a repeat delivery cannot move it later. */
async function onParticipantJoined(evt: CltEvent): Promise<string> {
  const lmsUserId = String(evt.data?.['lmsUserId'] ?? '')
  if (!lmsUserId || !Types.ObjectId.isValid(lmsUserId)) {
    /* An anonymous or non-LMS participant — a guest in an ad-hoc room. Not an
       error: there is simply no booking to mark. */
    return 'no lms user on this participant'
  }

  const live = await classForRoom(evt.roomName)
  const { ClassBookingModel, LiveClassModel } = await import('@/models/schema.ts')

  /* The instructor has no booking row — bookings are student seat
     reservations — so without this branch every internal class's real join
     event silently fell through to "no open booking to mark" and the mentor
     no-show jobs (reminders.job.ts) never had a positive signal to check
     against. $set only, never overwritten by a later duplicate delivery —
     the FIRST join is the one the no-show jobs need to see. */
  if (String(live.instructorId) === lmsUserId) {
    if ((live as { instructorJoinedAt?: Date }).instructorJoinedAt) return 'instructor join already recorded'
    const joinedAt = evt.data?.['joinedAt'] ? new Date(String(evt.data['joinedAt'])) : new Date()
    await LiveClassModel.updateOne({ _id: live._id }, { $set: { instructorJoinedAt: joinedAt } })
    logger.info({ liveClassId: live.id, lmsUserId }, 'instructor join recorded from CLT')
    return 'instructor join recorded'
  }

  const res = await ClassBookingModel.updateOne(
    {
      userId:      new Types.ObjectId(lmsUserId),
      liveClassId: live._id,
      status:      'booked',
      attendedAt:  { $exists: false },   // first join wins
    },
    {
      $set: {
        attendedAt: evt.data?.['joinedAt'] ? new Date(String(evt.data['joinedAt'])) : new Date(),
        attendanceSource: 'livekit',
      },
    },
  )

  if (res.matchedCount === 0) return 'no open booking to mark (already marked, or none)'
  logger.info({ liveClassId: live.id, lmsUserId }, 'attendance recorded from CLT')
  return 'attendance recorded'
}

const HANDLERS: Record<CltEventType, (e: CltEvent) => Promise<string>> = {
  'recording.ready':    onRecordingReady,
  'meeting.ended':      onMeetingEnded,
  'participant.joined': onParticipantJoined,
}

export async function handleCltEvent(evt: CltEvent): Promise<string> {
  if (!evt?.type || !evt?.roomName) {
    throw new CltWebhookError('Event needs a type and a roomName')
  }
  const handler = HANDLERS[evt.type]
  if (!handler) {
    /* Unknown types are ACKed, not rejected: CLT may ship a new event before
       the LMS knows about it, and a 4xx would make it retry forever. */
    logger.info({ type: evt.type }, 'CLT event ignored — unknown type')
    return 'ignored'
  }
  return handler(evt)
}
