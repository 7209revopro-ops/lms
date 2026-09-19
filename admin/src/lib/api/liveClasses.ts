'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPost, apiPatch } from '@/lib/axios'

export type LiveClassStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type LiveClassType   = 'external' | 'internal'

/* ── CROSS-ACADEMY COHORTS ──────────────────────────────────────────────
   One class, more than one academy. Each cohort is a DOOR: the academy whose
   students may come in, the course of THEIRS they must be enrolled in, and
   optionally the module of that course.

   The backend has emitted these on every live-class DTO since phase 2. They
   were simply not declared here, so the data arrived over the wire and
   TypeScript made it invisible to every consumer. */
export interface GuestCohort {
  organizationId:    string
  organizationSlug?: string
  courseId:          string
  sectionId?:        string
  /** Seats reserved for this academy that nobody else may take. */
  seatFloor:         number
  /** Counts DOWN as that academy books. seatFloor - seatsLeft is what it holds. */
  seatsLeft?:        number
}

/** What the form sends. No seatsLeft — that is the server's to keep. */
export interface GuestCohortInput {
  organizationId: string
  courseId:       string
  sectionId?:     string
  seatFloor:      number
}

export interface LiveClass {
  id:             string
  courseId:       string
  course?:        { id: string; title: string; slug: string; thumbnailUrl?: string }
  instructorId:   string
  instructor?:    { id: string; name: string; avatarUrl?: string }
  title:          string
  description?:   string
  scheduledStart: string
  durationMins:   number

  type:           LiveClassType
  status:         LiveClassStatus

  /* External-only */
  meetingUrl?:    string

  /* Internal-only (Mux) */
  muxPlaybackId?: string
  /* Which in-app engine backs an `internal` class. Absent on older rows,
     which are all Mux. */
  provider?:      'mux' | 'livekit'
  /* Present only when a CLT room exists — see isInteractiveRoom below. */
  cltRoomName?:   string
  /* 'embed' renders the room inside the admin panel; 'redirect' hands the
     browser to the meeting platform. Server-decided, so both apps agree. */
  joinMode?:      'embed' | 'redirect'
  playbackUrl?:   string
  thumbnailUrl?:  string
  recordingUrl?:  string
  mentorNotes?:   string
  viewerCount:    number
  startedAt?:     string
  endedAt?:       string

  /* Module link */
  sectionId?:      string | { id: string; title: string }
  sessionCapacity: number

  /* Cross-academy. Empty on every class that is not shared. */
  guestCohorts?:      GuestCohort[]
  hostSeatsLeft?:     number
  overflowSeatsLeft?: number
  /** Every academy this class serves, owner first. At least one entry. */
  servesAcademies?:   string[]
  bookedCount:     number

  language:       string

  /* Offline support */
  isOnline?:          boolean
  location?:          string
  room?:              string
  rescheduledReason?: string

  /* Weekly-repeat grouping tag — shared by every class generated from
     the same "repeat weekly" action. Absent on one-off classes. */
  seriesId?:      string

  /* WHICH ACADEMY'S WALL CLOCK THIS CLASS IS READ IN.

     The panel pins all formatting to ONE zone — the viewer's academy — which
     was indistinguishable from correct while every class a viewer could see
     was their own academy's. A LENT instructor sees both academies' classes in
     one list, so the viewer's zone is the wrong frame for the borrowed ones.

     Pass it through zoneOf() in lib/timezone, never straight into
     orgTimeZone(): an unknown or absent value must fall back to the viewer's
     zone, and orgTimeZone() falls back to Asia/Dubai instead. Never use
     organizationId here — it is an id, orgTimeZone is keyed by SLUG, and an id
     resolves silently to the Dubai default. */
  organizationId?:   string
  organizationSlug?: 'dubai' | 'bangalore'

  createdAt:      string
  updatedAt:      string
}

export interface StreamCredentials {
  rtmpUrl:    string
  streamKey:  string
  playbackId: string
}

export const liveClassKeys = {
  forCourse:   (courseId: string) => ['admin', 'live-classes', courseId] as const,
  byId:        (id: string)       => ['admin', 'live-classes', 'detail', id] as const,
  credentials: (id: string)       => ['admin', 'live-classes', id, 'credentials'] as const,
}

