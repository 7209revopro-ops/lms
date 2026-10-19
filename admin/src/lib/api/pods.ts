'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/axios'

/* The HRMS meeting pods online classes are given, and who has each over a stretch (GET /admin/pods, 2026-10-18). */
export interface PodBookingRow { id: string; podId: string; pod: string; start: string; end: string; title: string; holder: string; classId: string | null; mine: boolean }
export interface PodWaiting { classId: string; title: string; start: string; mentor: string; state: 'no_room' | 'error'; mine: boolean }
export interface PodsView { configured: boolean; pods: Array<{ id: string; name: string }>; bookings: PodBookingRow[]; waiting: PodWaiting[] }

export function usePods(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'pods', from, to],
    queryFn: () => apiGet<PodsView>(`/admin/pods?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
