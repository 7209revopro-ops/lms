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
   ───────────────────────────────────────────────────── */
import crypto from 'node:crypto'
import { Types } from 'mongoose'
import { LiveClassModel, UserModel, OrganizationModel } from '@/models/schema.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { logger } from '@/utils/logger.ts'

const DEFAULT_PODS = ['Pod 4', 'Pod 6', 'Pod 7', 'Pod 8', 'Pod 9', 'Pod 10', 'Pod 11']
const DEFAULT_EXCLUDED = ['moiz@deltainstitutions.com', 'akhilcp@deltainstitutions.com']
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
    excluded: list(process.env.POD_EXCLUDED_MENTORS, DEFAULT_EXCLUDED).map((e) => e.toLowerCase()),
    leadMinutes: Math.max(0, Number(process.env.POD_LEAD_MINUTES ?? 15) || 0),
  }
}

export function podsConfigured(): boolean {
  const c = podConfig()
  return !/^(off|false|0|no)$/i.test(String(process.env.POD_SYNC ?? '')) && !!(c.baseUrl && c.clientId && c.secret && c.orgId)
}

/* ── The HRMS, signed as its integration API wants (hrms-backend utils/signing.ts) ── */

async function hrms<T>(method: 'GET' | 'PUT' | 'DELETE', path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
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
export function resetPodCache(): void { podsCache = null; dubaiOrg = null }

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
  instructorId?: Types.ObjectId | null; pod?: { state?: string; bookingId?: string; roomId?: string; for?: string; at?: Date; alertedFor?: string } | null
}
type Mentor = { _id: Types.ObjectId; name?: string; email?: string; organizationId?: Types.ObjectId | null }

/** Why a class gets no pod, or null when it gets one. */
export function whyNoPod(lc: ClassRow, mentor: Mentor | null | undefined, dubai: string, now = new Date()): string | null {
  if (lc.status === 'cancelled') return 'cancelled'
  if (lc.isOnline === false) return 'in person'
  if (lc.scheduledStart.getTime() + lc.durationMins * 60_000 <= now.getTime()) return 'over'
  if (!mentor) return 'no mentor'
  if (podConfig().excluded.includes(String(mentor.email ?? '').toLowerCase())) return 'excluded mentor'
  if (!dubai || String(mentor.organizationId ?? '') !== dubai) return 'not a Dubai mentor'
  return null
}

/** The stretch a class holds its pod for: from the lead before it starts until it ends. */
export function podWindow(lc: Pick<ClassRow, 'scheduledStart' | 'durationMins'>) {
  const start = new Date(lc.scheduledStart.getTime() - podConfig().leadMinutes * 60_000)
  const end = new Date(lc.scheduledStart.getTime() + lc.durationMins * 60_000)
  return { start, end, key: `${start.toISOString()}|${end.toISOString()}` }
}

const notifier = new NotificationService()
const when = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Every pod taken: the mentor and the Dubai academy's admins are told — once for this stretch. */
async function tellNoPod(lc: ClassRow, mentor: Mentor, key: string, dubai: string): Promise<void> {
  const claimed = await LiveClassModel.updateOne({ _id: lc._id, 'pod.alertedFor': { $ne: key } }, { $set: { 'pod.alertedFor': key } })
  if (!claimed.modifiedCount) return
  const admins = await UserModel.find({
    isActive: { $ne: false },
    $or: [{ role: 'super_admin' }, { role: 'admin', organizationId: new Types.ObjectId(dubai) }],
  }).select('_id').lean() as Array<{ _id: unknown }>
  const to = [...new Set([String(mentor._id), ...admins.map((a) => String(a._id))])]
  const title = `No pod free for "${lc.title ?? 'a class'}"`
  const body = `${mentor.name ?? 'The mentor'}'s online class on ${when(lc.scheduledStart)} (Dubai) has no meeting pod — every pod is booked then. Move it, or free a pod in the HRMS.`
  for (const u of to) {
    await notifier.create(u, { kind: 'system', title, body, link: '/pods' }).catch((err) => logger.warn({ err, classId: String(lc._id) }, '[pods] could not tell about a class with no pod'))
  }
}

/**
 * One class brought into line with the HRMS: a pod held for its stretch, moved, or let go. Never throws — what
 * went wrong is kept on the class and tried again by the sweep.
 */