/* GET /admin/live-classes — all classes across all courses (global overview page) */
export function useAllLiveClasses(status: string = 'all') {
  return useQuery({
    queryKey:        ['admin', 'live-classes', 'all', status],
    /* limit is a guard-rail, not pagination — without it the server's default
       cap silently dropped the nearest-dated classes once weekly-repeat series
       pushed the collection past the cap (they looked deleted in this UI
       while students could still book them). */
    queryFn:         () => apiGet<LiveClass[]>('/admin/live-classes', { status, limit: 1000 }),
    staleTime:       10_000,
    refetchInterval: 15_000,   // refresh so live status pulses update
  })
}

/* GET /admin/live-classes/:id — single class, used by monitor page */
export function useLiveClassById(id: string | undefined) {
  return useQuery({
    queryKey: liveClassKeys.byId(id ?? ''),
    queryFn:  () => apiGet<LiveClass>(`/admin/live-classes/${id}`),
    enabled:  !!id,
    staleTime: 5_000,
    refetchInterval: 10_000,   // poll so status changes (scheduled→live→ended) are reflected
  })
}

export function useLiveClassesForCourse(courseId: string | undefined) {
  return useQuery({
    queryKey: liveClassKeys.forCourse(courseId ?? ''),
    queryFn:  () => apiGet<LiveClass[]>(`/admin/courses/${courseId}/live-classes`),
    enabled:  !!courseId,
    staleTime: 15_000,
    refetchInterval: 15_000,   // poll for status updates while on the page
  })
}

export function useStreamCredentials(id: string | undefined) {
  return useQuery({
    queryKey: liveClassKeys.credentials(id ?? ''),
    queryFn:  () => apiGet<StreamCredentials>(`/admin/live-classes/${id}/stream-credentials`),
    enabled:  false,           // only fetched when instructor clicks "Show credentials"
    staleTime: Infinity,       // credentials don't change
  })
}

export interface CreateLiveClassInput {
  courseId:         string
  title:            string
  description?:     string
  scheduledStart:   string       // ISO
  durationMins:     number
  type:             LiveClassType
  meetingUrl?:      string       // required when type=external and isOnline=true
  sectionId?:       string       // optional course module/section link
  instructorId?:    string       // optional override; defaults to current user
  sessionCapacity?: number       // max bookings
  language?:        string
  isOnline?:        boolean      // false = offline physical session
  location?:        string       // venue address (offline only)
  room?:            string       // classroom number (offline only)
  /* Super admin only — the backend answers CROSS_ACADEMY_FORBIDDEN otherwise,
     and only when the list is non-empty. */
  guestCohorts?:    GuestCohortInput[]
  /** Seats promised to nobody, which any academy may draw on once its own
      floor is gone. Only meaningful alongside guestCohorts. */
  overflowSeats?:   number
}

export interface UpdateLiveClassInput {
  /* Sending the stored set unchanged is a no-op any editor may perform;
     CHANGING it is a super admin's decision. */
  guestCohorts?:     GuestCohortInput[]
  courseId?:         string
  sectionId?:        string
  title?:            string
  description?:      string
  scheduledStart?:   string
  durationMins?:     number
  type?:             LiveClassType
  meetingUrl?:       string
  recordingUrl?:     string
  sessionCapacity?:  number
  status?:           LiveClassStatus
  mentorNotes?:      string
  instructorId?:     string
  language?:         string
  isOnline?:         boolean
  location?:         string
  room?:             string
  rescheduleReason?: string
}

/* ── Availability types ─────────────────────── */
export interface AvailabilitySlot {
  dayOfWeek: number   // 0=Sun … 6=Sat
  startTime: string   // HH:MM
  endTime:   string   // HH:MM
}

export interface MentorAvailability {
  mentorId: string
  slots:    AvailabilitySlot[]
}

/* ── Booking types (admin view) ─────────────── */
export type BookingStatus = 'booked' | 'attended' | 'missed' | 'cancelled'

export interface ClassBooking {
  id:          string
  userId:      { id: string; name: string; email: string; avatarUrl?: string }
  liveClassId: {
    id:             string
    title:          string
    scheduledStart: string
    durationMins:   number
    language?:      string
    isOnline?:      boolean
    location?:      string
    room?:          string
    courseId?:      { id: string; title: string }
    sectionId?:     { id: string; title: string }
    instructorId?:  { id: string; name: string; avatarUrl?: string }
  }
  status:      BookingStatus
  bookedAt:    string
  cancelledAt?: string
}

export function useCreateLiveClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLiveClassInput) =>
      apiPost<LiveClass>('/admin/live-classes', data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(vars.courseId) })
    },
  })
}

