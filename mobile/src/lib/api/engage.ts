import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiHistory, normalizeActivity, normalizeAnnouncement, normalizeBookmark, normalizeComment, normalizeFeedback,
  normalizeHomework, normalizeThread,
  type Achievements, type AiTurn, type ExamInfo, type ExamResult, type ExamStart, type PendingRating, type Streak,
} from '@shared'
import { apiGet, apiPost, http } from '../http'

/* Everything around the lessons the website has and the app lacked:
   achievements, streaks, recent activity, announcements, rating classes and
   sessions, live-class homework, video bookmarks, lesson Q&A, transcripts,
   the AI tutor, exams and certificates. */

export const engageKeys = {
  achievements: ['engage', 'achievements'] as const,
  streak:       ['engage', 'streak'] as const,
  activity:     ['engage', 'activity'] as const,
  announcements: ['engage', 'announcements'] as const,
  pendingRatings: ['engage', 'pending-ratings'] as const,
  feedback:     ['engage', 'feedback'] as const,
  homework:     (classId: string) => ['engage', 'homework', classId] as const,
  bookmarks:    (lessonId: string) => ['engage', 'bookmarks', lessonId] as const,
  threads:      (lessonId: string) => ['engage', 'threads', lessonId] as const,
  comments:     (threadId: string) => ['engage', 'comments', threadId] as const,
  transcript:   (lessonId: string) => ['engage', 'transcript', lessonId] as const,
  exam:         (courseId: string) => ['engage', 'exam', courseId] as const,
  examResult:   (examId: string) => ['engage', 'exam-result', examId] as const,
}

/* ── Progress & motivation ───────────────────────────────── */

export const useAchievements = () => useQuery({
  queryKey: engageKeys.achievements,
  queryFn:  () => apiGet<Achievements>('/achievements/me'),
  staleTime: 60_000,
})

export const useStreak = () => useQuery({
  queryKey: engageKeys.streak,
  queryFn:  () => apiGet<Streak>('/streaks/me'),
  staleTime: 60_000,
})

export function useSetWeeklyGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (weeklyGoal: number) => http.patch('/streaks/me/goal', { weeklyGoal }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: engageKeys.streak }),
  })
}

export const useActivity = (limit = 8) => useQuery({
  queryKey: [...engageKeys.activity, limit],
  queryFn:  async () => normalizeActivity(await apiGet<unknown>('/enrollments/activity', { limit })),
  staleTime: 60_000,
})

/** Active announcements for the student's academy (the server filters by date and academy). */
export const useAnnouncements = () => useQuery({
  queryKey: engageKeys.announcements,
  queryFn:  async () => (await apiGet<unknown[]>('/announcements/active')).map(normalizeAnnouncement),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
})

/* ── Rating classes ──────────────────────────────────────── */

/** Attended classes not yet rated — the website's "Rate classes" page. */
export const usePendingRatings = () => useQuery({
  queryKey: engageKeys.pendingRatings,
  queryFn:  () => apiGet<PendingRating[]>('/instructor-reviews/pending'),
  staleTime: 60_000,
})

export function useRateInstructor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { liveClassId: string; rating: number; comment?: string }) => apiPost('/instructor-reviews', b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: engageKeys.pendingRatings }),
  })
}

/** The student's session feedback (stars + comment) for ended classes they attended. */
export const useMyFeedback = () => useQuery({
  queryKey: engageKeys.feedback,
  queryFn:  async () => (await apiGet<unknown[]>('/feedback/me')).map(normalizeFeedback),
  staleTime: 60_000,
})

export function useSendFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { liveClassId: string; rating: number; comment?: string }) => apiPost('/feedback', b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: engageKeys.feedback }),
  })
}

/* ── Live-class homework ─────────────────────────────────── */

export const useHomework = (classId: string | undefined, enabled = true) => useQuery({
  queryKey: engageKeys.homework(classId ?? ''),
  queryFn:  async () => (await apiGet<unknown[]>(`/live-classes/${classId}/homework`)).map(normalizeHomework),
  enabled:  !!classId && enabled,
  staleTime: 60_000,
  retry: false,
})

export const submitHomework = (homeworkId: string, b: { submissionText?: string; submissionUrl?: string }) =>
  apiPost(`/live-classes/homework/${homeworkId}/submit`, b)

/* ── Lesson extras ───────────────────────────────────────── */

export const useBookmarks = (lessonId: string | undefined, enabled = true) => useQuery({
  queryKey: engageKeys.bookmarks(lessonId ?? ''),
  queryFn:  async () => ((await apiGet<{ bookmarks: unknown[] }>(`/lessons/${lessonId}/bookmarks`)).bookmarks ?? []).map(normalizeBookmark),
  enabled:  !!lessonId && enabled,
  staleTime: 60_000,
})

export function useBookmarkMutations(lessonId: string) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: engageKeys.bookmarks(lessonId) })
  return {
    add:    useMutation({ mutationFn: (b: { timeSecs: number; label?: string }) => apiPost(`/lessons/${lessonId}/bookmarks`, { timeSecs: Math.floor(b.timeSecs), label: b.label?.trim() || undefined }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => http.delete(`/bookmarks/${id}`), onSuccess: done }),
  }
}

