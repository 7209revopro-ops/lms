import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  catalogParams, coursesOf, favoriteCoursesOf, normalizeCategory, normalizePath, normalizeReview, pageMetaOf,
  type AiNotes, type ApiSuccess, type CatalogQuery, type Category, type CourseReview, type CourseSummary,
  type PageMeta, type PathDetail, type RatingHistogram,
} from '@shared'
import { apiGet, apiPost, http } from '../http'
import { learningKeys } from './learning'

/* The website's catalogue — courses, categories, course pages (reviews,
   rating, recommendations, AI study notes), free enrolment, favourites and
   learning paths. Browse only: paid courses never show a price or a buy
   button in the app (plan.md M6; the website hides prices today too). */

export const catalogKeys = {
  courses:    (q: CatalogQuery) => ['catalog', 'courses', q] as const,
  categories: ['catalog', 'categories'] as const,
  reviews:    (courseId: string) => ['catalog', 'reviews', courseId] as const,
  histogram:  (slug: string) => ['catalog', 'histogram', slug] as const,
  recommend:  (slug: string) => ['catalog', 'recommend', slug] as const,
  aiNotes:    (slug: string) => ['catalog', 'ai-notes', slug] as const,
  favorites:  ['catalog', 'favorites'] as const,
  favorite:   (courseId: string) => ['catalog', 'favorite', courseId] as const,
  paths:      ['catalog', 'paths'] as const,
  path:       (slug: string) => ['catalog', 'path', slug] as const,
}

/** Paged catalogue — infinite scroll, 12 a page (the website's size). */
export function useCatalog(q: CatalogQuery) {
  return useInfiniteQuery({
    queryKey: catalogKeys.courses(q),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await http.get<ApiSuccess<unknown[]> & { meta?: unknown }>('/courses', { params: catalogParams({ ...q, page: pageParam }) })
      return { courses: coursesOf(res.data.data), meta: pageMetaOf(res.data.meta) }
    },
    getNextPageParam: (last: { meta: PageMeta }) => (last.meta.hasNext ? last.meta.page + 1 : undefined),
    staleTime: 60_000,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn:  async () => (await apiGet<unknown[]>('/categories')).map(normalizeCategory) as Category[],
    staleTime: 10 * 60_000,
  })
}

/* ── Course page extras ──────────────────────────────────── */

export function useCourseReviews(courseId: string | undefined) {
  return useInfiniteQuery({
    queryKey: catalogKeys.reviews(courseId ?? ''),
    enabled: !!courseId,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await http.get<ApiSuccess<unknown[]> & { meta?: unknown }>(`/courses/${courseId}/reviews`, { params: { page: pageParam, per_page: 5 } })
      return { reviews: (res.data.data ?? []).map(normalizeReview) as CourseReview[], meta: pageMetaOf(res.data.meta) }
    },
    getNextPageParam: (last: { meta: PageMeta }) => (last.meta.hasNext ? last.meta.page + 1 : undefined),
    staleTime: 60_000,
  })
}

export function useRatingHistogram(slug: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.histogram(slug ?? ''),
    queryFn:  () => apiGet<RatingHistogram>(`/courses/${encodeURIComponent(slug!)}/rating-histogram`),
    enabled:  !!slug,
    staleTime: 5 * 60_000,
  })
}

export function useRecommendations(slug: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.recommend(slug ?? ''),
    queryFn:  async () => coursesOf(await apiGet<unknown[]>(`/courses/${encodeURIComponent(slug!)}/recommendations`)),
    enabled:  !!slug,
    staleTime: 10 * 60_000,
  })
}

/** AI study notes for a course — generated on demand, rate-limited server-side. */
export function useAiNotes(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: catalogKeys.aiNotes(slug ?? ''),
    queryFn:  () => apiGet<AiNotes>(`/courses/${encodeURIComponent(slug!)}/ai-notes`),
    enabled:  !!slug && enabled,
    staleTime: 60 * 60_000,
    retry: false,
  })
}

/** Write or update the student's own review (one per course). */
export function useWriteReview(courseId: string, slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { rating: number; comment?: string }) => apiPost(`/courses/${courseId}/reviews`, b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: catalogKeys.reviews(courseId) })
      void qc.invalidateQueries({ queryKey: catalogKeys.histogram(slug) })
      void qc.invalidateQueries({ queryKey: learningKeys.course(slug) })
    },
  })
}

/** Toggles — the answer says whether the vote was just removed. */
export const toggleHelpful = (reviewId: string) => apiPost<{ alreadyVoted: boolean }>(`/reviews/${reviewId}/helpful`)
export const reportReview = (reviewId: string) => apiPost<{ alreadyVoted: boolean }>(`/reviews/${reviewId}/report`)

/** Free courses only — a paid one answers 402 and is never offered. */
export function useEnrollFree(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => apiPost('/enrollments', { courseId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: learningKeys.progress(slug) })
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments })
      void qc.invalidateQueries({ queryKey: learningKeys.course(slug) })
    },
  })
}

/* ── Favourites ──────────────────────────────────────────── */

export function useFavorites() {
  return useQuery({
    queryKey: catalogKeys.favorites,
    queryFn:  async () => favoriteCoursesOf(await apiGet<unknown[]>('/favorites/me', { per_page: 50 })),
    staleTime: 30_000,
  })
}

export function useIsFavorite(courseId: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.favorite(courseId ?? ''),
    queryFn:  async () => (await apiGet<{ favorited: boolean }>(`/favorites/exists/${courseId}`)).favorited,
    enabled:  !!courseId,
    staleTime: 60_000,
  })
}

/** Optimistic: the heart fills at once and rolls back if the server refuses. */
export function useToggleFavorite(course: CourseSummary) {
  const qc = useQueryClient()
  const key = catalogKeys.favorite(course.id)
  return useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await apiPost('/favorites', { courseId: course.id })
      else await http.delete(`/favorites/${course.id}`)
    },
    onMutate: async (on: boolean) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<boolean>(key)
      qc.setQueryData(key, on)
      return { before }
    },
    onError: (_e, _on, ctx) => qc.setQueryData(key, ctx?.before),
    onSettled: () => void qc.invalidateQueries({ queryKey: catalogKeys.favorites }),
  })
}

/* ── Learning paths ──────────────────────────────────────── */

export function useLearningPaths() {
  return useQuery({
    queryKey: catalogKeys.paths,
    queryFn:  async () => {
      const d = await apiGet<{ paths?: unknown[] }>('/learning-paths', { per_page: 50 })
      return (d.paths ?? []).map(normalizePath) as PathDetail[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useLearningPath(slug: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.path(slug ?? ''),
    queryFn:  async () => normalizePath((await apiGet<{ path: unknown }>(`/learning-paths/${encodeURIComponent(slug!)}`)).path),
    enabled:  !!slug,
    staleTime: 5 * 60_000,
  })
}