export function useUpdateLiveClass(courseId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLiveClassInput }) =>
      apiPatch<LiveClass>(`/admin/live-classes/${id}`, data),
    onSuccess: (_, vars) => {
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
      qc.invalidateQueries({ queryKey: liveClassKeys.byId(vars.id) })
      qc.invalidateQueries({ queryKey: ['admin', 'live-classes', 'all'] })
    },
  })
}

export function useStartLiveStream(courseId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LiveClass>(`/admin/live-classes/${id}/start`, {}),
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
    },
  })
}

export function useEndLiveStream(courseId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LiveClass>(`/admin/live-classes/${id}/end`, {}),
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
    },
  })
}

/* Start/End mutations that also invalidate the byId cache — used by monitor page */
export function useStartLiveStreamById(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<LiveClass>(`/admin/live-classes/${id}/start`, {}),
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: liveClassKeys.byId(id) })
    },
  })
}

export function useEndLiveStreamById(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<LiveClass>(`/admin/live-classes/${id}/end`, {}),
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: liveClassKeys.byId(id) })
    },
  })
}

export function useRecreateLiveStream(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<LiveClass>(`/admin/live-classes/${id}/recreate`, {}),
    onSuccess: (data) => {
      if (id) qc.invalidateQueries({ queryKey: liveClassKeys.byId(id) })
      /* Also invalidate the course-level list so credentials panel refreshes */
      const courseId = data?.courseId
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
      /* Invalidate stream credentials cache so next reveal fetches fresh key */
      if (id) qc.removeQueries({ queryKey: liveClassKeys.credentials(id) })
    },
  })
}

