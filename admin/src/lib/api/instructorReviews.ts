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

/** The page's shared filters (2026-11-10): Dubai days, `to` included; a programme. Empty = none. */
export interface ReviewRange { from?: string; to?: string; program?: string }
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))

export const instructorReviewKeys = {
  leaderboard: (range: ReviewRange = {}) => ['admin', 'instructor-reviews', 'leaderboard', range] as const,
  instructor:  (id: string, page: number, range: ReviewRange = {}) => ['admin', 'instructor-reviews', 'instructor', id, page, range] as const,
  feed:        (filters: object) => ['admin', 'instructor-reviews', 'feed', filters] as const,
}

/* Scoped server-side by the caller's org + category scope (super_admin follows
   the org switcher, admin/sub_admin are pinned to their own) — same pattern
   as useNoShowAlerts, no client-side filtering needed. */
export function useInstructorLeaderboard(range: ReviewRange = {}) {
  return useQuery({
    queryKey: instructorReviewKeys.leaderboard(range),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: InstructorLeaderboardRow[] }>(
        '/instructor-reviews/admin/leaderboard', { params: clean({ ...range }) },
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

export function useInstructorReviews(instructorId: string | null, page: number, range: ReviewRange = {}) {
  return useQuery({
    queryKey: instructorReviewKeys.instructor(instructorId ?? '', page, range),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: InstructorReviewRow[]; meta: PaginationMeta }>(
        `/instructor-reviews/admin/instructor/${instructorId}`, { params: { page, per_page: 10, ...clean({ from: range.from, to: range.to }) } },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    enabled: !!instructorId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/* All reviews (2026-11-10, backend services/reviewFeed.service.ts): every mentor's — mentor ratings and class feedback —
   newest first, filtered and paged, with the totals of what matches. An instructor their academy's too. */
export interface FeedReview {
  id: string; kind: 'mentor_rating' | 'class_feedback'; rating: number; comment: string; classComment?: string; createdAt: string
  student: { id: string; name: string } | null
  class: { id: string; title: string; scheduledStart: string | null } | null
  instructor: { id: string; name: string; email: string } | null
  program: string
}
export interface ReviewFeedData {
  reviews: FeedReview[]; total: number; page: number; perPage: number
  stats: { count: number; average: number | null; counts: Record<'1' | '2' | '3' | '4' | '5', number>; withComment: number; low: number }
}
export interface ReviewFeedFilters extends ReviewRange {
  instructor?: string; rating?: string; kind?: string; withComment?: boolean; q?: string
}
export const fetchReviewFeed = async (filters: ReviewFeedFilters, page: number, perPage = 25) =>
  (await api.get<{ success: true; data: ReviewFeedData }>('/instructor-reviews/admin/feed', { params: { ...clean({ ...filters }), page, per_page: perPage } })).data.data
export function useReviewFeed(filters: ReviewFeedFilters, page: number) {
  return useQuery({
    queryKey: [...instructorReviewKeys.feed(filters), page],
    queryFn: () => fetchReviewFeed(filters, page),
    retry: false, staleTime: 30_000, placeholderData: (prev) => prev,
  })
}
