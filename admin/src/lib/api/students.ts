'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPost, apiPatch } from '@/lib/axios'

/* ── Types ─────────────────────────────────────────── */

export type Program = 'forex' | 'digital_marketing' | 'ai' | 'jura' | 'cma'

export interface Viewer {
  id:        string
  name:      string
  email:     string
  avatarUrl?: string
  isActive:  boolean
  isBlocked?: boolean
  createdAt: string
  updatedAt: string
}

export interface Student {
  id:        string
  name:      string
  email:     string
  avatarUrl?: string
  program:   Program
  isActive:  boolean
  isBlocked?: boolean
  createdAt: string
  updatedAt: string
}

export interface StudentEnrollmentItem {
  id:             string
  courseId:       { id: string; title: string; thumbnailUrl?: string }
  allowedSections: string[]
  createdAt:      string
}

export interface CourseByProgram {
  id:           string
  title:        string
  thumbnailUrl?: string
  slug:         string
}

/* ── Query keys ─────────────────────────────────────── */

export const studentKeys = {
  viewers:         ['admin', 'viewers'] as const,
  students:        ['admin', 'students'] as const,
  enrollments:     (id: string) => ['admin', 'students', id, 'enrollments'] as const,
  coursesByProgram:(program: string) => ['admin', 'courses', 'by-program', program] as const,
}

/* ── Viewers ────────────────────────────────────────── */

/** GET /admin/viewers — list of pending (unapproved) viewers */
export function useViewers() {
  return useQuery({
    queryKey: studentKeys.viewers,
    queryFn:  () => apiGet<Viewer[]>('/admin/viewers'),
    staleTime: 30_000,
  })
}

/** POST /admin/viewers/:id/approve  { program } */
export function useApproveViewer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, program }: { id: string; program: Program }) =>
      apiPost<Student>(`/admin/viewers/${id}/approve`, { program }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.viewers })
      qc.invalidateQueries({ queryKey: studentKeys.students })
    },
  })
}

/* ── Students ───────────────────────────────────────── */

/** POST /admin/students/:id/revoke — revoke student status back to viewer */
export function useRevokeStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<Viewer>(`/admin/students/${id}/revoke`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.students })
      qc.invalidateQueries({ queryKey: studentKeys.viewers })
    },
  })
}

/* ── Block / Unblock ────────────────────────────────── */

/** PATCH /admin/users/:id/block */
export function useBlockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPatch<Viewer | Student>(`/admin/users/${id}/block`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.viewers })
      qc.invalidateQueries({ queryKey: studentKeys.students })
    },
  })
}

/** PATCH /admin/users/:id/unblock */
export function useUnblockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPatch<Viewer | Student>(`/admin/users/${id}/unblock`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: studentKeys.viewers })
      qc.invalidateQueries({ queryKey: studentKeys.students })
    },
  })
}

/* ── Enrollments ────────────────────────────────────── */

/** GET /admin/students/:id/enrollments */
export function useStudentEnrollments(studentId: string | undefined) {
  return useQuery({
    queryKey: studentKeys.enrollments(studentId ?? ''),
    queryFn:  () => apiGet<StudentEnrollmentItem[]>(`/admin/students/${studentId}/enrollments`),
    enabled:  !!studentId,
    staleTime: 30_000,
  })
}

/** POST /admin/students/:id/enroll  { courseId, allowedSections: string[] } */
export function useEnrollStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      studentId,
      courseId,
      allowedSections,
    }: {
      studentId:       string
      courseId:        string
      allowedSections: string[]
    }) =>
      apiPost<StudentEnrollmentItem>(`/admin/students/${studentId}/enroll`, {
        courseId,
        allowedSections,
      }),
    onSuccess: (_data, { studentId }) => {
      qc.invalidateQueries({ queryKey: studentKeys.enrollments(studentId) })
    },
  })
}

/** PUT /admin/students/:id/enrollments/:enrollmentId/sections  { allowedSections } */
export function useUpdateAllowedSections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      studentId,
      enrollmentId,
      allowedSections,
    }: {
      studentId:       string
      enrollmentId:    string
      allowedSections: string[]
    }) => {
      const res = await api.put<{ success: true; data: StudentEnrollmentItem }>(
        `/admin/students/${studentId}/enrollments/${enrollmentId}/sections`,
        { allowedSections },
      )
      return res.data.data
    },
    onSuccess: (_data, { studentId }) => {
      qc.invalidateQueries({ queryKey: studentKeys.enrollments(studentId) })
    },
  })
}

/* ── Courses by program ─────────────────────────────── */

/** GET /admin/courses/by-program/:program */
export function useCoursesByProgram(program: Program | undefined) {
  return useQuery({
    queryKey: studentKeys.coursesByProgram(program ?? ''),
    queryFn:  () => apiGet<CourseByProgram[]>(`/admin/courses/by-program/${program}`),
    enabled:  !!program,
    staleTime: 60_000,
  })
}
