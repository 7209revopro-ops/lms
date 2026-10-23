/* ─────────────────────────────────────────────────────
   Class pods — an HRMS meeting room for every online class
   ─────────────────────────────────────────────────────
   The user, 2026-10-18: "every online class gets a meeting room from the HRMS
   — only pod 4 and pods 6–11 — Moiz and Akhil CP don't need one, only the
   Dubai mentors' sessions, never overlapping; show pod availability in the
   mentors' portal; and give the current live sessions one too."

   Which classes: online, not cancelled, not over yet, taught by a mentor whose
   own academy is Dubai, and not one of the excluded mentors (by email —
   POD_EXCLUDED_MENTORS). A class holds its pod from POD_LEAD_MINUTES (15)
   before it starts — the class opens 15 minutes early — until it ends.

   The HRMS holds the bookings and refuses to hand one pod to two
   (hrms-backend services/classPodService.ts). Here each class remembers what
   it holds (`pod` on the class): kept while its time holds, moved when its
   time changes, let go when it is cancelled, deleted, goes offline or changes
   to a mentor who doesn't get one. Every pod taken: the class says so ("no
   pod free"), and its mentor and the academy's admins are told once.

   A save asks for its pod straight away; a sweep every minute catches
   anything else (imports, programs, scripts, the HRMS being down, a booking
   cancelled on the HRMS side) and lets go of pods held for classes that no
   longer need one. Off unless HRMS_API_URL, HRMS_CLIENT_ID,
   HRMS_INTEGRATION_SECRET and HRMS_ORG_ID are set; POD_SYNC=off turns it off.

   Office staff only (the user, 2026-10-19: "only office employees get the
   pod — check from the HRMS, and whether the instructor is correct"): the
   mentor must be, in the HRMS, an office employee (not work-from-home) in
   Dubai who hasn't left — found by their email, else by their exact name
   (shown as "email differs" on the Pods page). The HRMS not answering takes
   nothing away: that check is skipped until it answers again.

   Offline classes get a room the same way (2026-10-19): Class Room 1, Class
   Room 2, Ball Room 1 or Meeting Room 3 (HRMS_CLASS_ROOMS) — the one picked
   on the class, else the first free (an old "Room 1" / "1" / "2" / "Ball
   room" read as a wish for that room). A class held off site (a location
   that isn't the academy) gets none. The room it holds is written on the
   class (`room`), `pod.auto` saying the LMS picked it.
   ───────────────────────────────────────────────────── */
import crypto from 'node:crypto'
import { Types } from 'mongoose'
import { LiveClassModel, UserModel, OrganizationModel } from '@/models/schema.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { logger } from '@/utils/logger.ts'

const DEFAULT_PODS = ['Pod 4', 'Pod 6', 'Pod 7', 'Pod 8', 'Pod 9', 'Pod 10', 'Pod 11']
const DEFAULT_EXCLUDED = ['moiz@deltainstitutions.com', 'akhilcp@deltainstitutions.com']
const DEFAULT_ROOMS = ['Class Room 1', 'Class Room 2', 'Ball Room 1', 'Meeting Room 3']
/** A location that is the academy itself — anything else named is off site. */
const ON_SITE = /qusais|ball\s*room|delta|office|academy|institut/i
const TIMEOUT_MS = 15_000
/** How far ahead the sweep looks, and how often a "no pod free" or failed class is tried again. */
const AHEAD_DAYS = 60
const RETRY_MS = 10 * 60_000

const list = (v: string | undefined, fallback: string[]) => {
  const items = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return items.length ? items : fallback
}

export function podConfig() {
  return {
    baseUrl: String(process.env.HRMS_API_URL ?? '').replace(/\/+$/, '').replace(/\/api\/v1$/, ''),
    clientId: String(process.env.HRMS_CLIENT_ID ?? ''),
    secret: String(process.env.HRMS_INTEGRATION_SECRET ?? ''),
    orgId: String(process.env.HRMS_ORG_ID ?? ''),
    pods: list(process.env.HRMS_CLASS_PODS, DEFAULT_PODS),
    rooms: list(process.env.HRMS_CLASS_ROOMS, DEFAULT_ROOMS),
    excluded: list(process.env.POD_EXCLUDED_MENTORS, DEFAULT_EXCLUDED).map((e) => e.toLowerCase()),
    leadMinutes: Math.max(0, Number(process.env.POD_LEAD_MINUTES ?? 15) || 0),
  }
}

export function podsConfigured(): boolean {
  const c = podConfig()
  return !/^(off|false|0|no)$/i.test(String(process.env.POD_SYNC ?? '')) && !!(c.baseUrl && c.clientId && c.secret && c.orgId)
}

/* ── The HRMS, signed as its integration API wants (hrms-backend utils/signing.ts) ── */

