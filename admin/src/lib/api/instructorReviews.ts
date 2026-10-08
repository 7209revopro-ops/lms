'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'
import type { TetraCs } from '@/lib/api/tetraCs'

export interface InstructorLeaderboardRow {
  instructorId:   string
  name:           string
  avatarUrl?:     string
  avgRating:      number
  totalReviews:   number
  ratingCounts:   Record<1 | 2 | 3 | 4 | 5, number>
  lowRatingCount: number
}

export interface InstructorReviewRow {
  _id:       string
  rating:    number
  comment?:  string
  createdAt: string
  studentId:   { _id: string; name: string; tetraCs?: TetraCs | null } | null
  liveClassId: { _id: string; title: string; scheduledStart: string } | null
}

export const instructorReviewKeys = {
  leaderboard: ['admin', 'instructor-reviews', 'leaderboard'] as const,
  instructor:  (id: string, page: number) => ['admin', 'instructor-reviews', 'instructor', id, page] as const,
}

/* Scoped server-side by the caller's org + category scope (super_admin follows
   the org switcher, admin/sub_admin are pinned to their own) — same pattern
   as useNoShowAlerts, no client-side filtering needed. */
export function useInstructorLeaderboard() {
  return useQuery({
    queryKey: instructorReviewKeys.leaderboard,
    queryFn: async () => {
      const res = await api.get<{ success: true; data: InstructorLeaderboardRow[] }>(
        '/instructor-reviews/admin/leaderboard',
      )
      return res.data.data
    },
    retry: (failureCount, error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status && status >= 400 && status < 500) return false
      return failureCount < 1
    },
    staleTime: 30_000,
  })
}

export function useInstructorReviews(instructorId: string | null, page: number) {
  return useQuery({
    queryKey: instructorReviewKeys.instructor(instructorId ?? '', page),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: InstructorReviewRow[]; meta: PaginationMeta }>(
        `/instructor-reviews/admin/instructor/${instructorId}`, { params: { page, per_page: 10 } },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    enabled: !!instructorId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}
