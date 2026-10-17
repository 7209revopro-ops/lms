import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  normalizeCourseDetail, normalizeEnrollment,
  type CourseProgress, type LessonNote, type LessonProgress, type PlayUrl,
  type QuizResult, type QuizSummary, type StudentQuiz,
} from '@shared'
import { apiGet, apiPost, http } from '../http'

/* Courses, lessons, progress, notes and quizzes — the website's endpoints
   (my-learning, learn/[slug]/[lessonId]). Query keys are the app's own; the
   server decides every access question. */

export const learningKeys = {
  enrollments: ['learning', 'enrollments'] as const,
  course:      (slug: string) => ['learning', 'course', slug] as const,
  progress:    (slug: string) => ['learning', 'progress', slug] as const,
  lesson:      (id: string) => ['learning', 'lesson', id] as const,
  playUrl:     (id: string) => ['learning', 'lesson', id, 'play-url'] as const,
  note:        (id: string) => ['learning', 'lesson', id, 'note'] as const,
  quiz:        (id: string) => ['learning', 'quiz', id] as const,
  quizSummary: (id: string) => ['learning', 'quiz', id, 'summary'] as const,
}

export function useMyEnrollments() {
  return useQuery({
    queryKey: learningKeys.enrollments,
    queryFn:  async () => (await apiGet<unknown[]>('/enrollments/me')).map(normalizeEnrollment),
    staleTime: 10_000,
  })
}

export function useCourse(slug: string | undefined) {
  return useQuery({
    queryKey: learningKeys.course(slug ?? ''),
    queryFn:  async () => normalizeCourseDetail(await apiGet<unknown>(`/courses/${encodeURIComponent(slug!)}`)),
    enabled:  !!slug,
    staleTime: 60_000,
  })
}

export function useCourseProgress(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: learningKeys.progress(slug ?? ''),
    queryFn:  () => apiGet<CourseProgress>(`/courses/${encodeURIComponent(slug!)}/progress`),
    enabled:  !!slug && enabled,
    staleTime: 10_000,
  })
}

/** A short-lived signed address for a lesson's video, fetched just before
 *  playback (it is never part of the course outline). */
export function useLessonPlayUrl(lessonId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: learningKeys.playUrl(lessonId ?? ''),
    queryFn:  () => apiGet<PlayUrl>(`/lessons/${lessonId}/play-url`),
    enabled:  !!lessonId && enabled,
    /* Re-ask well inside the server's validity window. */
    staleTime: 30 * 60 * 1000,
    retry: false,
  })
}

export function useLessonProgress(lessonId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: learningKeys.lesson(lessonId ?? ''),
    queryFn:  () => apiGet<LessonProgress>(`/lessons/${lessonId}/progress`),
    enabled:  !!lessonId && enabled,
    staleTime: 0,
  })
}

export function useMarkComplete(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lessonId: string) => apiPost<{ progressPercent: number; status: 'active' | 'completed' }>(`/lessons/${lessonId}/complete`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: learningKeys.progress(slug) })
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments })
    },
  })
}

/** Fire-and-forget: a lost report must never interrupt the video. */
export function reportWatchTime(lessonId: string, secs: number): void {
  if (secs > 0) void apiPost(`/lessons/${lessonId}/watch-time`, { secs }).catch(() => {})
}

/* ── Notes (one private note per lesson) ── */

export function useMyNote(lessonId: string | undefined) {
  return useQuery({
    queryKey: learningKeys.note(lessonId ?? ''),
    queryFn:  async () => (await apiGet<{ note: LessonNote | null }>(`/lessons/${lessonId}/my-note`)).note,
    enabled:  !!lessonId,
    staleTime: 60_000,
  })
}

export function useSaveNote(lessonId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      if (body.trim()) await http.put(`/lessons/${lessonId}/my-note`, { body })
      else await http.delete(`/lessons/${lessonId}/my-note`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: learningKeys.note(lessonId) }),
  })
}

/* ── Quizzes ── */

export function useQuiz(lessonId: string) {
  return useQuery({
    queryKey: learningKeys.quiz(lessonId),
    queryFn:  () => apiGet<StudentQuiz>(`/quizzes/lessons/${lessonId}`),
    staleTime: 5 * 60_000,
  })
}

export function useQuizSummary(lessonId: string) {
  return useQuery({
    queryKey: learningKeys.quizSummary(lessonId),
    queryFn:  () => apiGet<QuizSummary>(`/quizzes/lessons/${lessonId}/summary`),
  })
}

export function useSubmitQuiz(lessonId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (answers: { questionId: string; answer: string }[]) =>
      apiPost<QuizResult>(`/quizzes/lessons/${lessonId}/submit`, { answers }),
    onSuccess: () => qc.invalidateQueries({ queryKey: learningKeys.quizSummary(lessonId) }),
  })
}
