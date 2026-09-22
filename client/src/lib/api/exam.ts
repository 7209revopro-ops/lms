'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/axios'

/* ─── Types (mirror the backend student routes) ─── */
export type ExamQuestionType = 'mcq' | 'true_false' | 'short' | 'essay'
export type ExamAttemptStatus = 'in_progress' | 'submitted' | 'suspended'

export interface ExamAntiCheat {
  blockCopyPaste:    boolean
  blockRightClick:   boolean
  screenshotSuspend: boolean
  tabSwitchSuspend:  boolean
}

export interface StudentExamQuestion {
  id:       string
  text:     string
  type:     ExamQuestionType
  choices:  string[]
  order:    number
  maxMarks: number
}

/* GET /exams/course/:courseId */
export interface CourseExam {
  exam: {
    id:              string
    title:           string
    instructions?:   string
    durationMinutes: number
    questionCount:   number
    antiCheat:       ExamAntiCheat
    maxViolations:   number
  }
  attempt: {
    status:          ExamAttemptStatus | 'not_started'
    timeRemainingMs: number | null
  }
}

/* POST /exams/:examId/start */
export interface ExamStart {
  attemptId:       string
  timeRemainingMs: number
  durationMinutes: number
  questions:       StudentExamQuestion[]
  answers:         Record<string, string>
}

/* GET /exams/:examId/status */
export interface ExamStatus {
  status:          ExamAttemptStatus
  timeRemainingMs: number
  answers:         Record<string, string>
  suspendedReason?: string
}

/* GET /exams/:examId/result */
export interface ExamResult {
  status:      ExamAttemptStatus
  graded:      boolean
  totalMarks:  number | null
  maxMarks:    number | null
  passed:      boolean | null
  passPercent: number
  questions: Array<{
    id:           string
    text:         string
    type:         ExamQuestionType
    yourAnswer:   string
    maxMarks:     number
    marksAwarded: number | null
    feedback:     string | null
    explanation?: string
  }>
}

/* ─── Query keys (client-namespaced) ─── */
export const examKeys = {
  all:        ['exam'] as const,
  forCourse:  (courseId: string) => ['exam', 'course', courseId] as const,
  result:     (examId: string) => ['exam', 'result', examId] as const,
}

/* ─── Read the exam a course exposes (null when none published) ─── */
export function useCourseExam(courseId: string | undefined) {
  return useQuery({
    queryKey: examKeys.forCourse(courseId ?? ''),
    queryFn:  () => apiGet<CourseExam | null>(`/exams/course/${courseId}`),
    enabled:  !!courseId,
    retry:    false,
    staleTime: 30_000,
  })
}

/* ─── Own result, after submission ─── */
export function useExamResult(examId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: examKeys.result(examId ?? ''),
    queryFn:  () => apiGet<ExamResult>(`/exams/${examId}/result`),
    enabled:  !!examId && enabled,
    retry:    false,
  })
}

/* ─── Imperative calls (used inside the take-exam flow) ─── */
export const startExam    = (examId: string) => apiPost<ExamStart>(`/exams/${examId}/start`)
export const getExamStatus = (examId: string) => apiGet<ExamStatus>(`/exams/${examId}/status`)
export const saveExamAnswer = (examId: string, questionId: string, answer: string) =>
  apiPost<{ saved: boolean; timeRemainingMs: number }>(`/exams/${examId}/answer`, { questionId, answer })
export const submitExam   = (examId: string) => apiPost<{ status: ExamAttemptStatus }>(`/exams/${examId}/submit`)
export const logExamEvent = (examId: string, event: string, detail?: string) =>
  apiPost<{ violations: number; suspended: boolean; timeRemainingMs: number }>(`/exams/${examId}/log`, { event, detail })