export function useDeleteLiveClass(courseId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/admin/live-classes/${id}`) },
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
      qc.invalidateQueries({ queryKey: ['admin', 'live-classes', 'all'] })
    },
  })
}

export function useRepeatLiveClassWeekly(courseId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, weeks }: { id: string; weeks: number }) => {
      /* The backend mints one Google Meet link per generated week (~1s each),
         so a long series overruns the instance-default 15s timeout. Aborting
         here doesn't stop the server — it kept creating while the UI showed
         an error, and re-submitting then produced duplicate series. */
      const res = await api.post<{ success: true; data: LiveClass[] }>(
        `/admin/live-classes/${id}/repeat`, { weeks }, { timeout: 120_000 })
      return res.data.data
    },
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: liveClassKeys.forCourse(courseId) })
      qc.invalidateQueries({ queryKey: ['admin', 'live-classes', 'all'] })
    },
  })
}

/* ── Mentor Availability ────────────────────────── */
const availabilityKeys = {
  forMentor: (mentorId: string) => ['admin', 'availability', mentorId] as const,
  me: () => ['admin', 'availability', 'me'] as const,
}

export function useMentorAvailability(mentorId: string | undefined) {
  return useQuery({
    queryKey: availabilityKeys.forMentor(mentorId ?? ''),
    queryFn:  () => apiGet<MentorAvailability>(`/admin/mentors/${mentorId}/availability`),
    enabled:  !!mentorId,
    staleTime: 60_000,
  })
}

export function useMyAvailability() {
  return useQuery({
    queryKey: availabilityKeys.me(),
    queryFn:  () => apiGet<MentorAvailability>('/admin/availability/me'),
    staleTime: 60_000,
  })
}

export function useUpdateMentorAvailability(mentorId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (slots: AvailabilitySlot[]) => {
      const res = await api.put<{ success: true; data: MentorAvailability }>(
        `/admin/mentors/${mentorId}/availability`, { slots },
      )
      return res.data.data
    },
    onSuccess: () => {
      if (mentorId) qc.invalidateQueries({ queryKey: availabilityKeys.forMentor(mentorId) })
    },
  })
}

export function useUpdateMyAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (slots: AvailabilitySlot[]) => {
      const res = await api.put<{ success: true; data: MentorAvailability }>(
        '/admin/availability/me', { slots },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: availabilityKeys.me() })
    },
  })
}

/* ── Admin Booking Roster ───────────────────────── */
const bookingKeys = {
  list: (p: object) => ['admin', 'bookings', p] as const,
}

export interface BookingMeta {
  page:        number
  per_page:    number
  total_count: number
  total_pages: number
}

/* Search and delivery are SERVER-side parameters. They used to be applied in
   the browser over the single page it held, so a student whose booking sat on
   page 2 came back as "No bookings found". */
export interface AdminBookingParams {
  liveClassId?:  string
  userId?:       string
  status?:       BookingStatus
  instructorId?: string
  courseId?:     string
  language?:     string
  dateFrom?:     string
  dateTo?:       string
  q?:            string
  isOnline?:     'true' | 'false'
  /* `booked` seats whose session has already run. A status AND a tense, so it
     cannot be expressed through `status` alone. */
  needsMarking?: 'true'
  /* scheduledStart lives on the class, so the server resolves those two through
     an aggregate. The console groups by session day, so it asks for them. */
  sort?:         '-bookedAt' | 'bookedAt' | 'status' | 'scheduledStart' | '-scheduledStart'
  page?:         number
  per_page?:     number
}

/* Every booking matching a filter, not just the page on screen.

   Export used to serialise the loaded array, so a filter matching 2,340 rows
   produced a 150-row file with nothing to say it had been truncated — and
   unlike a short page on screen, a short CSV leaves the building.

   Paged rather than served as one server-side CSV because the admin renders
   times in the ACTIVE ACADEMY's timezone, which only the browser knows; a CSV
   built on the server would have to duplicate that rule and would drift from
   what the table shows. `hardCap` keeps a runaway filter from exhausting
   memory, and the caller is told when it bites. */
export async function fetchAllAdminBookings(
  params: AdminBookingParams,
  opts: { onProgress?: (loaded: number, total: number) => void; hardCap?: number } = {},
): Promise<{ docs: ClassBooking[]; total: number; truncated: boolean }> {
  const PER  = 200
  const cap  = opts.hardCap ?? 20_000
  const docs: ClassBooking[] = []
  let page  = 1
  let total = 0

  for (;;) {
    const res = await api.get<{ success: true; data: ClassBooking[]; meta: BookingMeta }>(
      '/admin/bookings', { params: { ...params, page, per_page: PER } },
    )
    const batch = res.data.data ?? []
    total = res.data.meta?.total_count ?? batch.length
    docs.push(...batch)
    opts.onProgress?.(docs.length, total)

    /* Stop on a short page as well as on the page count: if the two ever
       disagree, trusting total_pages alone would spin forever. */
    if (batch.length < PER) break
    if (page >= (res.data.meta?.total_pages ?? 1)) break
    if (docs.length >= cap) return { docs, total, truncated: true }
    page++
  }
  return { docs, total, truncated: false }
}

export function useAdminBookings(params: AdminBookingParams = {}) {
  return useQuery({
    queryKey: bookingKeys.list(params),
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: ClassBooking[]; meta: BookingMeta }>(
        '/admin/bookings', { params },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

export interface AdminBookingStats {
  total: number; booked: number; attended: number; missed: number
  cancelled: number; attendanceRate: number
  /* `booked` split by the session's start time: upcoming + unmarked === booked.
     Optional because a cached response from before the split has neither. */
  upcoming?: number; unmarked?: number
}

/* Totals for the CURRENT FILTER, computed server-side.

   The stats strip used to be derived from the loaded page, so a filter matching
   2,340 bookings reported "150" — and reported "150" again on the next page. */
export function useAdminBookingStats(params: AdminBookingParams = {}) {
  /* Paging cannot change a total, so it is not part of the key — otherwise
     every page turn refetched identical numbers. */
  const { page: _p, per_page: _pp, ...filters } = params
  return useQuery({
    queryKey: ['admin', 'bookings', 'stats', filters],
    queryFn:  async () => {
      const res = await api.get<{ success: true; data: AdminBookingStats }>(
        '/admin/bookings/stats', { params: filters },
      )
      return res.data.data
    },
    staleTime: 30_000,
  })
}

export function useUpdateAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'attended' | 'missed' }) =>
      apiPatch<ClassBooking>(`/admin/bookings/${id}/attendance`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
    },
  })
}

/* Mark a whole selection in one request.

   Not a loop of useUpdateAttendance: a partial failure halfway through would
   leave the roster split between marked and unmarked with nothing to say where
   it stopped, and the cache would be invalidated once per seat. */
export function useBulkAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'attended' | 'missed' }) =>
      apiPatch<{ updated: number; skipped: number }>('/admin/bookings/bulk-attendance', { ids, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
    },
  })
}

/* Release a seat on a student's behalf. There was no admin path to do this at
   all, so a seat taken by mistake kept a session full for ever. */
export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPatch<null>(`/admin/bookings/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
    },
  })
}

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