export const useThreads = (lessonId: string | undefined, enabled = true) => useQuery({
  queryKey: engageKeys.threads(lessonId ?? ''),
  queryFn:  async () => ((await apiGet<{ threads: unknown[] }>(`/lessons/${lessonId}/threads`, { per_page: 50 })).threads ?? []).map(normalizeThread),
  enabled:  !!lessonId && enabled,
  staleTime: 30_000,
})

export const useComments = (threadId: string | undefined) => useQuery({
  queryKey: engageKeys.comments(threadId ?? ''),
  queryFn:  async () => ((await apiGet<{ comments: unknown[] }>(`/threads/${threadId}/comments`)).comments ?? []).map(normalizeComment),
  enabled:  !!threadId,
  staleTime: 15_000,
})

export function useQaMutations(lessonId: string) {
  const qc = useQueryClient()
  const threads = () => void qc.invalidateQueries({ queryKey: engageKeys.threads(lessonId) })
  return {
    ask:     useMutation({ mutationFn: (b: { title?: string; body: string }) => apiPost(`/lessons/${lessonId}/threads`, b), onSuccess: threads }),
    upvote:  useMutation({ mutationFn: (threadId: string) => apiPost(`/threads/${threadId}/upvote`), onSuccess: threads }),
    resolve: useMutation({ mutationFn: (b: { threadId: string; isResolved: boolean }) => http.patch(`/threads/${b.threadId}/resolve`, { isResolved: b.isResolved }), onSuccess: threads }),
    remove:  useMutation({ mutationFn: (threadId: string) => http.delete(`/threads/${threadId}`), onSuccess: threads }),
    reply:   useMutation({
      mutationFn: (b: { threadId: string; body: string }) => apiPost(`/threads/${b.threadId}/comments`, { body: b.body }),
      onSuccess: (_d, b) => { threads(); void qc.invalidateQueries({ queryKey: engageKeys.comments(b.threadId) }) },
    }),
    upvoteComment: useMutation({
      mutationFn: (b: { threadId: string; commentId: string }) => apiPost(`/comments/${b.commentId}/upvote`),
      onSuccess: (_d, b) => void qc.invalidateQueries({ queryKey: engageKeys.comments(b.threadId) }),
    }),
  }
}

export const useTranscript = (lessonId: string | undefined, enabled = true) => useQuery({
  queryKey: engageKeys.transcript(lessonId ?? ''),
  queryFn:  async () => (await apiGet<{ transcript: string | null }>(`/lessons/${lessonId}/transcript`)).transcript,
  enabled:  !!lessonId && enabled,
  staleTime: 10 * 60_000,
  retry: false,
})

/* ── AI tutor ────────────────────────────────────────────── */

/** One answer per message (no streaming). 100 a day per student. */
export async function askTutor(message: string, history: AiTurn[], ctx: { courseSlug?: string; lessonId?: string }): Promise<string> {
  const res = await http.post<{ data: { reply: string } }>('/ai/chat', {
    message: message.trim().slice(0, 4000), history: aiHistory(history),
    courseSlug: ctx.courseSlug || undefined, lessonId: ctx.lessonId || undefined,
  }, { timeout: 40_000 })
  return res.data.data.reply
}

/* ── Exams ───────────────────────────────────────────────── */

export const useExamInfo = (courseId: string | undefined, enabled = true) => useQuery({
  queryKey: engageKeys.exam(courseId ?? ''),
  queryFn:  () => apiGet<ExamInfo | null>(`/exams/course/${courseId}`),
  enabled:  !!courseId && enabled,
  staleTime: 30_000,
  retry: false,
})

export const exam = {
  start:  (id: string) => apiPost<ExamStart>(`/exams/${id}/start`),
  answer: (id: string, questionId: string, answer: string) => apiPost<{ saved: boolean; timeRemainingMs: number }>(`/exams/${id}/answer`, { questionId, answer: answer.slice(0, 20000) }),
  status: (id: string) => apiGet<{ status: string; timeRemainingMs: number | null; answers: Record<string, string>; suspendedReason?: string }>(`/exams/${id}/status`),
  submit: (id: string) => apiPost<{ status: string }>(`/exams/${id}/submit`),
  log:    (id: string, event: string, detail?: string) => apiPost<{ violations: number; suspended: boolean; timeRemainingMs: number }>(`/exams/${id}/log`, { event, detail }),
}

export const useExamResult = (examId: string | undefined, enabled: boolean) => useQuery({
  queryKey: engageKeys.examResult(examId ?? ''),
  queryFn:  () => apiGet<ExamResult>(`/exams/${examId}/result`),
  enabled:  !!examId && enabled,
  staleTime: 30_000,
  retry: false,
})

/** The certificate PDF's API path (fetched with the student's token). */
export const certificatePath = (enrollmentId: string) => `/certificates/${enrollmentId}`
