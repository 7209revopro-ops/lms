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

/* ─── Query keys (admin-namespaced, per CLAUDE.md) ── */
export const examKeys = {
  all:      ['admin', 'exams'] as const,
  forCourse: (courseId: string) => ['admin', 'exams', 'course', courseId] as const,
  attempts:  (examId: string)   => ['admin', 'exams', 'attempts', examId] as const,
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
