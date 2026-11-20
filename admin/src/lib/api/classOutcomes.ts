'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* "Did the class end?" (2026-11-18, backend classOutcome.service.ts) — the signed-in mentor's classes waiting for
   an answer, 30 minutes after each starts, and the answer: still going (asked again later), or ended with a review. */

export interface PendingClass {
  id: string; title: string; course: string; module: string
  startsAt: string; endsAt: string; durationMins: number
  isOnline: boolean; location: string; booked: number
  /** Google Meet or the classroom already saw it end — only the review is asked. */
  endedAt: string | null
  pastEnd: boolean
}
export interface NextClass { id: string; title: string; startsAt: string; meetingUrl: string | null }
export type ClassOutcomeAnswer =
  | { stillRunning: true }
  | { endedAt?: string; rating: number; topics: string; issues?: string; summary?: string }

export function usePendingClassOutcomes(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'class-outcomes', 'pending'],
    queryFn: async () => (await api.get<{ data: { classes: PendingClass[]; next: NextClass | null } }>('/admin/class-outcomes/pending')).data.data,
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    /* An older server without the route: no pop-up, nothing else broken. */
    retry: false,
  })
}

export function useAnswerClassOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: ClassOutcomeAnswer & { id: string }) =>
      (await api.post<{ data: { stillRunning: boolean; askAgainAt?: string; endedAt?: string } }>(`/admin/class-outcomes/${id}`, body)).data.data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'class-outcomes', 'pending'] })
      qc.invalidateQueries({ queryKey: ['admin', 'live-classes'] })
    },
  })
}
