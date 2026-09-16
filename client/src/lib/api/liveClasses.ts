'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

export type LiveClassStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type LiveClassType   = 'external' | 'internal'

export interface LiveClass {
  id:             string
  courseId:       string
  course?:        { id: string; title: string; slug: string; thumbnailUrl?: string; program?: string }
  instructorId:   string
  instructor?:    { id: string; name: string; avatarUrl?: string }
  title:          string
  description?:   string
  scheduledStart: string
  durationMins:   number
  /** When new bookings stop being accepted — an hour before the start.
   *  Computed by the SERVER so this screen never holds its own copy of the
   *  rule; absent only on payloads written before the field existed. */
  bookingClosesAt?: string
  language?:      string

  type:           LiveClassType
  status:         LiveClassStatus

  /* Delivery mode */
  isOnline?:      boolean
  location?:      string
  room?:          string

  /* External-only. The Meet URL itself is NEVER in a list payload — it is
     released by POST /live-classes/:id/join, on the click, inside the window
     below, to the seat holder. These three let a screen draw the button at
     the right moment for the right student. Both instants are SERVER-owned
     (start .. start + 20 min); never recompute them from scheduledStart. */
  isBooked?:      boolean     // caller holds a 'booked' or 'attended' seat
  joinOpensAt?:   string
  joinClosesAt?:  string

  /* Internal-only (Mux) */
  muxPlaybackId?: string
  playbackUrl?:   string
  thumbnailUrl?:  string
  recordingUrl?:  string
  viewerCount:    number
  startedAt?:     string
  endedAt?:       string

  /* Module link */
  sectionId?: string | { id: string; title: string }

  /* Capacity */
  sessionCapacity: number
  bookedCount:     number

  /**
   * Annotated by the backend — true when the logged-in student has an active
   * enrollment in this session's course. False = show "Purchase to join" prompt.
   */
  isEnrolled?: boolean

  createdAt:      string
  updatedAt:      string
}

export interface WatchAccess {
  type:          LiveClassType
  /* Which in-app engine backs an `internal` class. Absent on older rows,
     which are all Mux. */
  provider?:     'mux' | 'livekit'
  /* Present only when a CLT room exists — see isInteractiveRoom below. */
  cltRoomName?:  string
  /* 'embed' renders the room inside the LMS; 'redirect' hands the browser
     to the meeting platform. Server-decided, so both apps agree. */
  joinMode?:     'embed' | 'redirect'
  title:         string
  status:        LiveClassStatus
  /* External only — see the same fields on LiveClass. No meeting URL here. */
  isBooked?:     boolean
  /** External only — false means an in-person class typed external: nothing to join. */
  isOnline?:     boolean
  joinOpensAt?:  string
  joinClosesAt?: string
  playbackUrl?:  string      // internal only
  recordingUrl?: string      // internal, after stream ends
  thumbnailUrl?: string
  viewerCount:   number
}

/* ── Helpers ──────────────────────────────────────────── */
/* Is this the CLT/LiveKit interactive room, rather than a Mux broadcast?
 *
 * TWO signals on purpose. `provider` is the intended answer, but it is a field
 * that can go missing — it was once absent from a DTO entirely, and any stale
 * or partial payload drops it too. When it is absent the reader falls back to
 * 'mux', so a LiveKit class silently renders the Mux surface: an OBS stream
 * key for the instructor, a dead video player for the student.
 *
 * `cltRoomName` is only ever written when a CLT room is provisioned, so its
 * presence is proof on its own — and a genuine legacy Mux class never has one,
 * so it cannot produce a false positive. Either signal is enough.
 */
export function isInteractiveRoom(
  l: { provider?: string; cltRoomName?: string } | null | undefined,
): boolean {
  if (!l) return false
  return l.provider === 'livekit' || !!l.cltRoomName
}

export function isLive(l: LiveClass): boolean {
  return l.status === 'live'
}

export function isUpcoming(l: LiveClass): boolean {
  return l.status === 'scheduled'
}

export function isEnded(l: LiveClass): boolean {
  return l.status === 'ended'
}

export function hasRecording(l: LiveClass): boolean {
  return l.status === 'ended' && !!l.recordingUrl
}

