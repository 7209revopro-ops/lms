'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiGet } from '@/lib/axios'

export type BookingStatus = 'booked' | 'attended' | 'missed' | 'cancelled'

export interface MyBooking {
  id:          string
  status:      BookingStatus
  bookedAt:    string
  cancelledAt?: string
  liveClassId: {
    id:             string
    title:          string
    scheduledStart: string
    durationMins:   number
    status:         string
    muxPlaybackId?: string
    type:           string
    isOnline?:      boolean
    language?:      string
    /* In-person only. */
    location?:      string
    room?:          string
    /* WHAT THIS BOOKING WAS FOR. All three are optional because a class
       may have been filed under no module, and because a booking
       outlives the rows it points at — a course deleted after the fact
       leaves the reference unpopulated rather than the booking broken. */
    courseId?:      { id: string; title: string; slug: string; thumbnailUrl?: string }
    sectionId?:     { id: string; title: string; order?: number }
    instructorId?:  { id: string; name: string; avatarUrl?: string }
    /* No meetingUrl and no join window on a booking row: the Join button on
       My Classes reads the window from the matching /live-classes row and
       fetches the link through POST /live-classes/:id/join. */
  }
}

export const bookingKeys = {
  mine:   (p: object) => ['bookings', 'me', p] as const,
  all:    ['bookings'] as const,
}

/** Normalize a raw booking doc — maps `_id → id` on the doc and its nested objects */
function normalizeBooking(b: any): MyBooking {
  const lc = b.liveClassId
  /* `_id → id` on the nested refs too. Spread rather than rebuilt field
     by field, so widening the populate again does not silently drop the
     new fields on the floor here — which is exactly what happened to the
     module's order and the course's description elsewhere. */
  const ref = (o: any) => (o && typeof o === 'object' ? { ...o, id: o.id ?? String(o._id ?? '') } : undefined)
  return {
    ...b,
    id:          b.id ?? b._id,
    liveClassId: lc
      ? { ...lc, id: lc.id ?? lc._id,
          courseId:     ref(lc.courseId),
          sectionId:    ref(lc.sectionId),
          instructorId: ref(lc.instructorId) }
      : lc,
  }
}

/* ── My bookings ─────────────────────────────────────── */
export function useMyBookings(params: {
  status?:   BookingStatus
  page?:     number
  per_page?: number
} = {}) {
  return useQuery({
    queryKey: bookingKeys.mine(params),
    queryFn:  async () => {
      const p: Record<string, any> = { ...params }
      Object.keys(p).forEach(k => (p[k] == null || p[k] === '') && delete p[k])
      const res = await api.get<{ success: true; data: any[]; meta: any }>(
        '/bookings/me', { params: p },
      )
      return { docs: res.data.data.map(normalizeBooking) as MyBooking[], meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

/* ── Book a session ──────────────────────────────────── */
export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (liveClassId: string): Promise<MyBooking> => {
      const res = await api.post<{ success: true; data: MyBooking }>('/bookings', { liveClassId })
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: bookingKeys.all })
      /* Live-class rows carry `isBooked`, which just changed. */
      qc.invalidateQueries({ queryKey: ['live-classes'] })
    },
  })
}

/* ── Cancel a booking ────────────────────────────────── */
export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bookingId: string) => {
      await api.delete(`/bookings/${bookingId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: bookingKeys.all })
      qc.invalidateQueries({ queryKey: ['live-classes'] })
    },
  })
}
