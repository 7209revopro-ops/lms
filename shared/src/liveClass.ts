/* ─────────────────────────────────────────────────────────────
   Live classes and bookings, as the student API answers them
   (GET /live-classes, GET /bookings/me, GET /live-classes/:id/watch).
   Mirrors client/src/lib/api/liveClasses.ts and bookings.ts — the website
   keeps its own copy until it switches to this one (plan.md §13.2 M8).
───────────────────────────────────────────────────────────── */

export type LiveClassStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type LiveClassType   = 'external' | 'internal'
export type BookingStatus   = 'booked' | 'attended' | 'missed' | 'cancelled'

export interface PersonRef { id: string; name: string; avatarUrl?: string }

export interface SectionRef { id: string; title: string; order?: number; description?: string; number?: number }

export interface LiveClass {
  id:             string
  courseId:       string
  course?:        { id: string; title: string; slug: string; thumbnailUrl?: string; program?: string; description?: string; level?: string }
  instructorId:   string
  instructor?:    PersonRef
  title:          string
  description?:   string
  scheduledStart: string
  durationMins:   number
  /** Server-owned: 15 min before an online start, 5 h before an in-person one. */
  bookingClosesAt?: string
  language?:      string
  type:           LiveClassType
  status:         LiveClassStatus
  isOnline?:      boolean
  location?:      string
  room?:          string
  /** Hybrid class: an in-person class and its online twin share it. */
  hybridPairId?:  string
  /** External only: the caller holds a booked/attended seat; the join window is server-owned. */
  isBooked?:      boolean
  joinOpensAt?:   string
  joinClosesAt?:  string
  /** Internal only. */
  provider?:      'mux' | 'livekit'
  cltRoomName?:   string
  playbackUrl?:   string
  thumbnailUrl?:  string
  recordingUrl?:  string
  viewerCount?:   number
  sectionId?:     string | SectionRef
  sessionCapacity: number
  bookedCount:     number
  /** The seats THIS caller can take on a class shared between academies. */
  seatsLeftForYou?: number
  /** The caller's own course and module, when the class reaches them through a guest door. */
  yourCohort?: {
    courseId?: string; courseTitle?: string; courseSlug?: string; program?: string
    courseDescription?: string; courseLevel?: string
    sectionId?: string; sectionTitle?: string; sectionOrder?: number; sectionNumber?: number; sectionDescription?: string
  }
  isEnrolled?:    boolean
  /** Enrolled minus any module blocked for this student — what a booking will accept. */
  isEntitled?:    boolean
}

export interface MyBooking {
  id:          string
  status:      BookingStatus
  bookedAt:    string
  cancelledAt?: string
  liveClassId: {
    id: string; title: string; scheduledStart: string; durationMins: number; status: string
    type: string; isOnline?: boolean; language?: string
    joinOpensAt?: string; joinClosesAt?: string
    location?: string; room?: string
    courseId?: { id: string; title: string; slug: string; thumbnailUrl?: string }
    sectionId?: { id: string; title: string; order?: number; number?: number }
    instructorId?: PersonRef
    yourCohort?: { courseId?: string; courseTitle?: string; sectionTitle?: string; sectionNumber?: number }
  }
}

/** GET /live-classes/:id/watch */
export interface WatchAccess {
  type:          LiveClassType
  provider?:     'mux' | 'livekit'
  cltRoomName?:  string
  joinMode?:     'embed' | 'redirect'
  title:         string
  status:        LiveClassStatus
  isBooked?:     boolean
  isOnline?:     boolean
  joinOpensAt?:  string
  joinClosesAt?: string
  playbackUrl?:  string
  recordingUrl?: string
  thumbnailUrl?: string
  viewerCount?:  number
}

/** POST /live-classes/:id/join — the Meet link, released for this tap only. */
export interface JoinClassResult { url: string; closesAt: string }

/** POST /live-classes/:id/handoff — the meeting platform's address for an interactive room. */
export interface HandoffResult { url: string; expiresIn: number; ttlSeconds: number }

/* ── Normalising the API's populated refs (`_id` → `id`) ─────────────── */

type Raw = Record<string, unknown> & { _id?: unknown; id?: unknown }
const idOf = (o: Raw | undefined | null): string => String(o?.id ?? o?._id ?? '')
const asObj = (v: unknown): Raw | undefined => (v && typeof v === 'object' ? v as Raw : undefined)

export function normalizeLiveClass(raw: unknown): LiveClass {
  const c = raw as Raw
  const course = asObj(c['courseId'])
  const tutor  = asObj(c['instructorId'])
  const sec    = asObj(c['sectionId'])
  return {
    ...(c as unknown as LiveClass),
    id:           idOf(c),
    courseId:     course ? idOf(course) : String(c['courseId'] ?? ''),
    course:       course
      ? { id: idOf(course), title: String(course['title'] ?? ''), slug: String(course['slug'] ?? ''),
          thumbnailUrl: course['thumbnailUrl'] as string | undefined, program: course['program'] as string | undefined,
          description: course['description'] as string | undefined, level: course['level'] as string | undefined }
      : (c['course'] as LiveClass['course']),
    instructorId: tutor ? idOf(tutor) : String(c['instructorId'] ?? ''),
    instructor:   tutor ? { id: idOf(tutor), name: String(tutor['name'] ?? ''), avatarUrl: tutor['avatarUrl'] as string | undefined }
                        : (c['instructor'] as PersonRef | undefined),
    sectionId:    sec
      ? { id: idOf(sec), title: String(sec['title'] ?? ''), order: sec['order'] as number | undefined,
          description: sec['description'] as string | undefined, number: sec['number'] as number | undefined }
      : (c['sectionId'] as string | undefined),
  }
}

export function normalizeBooking(raw: unknown): MyBooking {
  const b = raw as Raw
  const lc = asObj(b['liveClassId'])
  const ref = (o: unknown) => { const r = asObj(o); return r ? { ...r, id: idOf(r) } : undefined }
  return {
    ...(b as unknown as MyBooking),
    id: idOf(b),
    liveClassId: lc
      ? { ...(lc as unknown as MyBooking['liveClassId']), id: idOf(lc),
          courseId: ref(lc['courseId']) as MyBooking['liveClassId']['courseId'],
          sectionId: ref(lc['sectionId']) as MyBooking['liveClassId']['sectionId'],
          instructorId: ref(lc['instructorId']) as MyBooking['liveClassId']['instructorId'] }
      : (b['liveClassId'] as MyBooking['liveClassId']),
  }
}

/* Is this the interactive room (LiveKit via the meeting platform) rather than a
   Mux broadcast? Ported from client/src/lib/api/liveClasses.ts — two signals,
   because `provider` can go missing from a payload and `cltRoomName` exists
   only when a room was provisioned. A class switched to a backup link is
   `external` and joined through Meet. */
export function isInteractiveRoom(
  l: { provider?: string; cltRoomName?: string; type?: string } | null | undefined,
): boolean {
  if (!l) return false
  if (l.type === 'external') return false
  return l.provider === 'livekit' || !!l.cltRoomName
}
