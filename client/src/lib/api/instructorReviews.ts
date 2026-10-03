'use client'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export interface PendingReview {
  liveClassId:    string
  title:          string
  scheduledStart: string
  instructorId:   string
  instructorName: string
  courseId:       string
  courseTitle:    string
}

export const instructorReviewKeys = {
  pending: ['instructor-reviews', 'pending'] as const,
}

/* ── Student: classes attended but not yet rated ───────── */
export function usePendingReviews() {
  return useQuery({
    queryKey: instructorReviewKeys.pending,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: PendingReview[] }>('/instructor-reviews/pending')
      return res.data.data
    },
    staleTime: 30_000,
  })
}

/* ── Student: submit a rating ──────────────────────────────
   Deliberately does NOT invalidate the pending-list query on success. The
   card shows its own "Thanks!" state locally right after the mutation
   resolves — invalidating here would refetch immediately, drop the
   now-reviewed item from the list, and yank the card away before that
   message ever has a chance to render. The list catches up naturally the
   next time the page is visited (staleTime on usePendingReviews). */
export function useSubmitInstructorReview() {
  return useMutation({
    mutationFn: async (input: { liveClassId: string; rating: number; comment?: string }) => {
      const res = await api.post('/instructor-reviews', input)
      return res.data.data
    },
  })
}