export function fmtCountdown(startIso: string, now: number): string {
  const diff = new Date(startIso).getTime() - now
  if (diff <= 0) return 'starting now'
  const s    = Math.floor(diff / 1000)
  const days = Math.floor(s / 86400)
  if (days >= 2)  return `in ${days} days`
  if (days === 1) return 'tomorrow'
  const hrs = Math.floor(s / 3600)
  if (hrs >= 1)  return `in ${hrs}h`
  const mins = Math.floor(s / 60)
  return `in ${mins}m`
}

/* ── Query keys ──────────────────────────────────────── */
export const liveClassKeys = {
  forCourse:   (slug: string)   => ['live-classes', 'course', slug]     as const,
  /* Keyed by limit: the sidebar asks for 4 and the schedule page for 50, and
     one key for both meant each fetch overwrote the other's cache entry. */
  upcoming:    (limit: number) => ['live-classes', 'upcoming', limit]   as const,
  watch:       (id: string)     => ['live-classes', id, 'watch']        as const,
}

/* ── Hooks ───────────────────────────────────────────── */

/** Normalize lean Mongoose docs — remaps populated ObjectId fields into typed sub-objects */
function normalizeLiveClass(c: any): LiveClass {
  const courseRaw = c.courseId
  const course: LiveClass['course'] =
    typeof courseRaw === 'object' && courseRaw
      ? { id: courseRaw.id ?? String(courseRaw._id ?? ''), title: courseRaw.title ?? '', slug: courseRaw.slug ?? '', thumbnailUrl: courseRaw.thumbnailUrl, program: courseRaw.program }
      : (c.course ?? undefined)

  const instrRaw = c.instructorId
  const instructor: LiveClass['instructor'] =
    typeof instrRaw === 'object' && instrRaw
      ? { id: instrRaw.id ?? String(instrRaw._id ?? ''), name: instrRaw.name ?? '', avatarUrl: instrRaw.avatarUrl }
      : (c.instructor ?? undefined)

  const secRaw = c.sectionId
  const sectionId: LiveClass['sectionId'] =
    typeof secRaw === 'object' && secRaw
      ? { id: secRaw.id ?? String(secRaw._id ?? ''), title: secRaw.title ?? '' }
      : (secRaw ?? undefined)

  return {
    ...c,
    id:           c.id ?? String(c._id ?? ''),
    courseId:     typeof courseRaw === 'object' && courseRaw ? (courseRaw.id ?? String(courseRaw._id ?? '')) : (courseRaw ?? ''),
    course,
    instructorId: typeof instrRaw === 'object' && instrRaw ? (instrRaw.id ?? String(instrRaw._id ?? '')) : (instrRaw ?? ''),
    instructor,
    sectionId,
  }
}

/* GET /live-classes — all sessions available to the student */
export function useAllLiveClasses(status: string = 'all') {
  return useQuery({
    queryKey:        ['live-classes', 'all', status],
    queryFn:         async () => {
      const list = await apiGet<any[]>('/live-classes', status !== 'all' ? { status } : {})
      return list.map(normalizeLiveClass) as LiveClass[]
    },
    staleTime:       15_000,
    refetchInterval: 30_000,
  })
}

/* GET /courses/:slug/live-classes */
export function useLiveClassesForCourse(slug: string | undefined) {
  return useQuery({
    queryKey:        liveClassKeys.forCourse(slug ?? ''),
    queryFn:         () => apiGet<LiveClass[]>(`/courses/${slug}/live-classes`),
    enabled:         !!slug,
    staleTime:       15_000,
    refetchInterval: 30_000,
  })
}

/* GET /live-classes/upcoming — authenticated, across user's enrollments */
export function useUpcomingLiveClasses(limit = 5) {
  return useQuery({
    queryKey:        liveClassKeys.upcoming(limit),
    queryFn:         () => apiGet<LiveClass[]>('/live-classes/upcoming', { limit }),
    staleTime:       15_000,
    refetchInterval: 30_000,
  })
}

/* GET /live-classes/:id/watch — enrollment-gated playback/meeting access */
export function useWatchAccess(id: string | undefined) {
  return useQuery({
    queryKey:        liveClassKeys.watch(id ?? ''),
    queryFn:         () => apiGet<WatchAccess>(`/live-classes/${id}/watch`),
    enabled:         !!id,
    staleTime:       10_000,
    refetchInterval: 20_000,   // poll to detect status changes (live → ended)
    retry:           false,    // 403 (not enrolled) should surface immediately
  })
}
