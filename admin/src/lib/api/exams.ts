'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

/* ─── Types ──────────────────────────────────────── */
export type ExamQuestionType = 'mcq' | 'true_false' | 'short' | 'essay'

export interface ExamQuestion {
  id?:            string
  text:           string
  type:           ExamQuestionType
  choices:        string[]
  correctAnswer?: string
  order:          number
  maxMarks:       number
  explanation?:   string
}

export interface ExamAntiCheat {
  blockCopyPaste:    boolean
  blockRightClick:   boolean
  screenshotSuspend: boolean
  tabSwitchSuspend:  boolean
}

export interface AdminExam {
  id:              string
  courseId:        string
  title:           string
  instructions?:   string
  durationMinutes: number
  passPercent:     number
  questions:       ExamQuestion[]
  availableFrom?:  string
  availableTo?:    string
  maxViolations:   number
  antiCheat:       ExamAntiCheat
  isPublished:     boolean
  createdAt?:      string
  updatedAt?:      string
}

/* What the editor sends up. Dates are ISO strings (or null to clear). */
export interface ExamUpsertPayload {
  title:           string
  instructions?:   string
  durationMinutes: number
  passPercent:     number
  availableFrom?:  string | null
  availableTo?:    string | null
  maxViolations:   number
  antiCheat:       ExamAntiCheat
  isPublished:     boolean
  questions:       ExamQuestion[]
}

export interface ExamAttemptRow {
  attemptId: string
  student:   { id: string; name: string; email: string }
  status:    'in_progress' | 'submitted' | 'suspended'
  totalMarks: number | null
  maxMarks:   number | null
  passed:     boolean | null
  violations: number
  submittedAt: string | null
  graded:     boolean
}

export interface AttemptDetail {
  attempt: {
    id: string
    student: { id: string; name: string; email: string }
    status: 'in_progress' | 'submitted' | 'suspended'
    startedAt: string | null
    submittedAt: string | null
    suspendedReason: string | null
    violations: number
    totalMarks: number | null
    maxMarks: number | null
    passed: boolean | null
    graded: boolean
  }
  exam: { id: string; title: string; passPercent: number }
  questions: Array<{
    id: string
    text: string
    type: ExamQuestionType
    choices: string[]
    maxMarks: number
    correctAnswer: string | null
    autoGradable: boolean
    answer: string
    marksAwarded: number | null
    feedback: string | null
  }>
  logs: Array<{ event: string; detail: string | null; timestamp: string }>
}

/* ─── Query keys (admin-namespaced, per CLAUDE.md) ── */
export const examKeys = {
  all:      ['admin', 'exams'] as const,
  forCourse: (courseId: string) => ['admin', 'exams', 'course', courseId] as const,
  attempts:  (examId: string)   => ['admin', 'exams', 'attempts', examId] as const,
  attempt:   (examId: string, attemptId: string) => ['admin', 'exams', 'attempt', examId, attemptId] as const,
}

/* ─── The exam for a course (null if none) ────────── */
export function useCourseExam(courseId: string) {
  return useQuery({
    queryKey: examKeys.forCourse(courseId),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminExam | null }>(`/admin/courses/${courseId}/exam`)
      return res.data.data
    },
    enabled: !!courseId,
    retry: false,
  })
}

/* ─── Create / replace the exam ───────────────────── */
export function useSaveExam(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ExamUpsertPayload) => {
      const res = await api.put<{ success: true; data: AdminExam }>(`/admin/courses/${courseId}/exam`, payload)
      return res.data.data
    },
    onSuccess: (exam) => {
      qc.setQueryData(examKeys.forCourse(courseId), exam)
      qc.invalidateQueries({ queryKey: examKeys.forCourse(courseId) })
    },
  })
}

/* ─── Delete the exam ─────────────────────────────── */
export function useDeleteExam(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.delete(`/admin/courses/${courseId}/exam`)
    },
    onSuccess: () => {
      qc.setQueryData(examKeys.forCourse(courseId), null)
      qc.invalidateQueries({ queryKey: examKeys.forCourse(courseId) })
    },
  })
}

/* ─── Attempts on an exam ─────────────────────────── */
export function useExamAttempts(examId: string | undefined) {
  return useQuery({
    queryKey: examKeys.attempts(examId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: ExamAttemptRow[] }>(`/admin/exams/${examId}/attempts`)
      return res.data.data
    },
    enabled: !!examId,
    staleTime: 15_000,
  })
}

/* ─── One attempt in full (answers vs. key + proctoring log) ── */
export function useAttemptDetail(examId: string | undefined, attemptId: string | undefined) {
  return useQuery({
    queryKey: examKeys.attempt(examId ?? '', attemptId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AttemptDetail }>(`/admin/exams/${examId}/attempts/${attemptId}`)
      return res.data.data
    },
    enabled: !!examId && !!attemptId,
    retry: false,
  })
}

export interface GradeInput { questionId: string; marksAwarded: number; feedback?: string }

/* ─── Save per-question grades ── */
export function useGradeAttempt(examId: string, attemptId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (grades: GradeInput[]) => {
      const res = await api.post<{ success: true; data: { totalMarks: number; maxMarks: number; passed: boolean } }>(
        `/admin/exams/${examId}/attempts/${attemptId}/grade`, { grades })
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.attempt(examId, attemptId) })
      qc.invalidateQueries({ queryKey: examKeys.attempts(examId) })
    },
  })
}

/* ─── Reset an attempt (retake / lift suspension) ── */
export function useResetAttempt(examId: string, attemptId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post(`/admin/exams/${examId}/attempts/${attemptId}/reset`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.attempts(examId) })
    },
  })
}