async function hrms<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const c = podConfig()
  const qs = new URLSearchParams({ organizationId: c.orgId, ...query }).toString()
  const signedPath = `/api/v1/integrations${path}?${qs}`
  const raw = body === undefined ? '' : JSON.stringify(body)
  const timestamp = String(Date.now())
  const nonce = crypto.randomBytes(16).toString('hex')
  const bodyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const signature = crypto.createHmac('sha256', c.secret).update([method, signedPath, timestamp, nonce, bodyHash].join('\n')).digest('hex')
  const res = await fetch(`${c.baseUrl}${signedPath}`, {
    method,
    headers: {
      'content-type': 'application/json', 'x-delta-client': c.clientId, 'x-delta-timestamp': timestamp,
      'x-delta-nonce': nonce, 'x-delta-signature': signature,
    },
    ...(raw ? { body: raw } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = await res.json().catch(() => ({})) as { success?: boolean; message?: string; data?: T }
  if (!res.ok || json.success === false) {
    throw Object.assign(new Error(`HRMS ${res.status}: ${json.message ?? 'request failed'}`), { status: res.status })
  }
  return json.data as T
}

interface HrmsPod { id: string; name: string; capacity: number; location: string }
interface HrmsBooking { id: string; roomId: string; roomName: string; start: string; end: string; title: string; holder: string; classRef: string | null }
type HoldResult = { ok: true; booking: HrmsBooking; changed: boolean } | { ok: false; reason: 'no_room'; message: string }

let podsCache: { at: number; pods: HrmsPod[] } | null = null
/** The pods by name, in the configured order — read once every five minutes. */
export async function hrmsPods(): Promise<HrmsPod[]> {
  if (podsCache && Date.now() - podsCache.at < 5 * 60_000) return podsCache.pods
  const pods = await hrms<HrmsPod[]>('GET', '/meetings/pods', { names: podConfig().pods.join(',') })
  podsCache = { at: Date.now(), pods }
  return pods
}
let roomsCache: { at: number; rooms: HrmsPod[] } | null = null
/** The offline class rooms by name, in the configured order — read once every five minutes. */
export async function hrmsRooms(): Promise<HrmsPod[]> {
  if (roomsCache && Date.now() - roomsCache.at < 5 * 60_000) return roomsCache.rooms
  const rooms = await hrms<HrmsPod[]>('GET', '/meetings/pods', { names: podConfig().rooms.join(',') })
  roomsCache = { at: Date.now(), rooms }
  return rooms
}
export function resetPodCache(): void { podsCache = null; roomsCache = null; dubaiOrg = null; staffCache.clear() }

/* ── Where mentors work, from the HRMS (2026-10-19) ── */

export interface Staff {
  matchedBy: 'email' | 'name' | null; hrmsEmail: string | null; hrmsName: string | null
  workMode: 'office' | 'wfh' | null; location: 'india' | 'dubai' | null; status: string | null; designation: string | null
}
const STAFF_TTL = 10 * 60_000
const staffCache = new Map<string, { at: number; staff: Staff }>()
const keyOf = (m: Pick<Mentor, 'email' | 'name'>) => String(m.email ?? '').trim().toLowerCase() || `name:${String(m.name ?? '').trim().toLowerCase()}`

/**
 * Each mentor's HRMS record, by their LMS email (else exact name) — read at most every ten minutes. null when the
 * HRMS couldn't be asked: the office check is then skipped, nothing taken away for it.
 */
export async function staffOf(mentors: Array<Pick<Mentor, 'email' | 'name'>>): Promise<Map<string, Staff> | null> {
  const out = new Map<string, Staff>()
  const ask: Array<{ email: string; name?: string }> = []
  for (const m of mentors) {
    const k = keyOf(m)
    const hit = staffCache.get(k)
    if (hit && Date.now() - hit.at < STAFF_TTL) out.set(k, hit.staff)
    else if (!ask.some((a) => keyOf(a) === k)) ask.push({ email: String(m.email ?? ''), name: m.name ?? undefined })
  }
  for (let i = 0; i < ask.length; i += 300) {
    try {
      const rows = await hrms<Array<Staff & { email: string }>>('POST', '/directory/work-modes', {}, { people: ask.slice(i, i + 300) })
      rows.forEach((r, j) => {
        const k = keyOf(ask[i + j])
        const staff: Staff = { matchedBy: r.matchedBy, hrmsEmail: r.hrmsEmail, hrmsName: r.hrmsName, workMode: r.workMode, location: r.location, status: r.status, designation: r.designation }
        staffCache.set(k, { at: Date.now(), staff })
        out.set(k, staff)
      })
    } catch (err) {
      logger.warn({ err }, '[pods] could not ask the HRMS where mentors work — the office check waits')
      return null
    }
  }
  return out
}
export const staffFor = (all: Map<string, Staff> | null, m: Mentor | null | undefined): Staff | null | undefined =>
  all === null ? undefined : m ? all.get(keyOf(m)) ?? null : null

const LEFT = new Set(['terminated', 'resigned'])
/** Why the HRMS says this mentor gets no pod, or null. `undefined`: the HRMS wasn't asked — no reason. */
export function staffReason(staff: Staff | null | undefined): string | null {
  if (staff === undefined) return null
  if (!staff || !staff.matchedBy) return 'not in the HRMS'
  if (LEFT.has(String(staff.status))) return 'left (HRMS)'
  if (staff.workMode === 'wfh') return 'works from home (HRMS)'
  if (staff.location && staff.location !== 'dubai') return 'not in Dubai (HRMS)'
  return null
}

/* ── Which classes get one ── */

let dubaiOrg: { id: string; at: number } | null = null
async function dubaiOrgId(): Promise<string> {
  if (dubaiOrg && Date.now() - dubaiOrg.at < 10 * 60_000) return dubaiOrg.id
  const org = await OrganizationModel.findOne({ slug: 'dubai' }).select('_id').lean() as { _id: unknown } | null
  dubaiOrg = { id: org ? String(org._id) : '', at: Date.now() }
  return dubaiOrg.id
}

type ClassRow = {
  _id: Types.ObjectId; title?: string; scheduledStart: Date; durationMins: number; status?: string; isOnline?: boolean
  instructorId?: Types.ObjectId | null; location?: string; room?: string
  pod?: { state?: string; bookingId?: string; roomId?: string; roomName?: string; for?: string; at?: Date; alertedFor?: string; auto?: boolean; note?: string } | null
  organizationId?: unknown; meetSpace?: { name: string; host: string; cohost?: string; calendarEventId?: string } | null
  meetingUrl?: string; type?: string; createdAt?: Date
}
type Mentor = { _id: Types.ObjectId; name?: string; email?: string; organizationId?: Types.ObjectId | null; role?: string; emailPrefs?: unknown }

/** Why an online class gets no pod, or null when it gets one. `staff`: the mentor in the HRMS (undefined: not asked). */
export function whyNoPod(lc: ClassRow, mentor: Mentor | null | undefined, dubai: string, now = new Date(), staff?: Staff | null): string | null {
  if (lc.status === 'cancelled') return 'cancelled'
  if (lc.isOnline === false) return 'in person'
  if (lc.scheduledStart.getTime() + lc.durationMins * 60_000 <= now.getTime()) return 'over'
  if (!mentor) return 'no mentor'
  if (podConfig().excluded.includes(String(mentor.email ?? '').toLowerCase())) return 'excluded mentor'
  if (!dubai || String(mentor.organizationId ?? '') !== dubai) return 'not a Dubai mentor'
  return staffReason(staff)
}

/** Why an offline class gets no room, or null when it gets one — the room is the academy's, whoever teaches. */
export function whyNoRoom(lc: ClassRow, dubai: string, now = new Date()): string | null {
  if (lc.status === 'cancelled') return 'cancelled'
  if (lc.isOnline !== false) return 'online'
  if (lc.scheduledStart.getTime() + lc.durationMins * 60_000 <= now.getTime()) return 'over'
  if (!dubai || String(lc.organizationId ?? '') !== dubai) return 'not a Dubai class'
  const where = String(lc.location ?? '').trim()
  if (where && !ON_SITE.test(where)) return 'off site'
  return null
}

/** Why a class holds nothing — a pod online, a room in person — or null. */
export function whyNoHold(lc: ClassRow, mentor: Mentor | null | undefined, dubai: string, now = new Date(), staff?: Staff | null): string | null {
  return lc.isOnline === false ? whyNoRoom(lc, dubai, now) : whyNoPod(lc, mentor, dubai, now, staff)
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
/** The room picked on an offline class — its exact name — unless the LMS picked it itself. */
function chosenRoom(lc: ClassRow, rooms: HrmsPod[]): HrmsPod | null {
  const r = rooms.find((x) => norm(x.name) === norm(lc.room))
  if (!r) return null
  return lc.pod?.auto && norm(lc.pod.roomName) === norm(r.name) ? null : r
}
/** What an old typed room asked for ("Room 1", "1", "2", "Ball room") — tried first when the LMS picks. */
function wishedRoom(lc: ClassRow, rooms: HrmsPod[]): HrmsPod | null {
  const text = `${lc.room ?? ''} ${lc.location ?? ''}`
  const by = (re: RegExp) => rooms.find((x) => re.test(x.name)) ?? null
  if (/ball/i.test(text)) return by(/ball/i)
  const n = norm(lc.room).replace(/^(class\s*)?room\s*/, '')
  if (n === '1') return by(/class room 1$/i)
  if (n === '2') return by(/class room 2$/i)
  return null
}
/** The rooms an offline class may have, the one to try first first; `only` when one was picked. */
function roomOrder(lc: ClassRow, rooms: HrmsPod[]): { order: string[]; picked: boolean } {
  const chosen = chosenRoom(lc, rooms)
  if (chosen) return { order: [chosen.id], picked: true }
  const first = [lc.pod?.roomId && rooms.some((r) => r.id === lc.pod!.roomId) ? lc.pod!.roomId! : null, wishedRoom(lc, rooms)?.id ?? null]
    .filter((x): x is string => !!x)
  return { order: [...new Set([...first, ...rooms.map((r) => r.id)])], picked: false }
}

/** The stretch a class holds its pod for: from the lead before it starts until it ends. */
export function podWindow(lc: Pick<ClassRow, 'scheduledStart' | 'durationMins'>) {
  const start = new Date(lc.scheduledStart.getTime() - podConfig().leadMinutes * 60_000)
  const end = new Date(lc.scheduledStart.getTime() + lc.durationMins * 60_000)
  return { start, end, key: `${start.toISOString()}|${end.toISOString()}` }
}

const notifier = new NotificationService()
const when = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Every pod taken: the Dubai academy's admins are told in the app, and the mentor by email (the user, 2026-10-18:
 * "only email for the mentor") — once for this stretch. Not a class made a moment ago: its "You've been scheduled"
 * email already says no pod is free.
 */
async function tellNoPod(lc: ClassRow, mentor: Mentor | null, key: string, dubai: string, now: Date): Promise<void> {
  const claimed = await LiveClassModel.updateOne({ _id: lc._id, 'pod.alertedFor': { $ne: key } }, { $set: { 'pod.alertedFor': key } })
  if (!claimed.modifiedCount) return
  const offline = lc.isOnline === false
  const fresh = lc.createdAt && now.getTime() - new Date(lc.createdAt).getTime() < 5 * 60_000
  // An offline class's room is the academy's to sort out: its admins are told, not the mentor.
  if (!fresh && !offline && mentor) await emailMentor(lc, mentor, 'lost', null, now)
  const admins = await UserModel.find({
    isActive: { $ne: false },
    $or: [{ role: 'super_admin' }, { role: 'admin', organizationId: new Types.ObjectId(dubai) }],
  }).select('_id').lean() as Array<{ _id: unknown }>
  const to = [...new Set(admins.map((a) => String(a._id)))]
  const who = mentor?.name ?? 'The mentor'
  const title = offline ? `No room free for "${lc.title ?? 'a class'}"` : `No pod free for "${lc.title ?? 'a class'}"`
  const body = offline
    ? `${who}'s offline class on ${when(lc.scheduledStart)} (Dubai) has no class room — ${lc.pod?.note ?? 'every room is booked then'}. Pick another room or time, or free one in the HRMS.`
    : `${who}'s online class on ${when(lc.scheduledStart)} (Dubai) has no meeting pod — every pod is booked then. Move it, or free a pod in the HRMS.`
  for (const u of to) {
    await notifier.create(u, { kind: 'system', title, body, link: '/pods' }).catch((err) => logger.warn({ err, classId: String(lc._id) }, '[pods] could not tell about a class with no pod'))
  }
}

/** The mentor told by email that a class's pod was given, moved or lost — only for a class in the next 7 days. */
async function emailMentor(lc: ClassRow, mentor: Mentor, change: 'assigned' | 'changed' | 'lost', roomName: string | null, now: Date): Promise<void> {
  if (!mentor.email) return
  const until = lc.scheduledStart.getTime() - now.getTime()
  if (until < 0 || until > 7 * 864e5) return
  try {
    const { wantsStaffEmail } = await import('@/utils/emailPrefs.ts')
    if (!wantsStaffEmail(mentor as never, 'classScheduled')) return
    const { sendMentorPodChanged } = await import('@/services/email.service.ts')
    const { ensureOrgSlugs, orgSlugFor } = await import('@/utils/orgSlugs.ts')
    await ensureOrgSlugs().catch(() => undefined)
    await sendMentorPodChanged(mentor.email, mentor.name ?? 'Mentor', lc.title ?? 'Class', lc.scheduledStart, {
      classId: String(lc._id), meetLink: lc.type !== 'internal' ? lc.meetingUrl : undefined,
      pod: change === 'lost' ? { state: 'no_room' } : { state: 'booked', roomName: roomName ?? '' },
    }, change, orgSlugFor(lc.organizationId))
  } catch (err) {
    logger.warn({ err, classId: String(lc._id) }, '[pods] could not email the mentor about a pod change')
  }
}

/** The mentor's calendar entry says where: the pod, or nothing once there is none. Quietly; never throws. */
function calendarWhere(lc: ClassRow, roomName: string): void {
  if (!lc.meetSpace?.calendarEventId) return
  void import('@/services/googleMeet.service.ts')
    .then(({ syncMeetSpace }) => syncMeetSpace(lc.meetSpace as never, { location: roomName }))
    .catch((err) => logger.warn({ err, classId: String(lc._id) }, '[pods] could not put the pod on the calendar entry'))
}

/**
 * One class brought into line with the HRMS: a pod held for its stretch, moved, or let go. Never throws — what
 * went wrong is kept on the class and tried again by the sweep.
 */
/* One at a time per class in this process: a save's own request and the "You've been scheduled" email both ask
   right after a class is made, and two at once could each take a pod. */
const inFlight = new Map<string, Promise<SyncOutcome>>()
type SyncOutcome = 'booked' | 'no_room' | 'released' | 'none' | 'error' | 'off'

export function syncClassPod(classId: string, now = new Date(), opts: { held?: boolean } = {}): Promise<SyncOutcome> {
  const running = inFlight.get(classId)
  if (running) return running
  const p = syncClassPodOnce(classId, now, opts).finally(() => inFlight.delete(classId))
  inFlight.set(classId, p)
  return p
}

async function syncClassPodOnce(classId: string, now: Date, opts: { held?: boolean }): Promise<SyncOutcome> {
  if (!podsConfigured() || !Types.ObjectId.isValid(classId)) return 'off'
  const lc = await LiveClassModel.findById(classId)
    .select('title scheduledStart durationMins status isOnline instructorId pod organizationId meetSpace meetingUrl type createdAt location room').lean() as ClassRow | null
  if (!lc) { await releaseClassPod(classId); return 'released' }
  const mentor = lc.instructorId
    ? await UserModel.findById(lc.instructorId).select('name email organizationId role emailPrefs').lean() as Mentor | null
    : null
  const dubai = await dubaiOrgId()
  const offline = lc.isOnline === false
  try {
    // Online: is the mentor office staff in Dubai, by the HRMS? (Not asked when nothing else rules them out.)
    const staff = !offline && mentor && !whyNoPod(lc, mentor, dubai, now) ? staffFor(await staffOf([mentor]), mentor) : undefined
    // The HRMS has none of the class rooms (another academy's set-up): offline classes simply hold none.
    const rooms = offline ? await hrmsRooms() : []
    if (whyNoHold(lc, mentor, dubai, now, staff) || (offline && !rooms.length)) {
      // Let go of what it holds — or what the HRMS says it holds, though the class forgot.
      if (lc.pod || opts.held) {
        await hrms('DELETE', `/meetings/class-pods/${lc._id}`)
        await LiveClassModel.updateOne({ _id: lc._id }, { $unset: { pod: '' } })
        if (lc.pod?.roomName && lc.status !== 'cancelled' && !offline) calendarWhere(lc, '')
        return 'released'
      }
      return 'none'
    }
    const w = podWindow(lc)
    let order: string[], picked = false
    if (offline) {
      ;({ order, picked } = roomOrder(lc, rooms))
    } else {
      const pods = await hrmsPods()
      if (!pods.length) throw new Error('The HRMS has none of the configured pods (HRMS_CLASS_PODS)')
      // The pod it has first, so a class that moved keeps its room when that is free.
      order = lc.pod?.roomId && pods.some((p) => p.id === lc.pod!.roomId)
        ? [lc.pod.roomId, ...pods.map((p) => p.id).filter((id) => id !== lc.pod!.roomId)]
        : pods.map((p) => p.id)
    }
    const r = await hrms<HoldResult>('PUT', `/meetings/class-pods/${lc._id}`, {}, {
      organizationId: podConfig().orgId, rooms: order, start: w.start.toISOString(), end: w.end.toISOString(),
      title: `Class: ${lc.title ?? (offline ? 'Offline class' : 'Online class')}`.slice(0, 140),
      label: `LMS class · ${mentor?.name ?? mentor?.email ?? 'mentor'}`, organizerEmail: mentor?.email,
    })
    if (r.ok) {
      await LiveClassModel.updateOne({ _id: lc._id }, { $set: {
        pod: { state: 'booked', roomId: r.booking.roomId, roomName: r.booking.roomName, bookingId: r.booking.id, for: w.key, at: now, ...(offline ? { auto: !picked } : {}) },
        // The class says where it is: the room it holds.
        ...(offline && norm(lc.room) !== norm(r.booking.roomName) ? { room: r.booking.roomName } : {}),
      } })
      if (offline) return 'booked'
      // Given or moved after it was scheduled: the mentor is emailed; their calendar entry says the pod either way.
      const was = lc.pod
      if (was?.roomName !== r.booking.roomName || was?.state !== 'booked') {
        if (was?.state === 'booked' && was.roomName && was.roomName !== r.booking.roomName) await emailMentor(lc, mentor!, 'changed', r.booking.roomName, now)
        else if (was?.state === 'no_room' || was?.state === 'error') await emailMentor(lc, mentor!, 'assigned', r.booking.roomName, now)
        calendarWhere(lc, r.booking.roomName)
      }
      return 'booked'
    }
    const note = offline ? (picked ? `${lc.room} is booked at this time` : 'Every class room is booked at this time') : 'Every pod is booked at this time'
    await LiveClassModel.updateOne({ _id: lc._id }, { $set: {
      'pod.state': 'no_room', 'pod.for': w.key, 'pod.at': now, 'pod.note': note,
    }, $unset: { 'pod.roomId': '', 'pod.roomName': '', 'pod.bookingId': '' } })
    if (lc.pod?.roomName && !offline) calendarWhere(lc, '')
    await tellNoPod({ ...lc, pod: { ...(lc.pod ?? {}), note } as never }, mentor, w.key, dubai, now)
    return 'no_room'
  } catch (err) {
    logger.warn({ err, classId }, '[pods] could not reach the HRMS for a class pod')
    // A pod it held stays shown as held: the HRMS still has it until told otherwise.
    if (lc.pod?.state !== 'booked') {
      await LiveClassModel.updateOne({ _id: lc._id }, { $set: { 'pod.state': 'error', 'pod.at': now, 'pod.note': String((err as Error).message).slice(0, 300) } })
    } else {
      await LiveClassModel.updateOne({ _id: lc._id }, { $set: { 'pod.at': now, 'pod.note': String((err as Error).message).slice(0, 300) } })
    }
    return 'error'
  }
}

/** The class is gone (deleted): whatever pod it held is let go. Never throws. */
export async function releaseClassPod(classId: string): Promise<void> {
  if (!podsConfigured()) return
  try { await hrms('DELETE', `/meetings/class-pods/${classId}`) }
  catch (err) { logger.warn({ err, classId }, '[pods] could not let go of a deleted class\'s pod — the sweep will') }
}

/** A save asks straight away; the sweep is the safety net. */
export function kickClassPod(classId: string): void {
  if (!podsConfigured()) return
  void syncClassPod(classId).catch((err) => logger.warn({ err, classId }, '[pods] sync after a save failed'))
}

/* ── The sweep ── */

/**
 * Every class that should hold a pod and doesn't hold the right one, and every pod held for a class that no
 * longer needs it. `limit` classes a run (the longest unsynced first).
 */
export async function runPodSweep(now = new Date(), limit = 200): Promise<{ synced: number; released: number; checked: number }> {
  if (!podsConfigured()) return { synced: 0, released: 0, checked: 0 }
  const dubai = await dubaiOrgId()
  const horizon = new Date(now.getTime() + AHEAD_DAYS * 864e5)
  const classes = await LiveClassModel.find({
    scheduledStart: { $gte: new Date(now.getTime() - 24 * 3600_000), $lte: horizon },
  }).select('title scheduledStart durationMins status isOnline instructorId pod organizationId location room').sort({ scheduledStart: 1 }).lean() as ClassRow[]
  const mentorIds = [...new Set(classes.map((c) => String(c.instructorId ?? '')).filter((id) => Types.ObjectId.isValid(id)))]
  const mentors = new Map((await UserModel.find({ _id: { $in: mentorIds } }).select('name email organizationId').lean() as Mentor[]).map((m) => [String(m._id), m]))
  const staff = await staffOf([...mentors.values()])
  // No class rooms in the HRMS: offline classes hold none (and aren't asked about every minute). Unreachable: try.
  const roomsReady = await hrmsRooms().then((r) => r.length > 0, () => true)
  const why = (c: ClassRow) => {
    if (c.isOnline === false && !roomsReady) return 'no class rooms in the HRMS'
    const m = mentors.get(String(c.instructorId ?? ''))
    return whyNoHold(c, m, dubai, now, staffFor(staff, m))
  }

  // What the HRMS holds for us now — a booking cancelled there, or one held for a class gone, is put right.
  const holds = await hrms<Array<{ ref: string; bookingId: string; roomId: string; start: string; end: string }>>('GET', '/meetings/class-pods', { from: now.toISOString() })
  const heldFor = new Map(holds.map((h) => [h.ref, h]))
  const byId = new Map(classes.map((c) => [String(c._id), c]))

  let released = 0
  for (const h of holds) {
    const c = byId.get(h.ref)
    const gone = !c && !(await LiveClassModel.exists({ _id: Types.ObjectId.isValid(h.ref) ? h.ref : new Types.ObjectId() }))
    if (gone || (c && why(c))) {
      if (c) await syncClassPod(String(c._id), now, { held: true }); else await releaseClassPod(h.ref)
      released++
    }
  }

  let synced = 0
  for (const c of classes) {
    if (synced >= limit) break
    if (why(c)) {
      if (c.pod && !heldFor.has(String(c._id))) { await LiveClassModel.updateOne({ _id: c._id }, { $unset: { pod: '' } }); synced++ }
      continue
    }
    const w = podWindow(c)
    const h = heldFor.get(String(c._id))
    const right = c.pod?.state === 'booked' && c.pod.for === w.key && h && h.bookingId === c.pod.bookingId
    const retryDue = !c.pod?.at || now.getTime() - new Date(c.pod.at).getTime() >= RETRY_MS
    const settled = right || ((c.pod?.state === 'no_room' || c.pod?.state === 'error') && c.pod.for === w.key && !retryDue)
    if (settled) continue
    await syncClassPod(String(c._id), now)
    synced++
  }
  return { synced, released, checked: classes.length }
}

/* ── The mentors' Pods page ── */

export interface PodsView {
  configured: boolean
  /** The pods online classes get, then the rooms offline classes get (`kind`). */
  pods: Array<{ id: string; name: string; kind: 'pod' | 'room' }>
  bookings: Array<{ id: string; podId: string; pod: string; start: string; end: string; title: string; holder: string; classId: string | null; mine: boolean }>
  /** Classes over the stretch with nothing held: every pod / room taken then, or the HRMS not reached yet. */
  waiting: Array<{ classId: string; title: string; start: string; mentor: string; state: 'no_room' | 'error'; mine: boolean; kind: 'pod' | 'room'; note: string }>
  /** Every mentor with an online class over the stretch, as the HRMS knows them — is the instructor right? (2026-10-19) */
  mentors: Array<{
    id: string; name: string; email: string; classes: number
    hrms: 'office' | 'wfh' | 'not_found' | 'email_differs' | 'left' | 'not_dubai' | 'unknown' | 'excluded' | 'other_academy'
    hrmsEmail: string | null; hrmsName: string | null; designation: string | null; getsPod: boolean; reason: string | null
  }>
}

/** The pods and rooms, and who has them over [from, to) — every booking, staff meetings too, a class's own linked. */
export async function podsView(from: Date, to: Date, viewerId?: string): Promise<PodsView> {
  if (!podsConfigured()) return { configured: false, pods: [], bookings: [], waiting: [], mentors: [] }
  const [pods, rooms, dubai] = await Promise.all([hrmsPods(), hrmsRooms(), dubaiOrgId()])
  const unheld = await LiveClassModel.find({ scheduledStart: { $gte: from, $lt: to }, 'pod.state': { $in: ['no_room', 'error'] }, status: { $ne: 'cancelled' } })
    .select('title scheduledStart instructorId pod isOnline').sort({ scheduledStart: 1 }).lean() as Array<{ _id: unknown; title?: string; scheduledStart: Date; instructorId?: unknown; isOnline?: boolean; pod: { state: 'no_room' | 'error'; note?: string } }>
  const online = await LiveClassModel.find({ scheduledStart: { $gte: from, $lt: to }, isOnline: { $ne: false }, status: { $ne: 'cancelled' } })
    .select('instructorId').lean() as Array<{ instructorId?: unknown }>
  const counts = new Map<string, number>()
  for (const c of online) if (c.instructorId) counts.set(String(c.instructorId), (counts.get(String(c.instructorId)) ?? 0) + 1)
  const people = await UserModel.find({ _id: { $in: [...new Set([...counts.keys(), ...unheld.map((c) => String(c.instructorId ?? ''))])].filter((id) => Types.ObjectId.isValid(id)) } })
    .select('name email organizationId').lean() as Mentor[]
  const byId = new Map(people.map((u) => [String(u._id), u]))
  const waiting = unheld.map((c) => ({
    classId: String(c._id), title: c.title ?? 'Class', start: c.scheduledStart.toISOString(), mentor: byId.get(String(c.instructorId))?.name ?? '',
    state: c.pod.state, mine: !!viewerId && String(c.instructorId) === viewerId, kind: (c.isOnline === false ? 'room' : 'pod') as 'room' | 'pod', note: c.pod.note ?? '',
  }))
  const teaching = people.filter((m) => counts.has(String(m._id)))
  const staff = await staffOf(teaching)
  const excluded = podConfig().excluded
  const mentors = teaching.map((m) => {
    const st = staffFor(staff, m)
    const other = !dubai || String(m.organizationId ?? '') !== dubai
    const skip = excluded.includes(String(m.email ?? '').toLowerCase())
    const reason = skip ? 'excluded mentor' : other ? 'not a Dubai mentor' : staffReason(st)
    const hrms: PodsView['mentors'][number]['hrms'] = st === undefined ? 'unknown'
      : !st || !st.matchedBy ? 'not_found'
      : ['terminated', 'resigned'].includes(String(st.status)) ? 'left'
      : st.workMode === 'wfh' ? 'wfh'
      : st.location && st.location !== 'dubai' ? 'not_dubai'
      : st.matchedBy === 'name' ? 'email_differs' : 'office'
    return {
      id: String(m._id), name: m.name ?? '', email: m.email ?? '', classes: counts.get(String(m._id)) ?? 0,
      hrms: skip ? 'excluded' as const : other ? 'other_academy' as const : hrms,
      hrmsEmail: st?.hrmsEmail ?? null, hrmsName: st?.hrmsName ?? null, designation: st?.designation ?? null,
      getsPod: !reason, reason,
    }
  }).sort((a, b) => Number(a.getsPod) - Number(b.getsPod) || b.classes - a.classes)
  const all = [...pods.map((p) => ({ id: p.id, name: p.name, kind: 'pod' as const })), ...rooms.map((r) => ({ id: r.id, name: r.name, kind: 'room' as const }))]
  if (!all.length) return { configured: true, pods: [], bookings: [], waiting, mentors }
  const rows = await hrms<HrmsBooking[]>('GET', '/meetings/pod-bookings', {
    rooms: all.map((p) => p.id).join(','), from: from.toISOString(), to: to.toISOString(),
  })
  const refs = rows.map((r) => r.classRef).filter((r): r is string => !!r && Types.ObjectId.isValid(r))
  const mine = viewerId && refs.length
    ? new Set((await LiveClassModel.find({ _id: { $in: refs }, instructorId: viewerId }).select('_id').lean() as Array<{ _id: unknown }>).map((c) => String(c._id)))
    : new Set<string>()
  return {
    configured: true,
    pods: all,
    bookings: rows.map((r) => ({
      id: r.id, podId: r.roomId, pod: r.roomName, start: r.start, end: r.end, title: r.title, holder: r.holder,
      classId: r.classRef, mine: !!r.classRef && mine.has(r.classRef),
    })),
    waiting,
    mentors,
  }
}

/** Whether each offline room is free over [start, end) — for the class modal's room picker. `classId`: its own booking doesn't count. */
export async function roomAvailability(start: Date, end: Date, classId?: string): Promise<{ configured: boolean; rooms: Array<{ id: string; name: string; free: boolean; holder: string | null }> }> {
  if (!podsConfigured()) return { configured: false, rooms: [] }
  const rooms = await hrmsRooms()
  if (!rooms.length) return { configured: true, rooms: [] }
  const lead = podConfig().leadMinutes * 60_000
  const s = new Date(start.getTime() - lead)
  const rows = await hrms<HrmsBooking[]>('GET', '/meetings/pod-bookings', { rooms: rooms.map((r) => r.id).join(','), from: s.toISOString(), to: end.toISOString() })
  return {
    configured: true,
    rooms: rooms.map((r) => {
      const taken = rows.find((b) => b.roomId === r.id && (!classId || b.classRef !== classId))
      return { id: r.id, name: r.name, free: !taken, holder: taken ? (taken.holder || taken.title) : null }
    }),
  }
}

/* ── The backfill's dry run (scripts/class-pods-backfill.ts) ── */

export interface PodPlanRow {
  classId: string; title: string; start: string; end: string; mentor: string
  /** A pod for an online class, a class room for an offline one. */
  kind: 'pod' | 'room'
  /** keeps / gets — and which pod; no_pod — every pod taken then; skip — why it gets none. */
  outcome: 'keeps' | 'gets' | 'no_pod' | 'skip'
  pod?: string; reason?: string
}

/**
 * What the sweep would do with every class from a day ago to AHEAD_DAYS on, worked out against what the HRMS holds
 * now — reading only, nothing booked. In start order, each class takes the first pod free then, as the sweep would.
 */
export async function planPodBackfill(now = new Date()): Promise<PodPlanRow[]> {
  if (!podsConfigured()) throw new Error('Pods are not configured: set HRMS_API_URL, HRMS_CLIENT_ID, HRMS_INTEGRATION_SECRET and HRMS_ORG_ID')
  const dubai = await dubaiOrgId()
  const from = new Date(now.getTime() - 24 * 3600_000), horizon = new Date(now.getTime() + AHEAD_DAYS * 864e5)
  const classes = await LiveClassModel.find({ scheduledStart: { $gte: from, $lte: horizon } })
    .select('title scheduledStart durationMins status isOnline instructorId pod organizationId location room').sort({ scheduledStart: 1 }).lean() as ClassRow[]
  const mentors = new Map((await UserModel.find({ _id: { $in: classes.map((c) => c.instructorId).filter(Boolean) } }).select('name email organizationId').lean() as Mentor[]).map((m) => [String(m._id), m]))
  const staff = await staffOf([...mentors.values()])
  const pods = await hrmsPods()
  const rooms = await hrmsRooms()
  const all = [...pods, ...rooms]
  const busy: Array<{ podId: string; start: number; end: number; classRef: string | null }> = []
  // The HRMS's own answer is at most 62 days at a time.
  for (let t = from.getTime(); all.length && t < horizon.getTime(); t += 60 * 864e5) {
    const rows = await hrms<HrmsBooking[]>('GET', '/meetings/pod-bookings', {
      rooms: all.map((p) => p.id).join(','), from: new Date(t).toISOString(), to: new Date(Math.min(t + 60 * 864e5, horizon.getTime())).toISOString(),
    })
    for (const r of rows) if (!busy.some((b) => b.podId === r.roomId && b.start === Date.parse(r.start) && b.classRef === r.classRef)) {
      busy.push({ podId: r.roomId, start: Date.parse(r.start), end: Date.parse(r.end), classRef: r.classRef })
    }
  }
  const name = new Map(all.map((p) => [p.id, p.name]))
  const out: PodPlanRow[] = []
  for (const c of classes) {
    const m = mentors.get(String(c.instructorId ?? ''))
    const w = podWindow(c)
    const base = { classId: String(c._id), title: c.title ?? 'Class', start: w.start.toISOString(), end: w.end.toISOString(), mentor: m?.name ?? m?.email ?? '', kind: (c.isOnline === false ? 'room' : 'pod') as 'room' | 'pod' }
    const why = c.isOnline === false && !rooms.length ? 'no class rooms in the HRMS' : whyNoHold(c, m, dubai, now, staffFor(staff, m))
    if (why) { out.push({ ...base, outcome: 'skip', reason: why }); continue }
    const mine = busy.find((b) => b.classRef === String(c._id))
    const s = w.start.getTime(), e = w.end.getTime()
    let order: string[]
    if (c.isOnline === false) order = roomOrder(c, rooms).order
    else order = mine && pods.some((p) => p.id === mine.podId) ? [mine.podId, ...pods.map((p) => p.id).filter((id) => id !== mine.podId)] : pods.map((p) => p.id)
    if (mine && mine.start === s && mine.end === e && order.includes(mine.podId)) { out.push({ ...base, outcome: 'keeps', pod: name.get(mine.podId) }); continue }
    if (mine) busy.splice(busy.indexOf(mine), 1)
    const free = order.find((podId) => !busy.some((b) => b.podId === podId && b.start < e && b.end > s))
    if (!free) { out.push({ ...base, outcome: 'no_pod', reason: c.isOnline === false && order.length === 1 ? `${name.get(order[0])} is taken then` : undefined }); continue }
    busy.push({ podId: free, start: s, end: e, classRef: String(c._id) })
    out.push({ ...base, outcome: 'gets', pod: name.get(free) })
  }
  return out
}
