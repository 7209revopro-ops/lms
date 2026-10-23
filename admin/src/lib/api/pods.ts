'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

/* The HRMS meeting pods online classes are given, and who has each over a stretch (GET /admin/pods, 2026-10-18). */
export interface PodBookingRow { id: string; podId: string; pod: string; start: string; end: string; title: string; holder: string; classId: string | null; mine: boolean }
export interface PodWaiting { classId: string; title: string; start: string; mentor: string; state: 'no_room' | 'error'; mine: boolean; kind?: 'pod' | 'room'; note?: string }
/* Each mentor teaching online over the stretch, as the HRMS knows them (2026-10-19): office staff in Dubai get pods. */
export interface PodMentor {
  id: string; name: string; email: string; classes: number
  hrms: 'office' | 'wfh' | 'not_found' | 'email_differs' | 'left' | 'not_dubai' | 'unknown' | 'excluded' | 'other_academy'
  hrmsEmail: string | null; hrmsName: string | null; designation: string | null; getsPod: boolean; reason: string | null
}
export interface PodsView { configured: boolean; pods: Array<{ id: string; name: string; kind?: 'pod' | 'room' }>; bookings: PodBookingRow[]; waiting: PodWaiting[]; mentors?: PodMentor[] }

export function usePods(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'pods', from, to],
    queryFn: () => apiGet<PodsView>(`/admin/pods?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/* Which offline class rooms are free for a class's time (GET /admin/pods/rooms, 2026-10-19) — the room picker. */
export interface ClassRoomsFree { configured: boolean; rooms: Array<{ id: string; name: string; free: boolean; holder: string | null }> }

export function useClassRoomsFree(startISO: string | null, durationMins: number, classId?: string) {
  return useQuery({
    queryKey: ['admin', 'pods', 'rooms', startISO, durationMins, classId ?? ''],
    queryFn: () => apiGet<ClassRoomsFree>(`/admin/pods/rooms?start=${encodeURIComponent(startISO!)}&durationMins=${durationMins}${classId ? `&classId=${classId}` : ''}`),
    enabled: !!startISO && durationMins > 0,
    staleTime: 15_000,
  })
}
