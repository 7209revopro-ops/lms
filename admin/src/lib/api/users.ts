'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'
import type { EnrollmentApplication } from './enrollmentRequests'

/* ── Enrollment (student course access) ─────────────── */
export interface StudentEnrollment {
  _id:              string
  id:               string
  // Populated via `.lean({virtuals:true})` — the sub-doc virtual `id` isn't
  // applied to populated refs under lean, so only `_id` is reliably present.
  courseId:         { _id?: string; id?: string; title: string; thumbnailUrl?: string }
  blockedLessons:   string[]
  status?:          'active' | 'completed' | 'dropped'
  progressPercent?: number
  enrolledAt?:      string
  createdAt:        string
}

const enrollmentKeys = {
  forStudent: (userId: string) => ['admin', 'enrollments', userId] as const,
}

/* ── Orders (student purchase history) ──────────────── */
export interface StudentOrder {
  id:        string
  courseId:  { _id?: string; id?: string; title: string; thumbnailUrl?: string }
  amount:    number
  currency:  string
  gateway:   string
  status:    'pending' | 'paid' | 'refunded' | 'cancelled'
  createdAt: string
}

const orderKeys = {
  forStudent: (userId: string) => ['admin', 'orders', 'student', userId] as const,
}

export type AdminUserRole =
  | 'student'
  | 'instructor'
  | 'sub_admin'
  | 'support'
  | 'admin'
  | 'super_admin'

export interface AdminUser {
  id:               string
  name:             string
  email:            string
  avatarUrl?:       string
  role:             AdminUserRole
  isVerified:       boolean
  isActive:         boolean
  headline?:        string
  bio?:             string
  /* An instructor LENT to the other academy. They stay OWNED by the academy on
     their organizationId -- both may list them and schedule classes for them,
     which is what keeps "whose instructor is this" answerable for reporting.
     The API has always sent this; nothing rendered it, so a lent instructor was
     indistinguishable from an ordinary one in every list. */
  sharedAcrossOrgs?: boolean
  organizationId?:   string
  category?:        '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  categories?:      ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]
  program?:         'ai' | 'digital_marketing' | 'forex' | 'jura'
  enrollmentStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  rejectionReason?:        string
  rejectedByEmail?:        string
  rejectedByName?:         string
  rejectedAt?:             string
  enrollmentApplication?:  EnrollmentApplication
  lastLoginAt?:     string
  createdAt:        string
  updatedAt:        string
  customRoleId?:    string | { id: string; name: string }
}

export const userKeys = {
  list: (role: string, params: object) => ['admin', 'users', role, params] as const,
}

export function useUsers(role: AdminUserRole | undefined, params: {
  page?: number; per_page?: number; search?: string; category?: string; status?: 'active' | 'inactive'; exclude_students?: boolean; enrollmentStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled'
} = {}) {
  return useQuery({
    queryKey: userKeys.list(role ?? 'all', params),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: AdminUser[]; meta: PaginationMeta }>(
        '/admin/users',
        { params: { ...(role ? { role } : {}), ...params } },
      )
      return { docs: res.data.data, meta: res.data.meta }
    },
    staleTime: 30_000,
  })
}

/* ─── Student Enrollments ───────────────────────────── */
export function useStudentEnrollments(userId: string | undefined) {
  return useQuery({
    queryKey: enrollmentKeys.forStudent(userId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: StudentEnrollment[] }>(
        `/admin/users/${userId}/enrollments`,
      )
      return res.data.data
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

/* ─── Student Orders ─────────────────────────────────── */
export function useStudentOrders(userId: string | undefined) {
  return useQuery({
    queryKey: orderKeys.forStudent(userId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ success: true; data: StudentOrder[] }>(
        `/admin/users/${userId}/orders`,
      )
      return res.data.data
    },
    enabled: !!userId,
    staleTime: 30_000,
  })
}

export function useUpdateEnrollmentAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, blockedLessons }: { id: string; blockedLessons: string[] }) => {
      const res = await api.patch<{ success: true; data: StudentEnrollment }>(
        `/admin/enrollments/${id}`, { blockedLessons },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollments'] })
    },
  })
}

export function useEnrollStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, courseId }: { userId: string; courseId: string }) => {
      const res = await api.post<{ success: true; data: StudentEnrollment }>(
        `/admin/users/${userId}/enrollments`, { courseId },
      )
      return res.data.data
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollments', userId] })
    },
  })
}

export function useRemoveEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ enrollmentId }: { enrollmentId: string; userId: string }) => {
      await api.delete(`/admin/enrollments/${enrollmentId}`)
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollments', userId] })
    },
  })
}

/* ─── Impersonate a user ─────────────────────────────── */
export function useImpersonateUser() {
  return useMutation({
    mutationFn: async (userId: string): Promise<{ token: string; user: { id: string; name: string; email: string; role: string; avatarUrl?: string } }> => {
      const res = await api.post<{ success: true; data: { token: string; user: { id: string; name: string; email: string; role: string; avatarUrl?: string } } }>(
        `/admin/users/${userId}/impersonate`,
      )
      return res.data.data
    },
  })
}

/* ─── View a student in the CLIENT portal ─────────────────────
   Returns a one-time code, not a token. The admin app cannot hold a client
   session: the portals are separate origins and the cookies are host-only, so
   the code is redeemed by the client origin itself. `clientUrl` is built by the
   backend from CLIENT_URL and is the only thing this app needs to open.
──────────────────────────────────────────────────────────────── */
export interface ClientImpersonationHandoff {
  code:            string
  expiresIn:       number
  impersonationId: string
  clientUrl:       string
  user:            { id: string; name: string; email: string }
}

export function useImpersonateClient() {
  return useMutation({
    mutationFn: async (userId: string): Promise<ClientImpersonationHandoff> => {
      const res = await api.post<{ success: true; data: ClientImpersonationHandoff }>(
        `/admin/users/${userId}/impersonate-client`,
      )
      return res.data.data
    },
  })
}

/* ─── Delete user (hard delete) ──────────────────────────────── */
export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/admin/users/${userId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}

/* ─── Update user (role / isActive / isVerified / name / email) ─── */
export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id, ...dto
      /* `sharedAcrossOrgs` lends an instructor to the other academy. The
         backend has accepted it on this PATCH since the feature shipped and
         this type never named it, so no screen could send it even by accident:
         an instructor could be lent at creation and never afterwards, and
         un-lending had no route at all. Who may set it is the server's
         business — an admin or super admin, and only the academy that OWNS
         the instructor. */
    }: { id: string; role?: AdminUser['role']; isActive?: boolean; isVerified?: boolean; name?: string; email?: string; category?: '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]; avatarUrl?: string; headline?: string; bio?: string; program?: 'ai' | 'digital_marketing' | 'forex' | 'jura'; sharedAcrossOrgs?: boolean }) => {
      const res = await api.patch<{ success: true; data: AdminUser }>(`/admin/users/${id}`, dto)
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}