export async function syncClassPod(classId: string, now = new Date(), opts: { held?: boolean } = {}): Promise<'booked' | 'no_room' | 'released' | 'none' | 'error' | 'off'> {
  if (!podsConfigured() || !Types.ObjectId.isValid(classId)) return 'off'
  const lc = await LiveClassModel.findById(classId)
    .select('title scheduledStart durationMins status isOnline instructorId pod').lean() as ClassRow | null
  if (!lc) { await releaseClassPod(classId); return 'released' }
  const mentor = lc.instructorId
    ? await UserModel.findById(lc.instructorId).select('name email organizationId').lean() as Mentor | null
    : null
  const dubai = await dubaiOrgId()
  try {
    if (whyNoPod(lc, mentor, dubai, now)) {
      // Let go of what it holds — or what the HRMS says it holds, though the class forgot.
      if (lc.pod || opts.held) {
        await hrms('DELETE', `/meetings/class-pods/${lc._id}`)
        await LiveClassModel.updateOne({ _id: lc._id }, { $unset: { pod: '' } })
        return 'released'
      }
      return 'none'
    }
    const w = podWindow(lc)
    const pods = await hrmsPods()
    if (!pods.length) throw new Error('The HRMS has none of the configured pods (HRMS_CLASS_PODS)')
    // The pod it has first, so a class that moved keeps its room when that is free.
    const order = lc.pod?.roomId && pods.some((p) => p.id === lc.pod!.roomId)
      ? [lc.pod.roomId, ...pods.map((p) => p.id).filter((id) => id !== lc.pod!.roomId)]
      : pods.map((p) => p.id)
    const r = await hrms<HoldResult>('PUT', `/meetings/class-pods/${lc._id}`, {}, {
      organizationId: podConfig().orgId, rooms: order, start: w.start.toISOString(), end: w.end.toISOString(),
      title: `Class: ${lc.title ?? 'Online class'}`.slice(0, 140),
      label: `LMS class · ${mentor!.name ?? mentor!.email ?? 'mentor'}`, organizerEmail: mentor!.email,
    })
    if (r.ok) {
      await LiveClassModel.updateOne({ _id: lc._id }, { $set: {
        pod: { state: 'booked', roomId: r.booking.roomId, roomName: r.booking.roomName, bookingId: r.booking.id, for: w.key, at: now },
      } })
      return 'booked'
    }
    await LiveClassModel.updateOne({ _id: lc._id }, { $set: {
      'pod.state': 'no_room', 'pod.for': w.key, 'pod.at': now, 'pod.note': 'Every pod is booked at this time',
    }, $unset: { 'pod.roomId': '', 'pod.roomName': '', 'pod.bookingId': '' } })
    await tellNoPod(lc, mentor!, w.key, dubai)
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
  }).select('title scheduledStart durationMins status isOnline instructorId pod').sort({ scheduledStart: 1 }).lean() as ClassRow[]
  const mentorIds = [...new Set(classes.map((c) => String(c.instructorId ?? '')).filter((id) => Types.ObjectId.isValid(id)))]
  const mentors = new Map((await UserModel.find({ _id: { $in: mentorIds } }).select('name email organizationId').lean() as Mentor[]).map((m) => [String(m._id), m]))

  // What the HRMS holds for us now — a booking cancelled there, or one held for a class gone, is put right.
  const holds = await hrms<Array<{ ref: string; bookingId: string; roomId: string; start: string; end: string }>>('GET', '/meetings/class-pods', { from: now.toISOString() })
  const heldFor = new Map(holds.map((h) => [h.ref, h]))
  const byId = new Map(classes.map((c) => [String(c._id), c]))

  let released = 0
  for (const h of holds) {
    const c = byId.get(h.ref)
    const gone = !c && !(await LiveClassModel.exists({ _id: Types.ObjectId.isValid(h.ref) ? h.ref : new Types.ObjectId() }))
    if (gone || (c && whyNoPod(c, mentors.get(String(c.instructorId ?? '')), dubai, now))) {
      if (c) await syncClassPod(String(c._id), now, { held: true }); else await releaseClassPod(h.ref)
      released++
    }
  }

  let synced = 0
  for (const c of classes) {
    if (synced >= limit) break
    const why = whyNoPod(c, mentors.get(String(c.instructorId ?? '')), dubai, now)
    if (why) {
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
  pods: Array<{ id: string; name: string }>
  bookings: Array<{ id: string; podId: string; pod: string; start: string; end: string; title: string; holder: string; classId: string | null; mine: boolean }>
  /** Online classes over the stretch with no pod: every pod taken then, or the HRMS not reached yet. */
  waiting: Array<{ classId: string; title: string; start: string; mentor: string; state: 'no_room' | 'error'; mine: boolean }>
}

/** The pods and who has them over [from, to) — every booking, staff meetings too, a class's own linked. */
export async function podsView(from: Date, to: Date, viewerId?: string): Promise<PodsView> {
  if (!podsConfigured()) return { configured: false, pods: [], bookings: [], waiting: [] }
  const pods = await hrmsPods()
  const unheld = await LiveClassModel.find({ scheduledStart: { $gte: from, $lt: to }, 'pod.state': { $in: ['no_room', 'error'] }, status: { $ne: 'cancelled' } })
    .select('title scheduledStart instructorId pod').sort({ scheduledStart: 1 }).lean() as Array<{ _id: unknown; title?: string; scheduledStart: Date; instructorId?: unknown; pod: { state: 'no_room' | 'error' } }>
  const names = new Map((await UserModel.find({ _id: { $in: unheld.map((c) => c.instructorId).filter(Boolean) } }).select('name').lean() as Array<{ _id: unknown; name?: string }>).map((u) => [String(u._id), u.name ?? '']))
  const waiting = unheld.map((c) => ({
    classId: String(c._id), title: c.title ?? 'Class', start: c.scheduledStart.toISOString(), mentor: names.get(String(c.instructorId)) ?? '',
    state: c.pod.state, mine: !!viewerId && String(c.instructorId) === viewerId,
  }))
  if (!pods.length) return { configured: true, pods: [], bookings: [], waiting }
  const rows = await hrms<HrmsBooking[]>('GET', '/meetings/pod-bookings', {
    rooms: pods.map((p) => p.id).join(','), from: from.toISOString(), to: to.toISOString(),
  })
  const refs = rows.map((r) => r.classRef).filter((r): r is string => !!r && Types.ObjectId.isValid(r))
  const mine = viewerId && refs.length
    ? new Set((await LiveClassModel.find({ _id: { $in: refs }, instructorId: viewerId }).select('_id').lean() as Array<{ _id: unknown }>).map((c) => String(c._id)))
    : new Set<string>()
  return {
    configured: true,
    pods: pods.map((p) => ({ id: p.id, name: p.name })),
    bookings: rows.map((r) => ({
      id: r.id, podId: r.roomId, pod: r.roomName, start: r.start, end: r.end, title: r.title, holder: r.holder,
      classId: r.classRef, mine: !!r.classRef && mine.has(r.classRef),
    })),
    waiting,
  }
}

/* ── The backfill's dry run (scripts/class-pods-backfill.ts) ── */

export interface PodPlanRow {
  classId: string; title: string; start: string; end: string; mentor: string
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
    .select('title scheduledStart durationMins status isOnline instructorId pod').sort({ scheduledStart: 1 }).lean() as ClassRow[]
  const mentors = new Map((await UserModel.find({ _id: { $in: classes.map((c) => c.instructorId).filter(Boolean) } }).select('name email organizationId').lean() as Mentor[]).map((m) => [String(m._id), m]))
  const pods = await hrmsPods()
  const busy: Array<{ podId: string; start: number; end: number; classRef: string | null }> = []
  // The HRMS's own answer is at most 62 days at a time.
  for (let t = from.getTime(); t < horizon.getTime(); t += 60 * 864e5) {
    const rows = await hrms<HrmsBooking[]>('GET', '/meetings/pod-bookings', {
      rooms: pods.map((p) => p.id).join(','), from: new Date(t).toISOString(), to: new Date(Math.min(t + 60 * 864e5, horizon.getTime())).toISOString(),
    })
    for (const r of rows) if (!busy.some((b) => b.podId === r.roomId && b.start === Date.parse(r.start) && b.classRef === r.classRef)) {
      busy.push({ podId: r.roomId, start: Date.parse(r.start), end: Date.parse(r.end), classRef: r.classRef })
    }
  }
  const name = new Map(pods.map((p) => [p.id, p.name]))
  const out: PodPlanRow[] = []
  for (const c of classes) {
    const m = mentors.get(String(c.instructorId ?? ''))
    const w = podWindow(c)
    const base = { classId: String(c._id), title: c.title ?? 'Class', start: w.start.toISOString(), end: w.end.toISOString(), mentor: m?.name ?? m?.email ?? '' }
    const why = whyNoPod(c, m, dubai, now)
    if (why) { out.push({ ...base, outcome: 'skip', reason: why }); continue }
    const mine = busy.find((b) => b.classRef === String(c._id))
    if (mine && mine.start === w.start.getTime() && mine.end === w.end.getTime()) { out.push({ ...base, outcome: 'keeps', pod: name.get(mine.podId) }); continue }
    if (mine) busy.splice(busy.indexOf(mine), 1)
    const s = w.start.getTime(), e = w.end.getTime()
    const order = mine ? [mine.podId, ...pods.map((p) => p.id).filter((id) => id !== mine.podId)] : pods.map((p) => p.id)
    const free = order.find((podId) => !busy.some((b) => b.podId === podId && b.start < e && b.end > s))
    if (!free) { out.push({ ...base, outcome: 'no_pod' }); continue }
    busy.push({ podId: free, start: s, end: e, classRef: String(c._id) })
    out.push({ ...base, outcome: 'gets', pod: name.get(free) })
  }
  return out
}
