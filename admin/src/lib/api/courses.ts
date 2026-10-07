'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { Course, CourseFormValues, PaginationMeta } from '@/types/index'
import type { SalesCrm } from '@/lib/api/users'
import type { TetraCs } from '@/lib/api/tetraCs'

/* Strip null / undefined / empty-string / explicit `false` so the backend
   Zod query schema doesn't reject e.g. `level=` when the user picks "All". */
function clean(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (typeof v === 'boolean' && !v) continue
    out[k] = v
  }
  return out
}

/* ─── Query keys ─────────────────────────────────── */
export const courseKeys = {
  all:    ['admin', 'courses'] as const,
  list:   (p: object) => ['admin', 'courses', 'list', p] as const,
  detail: (id: string) => ['admin', 'courses', 'detail', id] as const,
  students: (id: string, p: object) => ['admin', 'courses', 'students', id, p] as const,
}

/* ─── List ───────────────────────────────────────── */
export function useCourses(params: {
  page?: number; per_page?: number; search?: string; status?: string; sort?: string; program?: string
} = {}) {
  return useQuery({
    queryKey: courseKeys.list(params),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Course[]; meta: PaginationMeta }>(
        '/admin/courses',
        { params: clean(params as Record<string, unknown>) },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

/* ─── Single ─────────────────────────────────────── */
export function useCourse(id: string) {
  return useQuery({
    queryKey: courseKeys.detail(id),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: Course }>(`/admin/courses/${id}`)
      return res.data.data
    },
    enabled: !!id,
    retry: false,
  })
}

/* Map the form's "level: ''" to "level: undefined" so the optional enum
   on the backend accepts it. */
function normalizeFormData(data: Partial<CourseFormValues>) {
  const { level, categoryId, program, tags, ...rest } = data
  return {
    ...rest,
    ...(level    !== undefined && level    !== '' ? { level }    : {}),
    ...(categoryId !== undefined && categoryId !== '' ? { categoryId } : {}),
    ...(program  !== undefined && program  !== '' ? { program }  : {}),
    ...(tags !== undefined ? { tags } : {}),
  }
}

/* ─── Create ─────────────────────────────────────── */
export function useCreateCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CourseFormValues): Promise<Course> => {
      const res = await api.post<{ success: true; data: Course }>(
        '/admin/courses',
        normalizeFormData(data),
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: courseKeys.all })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}

/* ─── Update ─────────────────────────────────────── */
export function useUpdateCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CourseFormValues> }): Promise<Course> => {
      const res = await api.patch<{ success: true; data: Course }>(
        `/admin/courses/${id}`,
        normalizeFormData(data),
      )
      return res.data.data
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: courseKeys.all })
      qc.invalidateQueries({ queryKey: courseKeys.detail(id) })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}

/* ─── Delete ─────────────────────────────────────── */
export function useDeleteCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/courses/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: courseKeys.all })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}

/* ─── 8.12 Bulk action ───────────────────────────── */
export function useBulkCourses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'publish' | 'archive' | 'delete' }) => {
      const res = await api.post<{ success: true; data: { affected: number } }>(
        '/admin/courses/bulk', { ids, action },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: courseKeys.all })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}

/* ─── Students on a course ───────────────────────────────────────────────
   The reverse of a student's enrolment list, which was the only direction the
   API offered. `source` says how each one got in — purchase, free, admin,
   script — and is read from the enrolment rather than re-derived, so it
   cannot disagree with what was recorded at the time.
──────────────────────────────────────────────────────────────────────── */
export type EnrollmentSource = 'purchase' | 'free' | 'admin' | 'script' | 'unknown'

export interface CourseStudentRow {
  _id:             string
  source:          EnrollmentSource
  /** Which sales CRM sold it, where finance enrolled them. */
  salesCrm?:       SalesCrm
  status:          'active' | 'completed' | 'dropped'
  progressPercent: number
  enrolledAt:      string
  student: {
    id: string; name: string; email: string; phone?: string; avatarUrl?: string
    enrollmentStatus?: string; isActive?: boolean
    /** Their CS and CS team in Tetra Commission, where it has said. */
    tetraCs?: TetraCs | null
  }
}

export interface CourseStudentsPayload {
  courseTitle: string
  rows:        CourseStudentRow[]
  bySource:    Partial<Record<EnrollmentSource, number>>
  /** Enrolments whose user account no longer exists — they cannot be listed,
      but they are why this list can be shorter than the course's count. */
  orphaned:    number
}

export function useCourseStudents(
  courseId: string,
  params: { page?: number; per_page?: number; search?: string; source?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: courseKeys.students(courseId, params),
    enabled:  enabled && !!courseId,
    queryFn: async () => {
      const res = await api.get<{ data: CourseStudentsPayload; meta: PaginationMeta }>(
        `/admin/courses/${courseId}/students`, { params: clean(params) },
      )
      return { ...res.data.data, meta: res.data.meta }
    },
  })
}
