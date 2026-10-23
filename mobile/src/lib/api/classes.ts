import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  normalizeBooking, normalizeLiveClass,
  type ApiSuccess, type LiveClass, type MyBooking, type WatchAccess,
} from '@shared'
import { apiGet, http } from '../http'

/* Classes and bookings — the same endpoints and rules as the website's
   class-bookings and my-bookings pages. Query keys are the app's own; the
   rules (who may book, when, how many seats) are always the server's. */

export const keys = {
  classes:  ['live-classes', 'all'] as const,
  upcoming: ['live-classes', 'upcoming'] as const,
  watch:    (id: string) => ['live-classes', id, 'watch'] as const,
  bookings: ['bookings', 'me'] as const,
}

/** Every session available to this student (GET /live-classes). `mine`:
 *  only classes of courses the student holds (and guest-cohort classes) —
 *  what the website's Class Schedule shows since 2026-10-21. */
export function useLiveClasses(mine = false) {
  return useQuery({
    queryKey: mine ? [...keys.classes, 'mine'] : keys.classes,
    queryFn:  async () => (await apiGet<unknown[]>('/live-classes', mine ? { mine: 1 } : undefined)).map(normalizeLiveClass),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

/** The student's bookings, newest first — up to 100 is every realistic schedule. */
export function useMyBookings() {
  return useQuery({
    queryKey: keys.bookings,
    queryFn:  async () => {
      const res = await http.get<ApiSuccess<unknown[]>>('/bookings/me', { params: { per_page: 100 } })
      return res.data.data.map(normalizeBooking)
    },
    staleTime: 15_000,
  })
}

/** liveClassId → the student's booking for it. */
export function bookingMapOf(bookings: MyBooking[] | undefined): Map<string, MyBooking> {
  const map = new Map<string, MyBooking>()
  for (const b of bookings ?? []) {
    const id = b.liveClassId?.id
    if (!id) continue
    /* An active seat outranks an old cancelled row for the same class. */
    const prev = map.get(id)
    if (!prev || prev.status === 'cancelled') map.set(id, b)
  }
  return map
}

export function useWatchAccess(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.watch(id ?? ''),
    queryFn:  () => apiGet<WatchAccess>(`/live-classes/${id}/watch`),
    enabled:  !!id && enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: false,
  })
}

function useInvalidateClasses() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['bookings'] })
    void qc.invalidateQueries({ queryKey: ['live-classes'] })
  }
}

export function useBookClass() {
  const invalidate = useInvalidateClasses()
  return useMutation({
    mutationFn: async (liveClassId: string) => (await http.post<ApiSuccess<MyBooking>>('/bookings', { liveClassId })).data.data,
    onSettled: invalidate,
  })
}

export function useCancelBooking() {
  const invalidate = useInvalidateClasses()
  return useMutation({
    mutationFn: async (bookingId: string) => { await http.delete(`/bookings/${bookingId}`) },
    onSettled: invalidate,
  })
}

export type { LiveClass, MyBooking }
