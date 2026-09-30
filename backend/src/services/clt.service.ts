/* ─────────────────────────────────────────────────────
   CLT Connect — server-to-server client
   ─────────────────────────────────────────────────────
   The COMMANDS plane of the integration: create a room, end a meeting. Not the
   identity plane — that is the signed ticket the browser carries (see
   integrationTicket.service.ts). These two are deliberately different
   mechanisms because they answer different questions:

     tickets  — "who is this person and what may they do"   (asymmetric, public
                key published; CLT can verify but never mint)
     S2S      — "the LMS is asking for this"                (symmetric HMAC;
                both ends are servers we control, nothing is delegated)

   A shared secret is fine here precisely because no identity is being asserted:
   the worst a leaked S2S secret buys is the ability to create and end rooms,
   not to impersonate an instructor.

   SIGNING covers timestamp + nonce + body, so a captured request cannot be
   replayed later or edited in flight. CLT rejects a skew beyond a few minutes.

   FAILURE IS NON-FATAL BY DESIGN. Provisioning is best-effort at class-creation
   time: if CLT is down, the class is still created and the room is provisioned
   later, on demand, when someone actually hosts. Making room creation fatal
   would mean an outage in the meeting platform blocks the LMS timetable.
───────────────────────────────────────────────────── */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { logger } from '@/utils/logger.ts'

const BASE   = () => (process.env['CLT_BASE_URL'] ?? '').replace(/\/+$/, '')
const SECRET = () => process.env['CLT_S2S_SECRET'] ?? ''
const TIMEOUT_MS = Number(process.env['CLT_TIMEOUT_MS'] ?? 8_000)

/** Configured means "both halves present" — a base URL with no secret is a
    misconfiguration that would send unauthenticated requests. */
export function cltConfigured(): boolean {
  return Boolean(BASE() && SECRET())
}

export class CltError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message)
  }
}

/* ── Signing ───────────────────────────────────────────
   Canonical string: <timestamp>.<nonce>.<body>
   Sent as X-LMS-Timestamp / X-LMS-Nonce / X-LMS-Signature so CLT can rebuild
   it byte-for-byte without parsing the JSON first.
─────────────────────────────────────────────────────── */
export function signPayload(body: string, timestamp: string, nonce: string, secret = SECRET()): string {
  return createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex')
}

/** Constant-time compare — exported so the webhook receiver (Phase 5) reuses it. */
export function signaturesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

async function call<T>(path: string, payload: unknown): Promise<T> {
  if (!cltConfigured()) {
    throw new CltError('CLT integration is not configured (CLT_BASE_URL / CLT_S2S_SECRET)')
  }

  const body      = JSON.stringify(payload)
  const timestamp = String(Date.now())
  const nonce     = randomUUID()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE()}${path}`, {
      method:  'POST',
      headers: {
        'content-type':    'application/json',
        'X-LMS-Timestamp': timestamp,
        'X-LMS-Nonce':     nonce,
        'X-LMS-Signature': signPayload(body, timestamp, nonce),
      },
      body,
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* keep the raw text */ }

    if (!res.ok) {
      throw new CltError(`CLT ${path} responded ${res.status}`, res.status, parsed)
    }
    return parsed as T
  } catch (err) {
    if (err instanceof CltError) throw err
    const aborted = (err as Error)?.name === 'AbortError'
    throw new CltError(aborted ? `CLT ${path} timed out after ${TIMEOUT_MS}ms` : String((err as Error)?.message ?? err))
  } finally {
    clearTimeout(timer)
  }
}

/* ── Commands ──────────────────────────────────────── */

export interface EnsureRoomInput {
  liveClassId: string
  roomName:    string
  title:       string
  /** ISO-8601 WITH offset. Never a naive local time — the LMS runs Asia/Dubai
      and CLT computes in UTC, so a bare timestamp would drift by four hours. */
  scheduledStart: string
  durationMins:   number
  capacity:       number
  orgSlug?:       string
}

export interface EnsureRoomResult {
  courseId:  number
  roomName:  string
  courseCode?: string
}

/**
 * Create or return the CLT room for a live class. Idempotent by `liveClassId`:
 * calling it twice returns the same room rather than creating a second one, so
 * a retry after a timeout is always safe.
 */
export function ensureRoom(input: EnsureRoomInput): Promise<EnsureRoomResult> {
  return call<EnsureRoomResult>('/api/lms/rooms', input)
}

/** End the meeting behind a room. Idempotent — ending an ended room is not an error. */
export function endRoom(roomName: string): Promise<{ ended: boolean }> {
  return call<{ ended: boolean }>(`/api/lms/rooms/${encodeURIComponent(roomName)}/end`, {})
}

/**
 * Best-effort provisioning for the class-creation path. Never throws: a meeting
 * platform outage must not stop an instructor scheduling a class. Returns null
 * on failure, and the room is provisioned on demand at host time instead.
 */
export async function tryEnsureRoom(input: EnsureRoomInput): Promise<EnsureRoomResult | null> {
  if (!cltConfigured()) return null
  try {
    return await ensureRoom(input)
  } catch (err) {
    logger.warn(
      { err, liveClassId: input.liveClassId, roomName: input.roomName },
      'CLT room provisioning failed — the class was still created; the room will be provisioned on demand',
    )
    return null
  }
}

/**
 * The browser-facing URL for CLT's own no-login "join by code" page.
 *
 * NOT the entitlement-checked handoff this LMS otherwise uses everywhere —
 * this is CLT's generic guest door: no LMS account, no booking, no enrolment
 * check, just a name typed in and the host admitting from a lobby. It exists
 * for people who were never going to have an LMS account in the first place
 * (e.g. an admissions prospect sitting in on a class before enrolling), and
 * must never be offered as the default "share this class" link for students
 * who ARE meant to clear the LMS's own gate — see liveClass.controller.ts's
 * shareUrl for that one.
 *
 * Same PUBLIC_URL-over-BASE_URL fallback as classHandoff.controller.ts's
 * mint, deliberately not re-reading a third env var for one more purpose.
 */
export function publicJoinByCodeUrl(courseCode: string): string | undefined {
  const base = (process.env['CLT_PUBLIC_URL'] || process.env['CLT_BASE_URL'] || '').replace(/\/+$/, '')
  return base ? `${base}/join/${encodeURIComponent(courseCode)}` : undefined
}

/**
 * Ask CLT for a short-lived playback URL for one recording.
 *
 * Strict (throws) rather than best-effort: unlike room provisioning, there is
 * no sensible degraded behaviour — if the meeting platform cannot mint a link,
 * the admin needs to be told, not handed a dead player.
 */
export function requestPlaybackUrl(recordingId: number): Promise<{ url: string; expiresIn: number }> {
  return call<{ url: string; expiresIn: number }>(
    `/api/lms/recordings/${recordingId}/playback`, {},
  )
}
