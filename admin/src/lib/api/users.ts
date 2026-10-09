'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/axios'
import type { PaginationMeta } from '@/types/index'
import type { EnrollmentApplication } from './enrollmentRequests'
import type { TetraCs } from '@/lib/api/tetraCs'

/* ── Enrollment (student course access) ─────────────── */
/* Which sales CRM sold an enrolment finance created: Delta's Sales CRM, the
   Remote CRM or Draw. Same codes as finance and the Root portal. */
export type SalesCrm = 'delta' | 'remote' | 'draw' | 'banglore'

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
  /* The enrolment's money as Delta Finance approved it — fee, paid, balance,
     the bonus given at the close and the receipt. Minor units. Only on
     enrolments finance created, and only sent to full admins. */
  feeSummary?: {
    invoiceId:      string
    invoiceNumber?: string
    currency:       string
    feeMinor:       number
    paidMinor:      number
    balanceMinor:   number
    bonus?:         { given: boolean; amountMinor: number; currency?: string } | null
    receipt?:       { url: string; name?: string; mimeType?: string } | null
    recordedAt?:    string
  }
  /* Which sales CRM sold it, where finance enrolled them. Every admin role sees it. */
  salesCrm?: SalesCrm
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
  /* Staff-only contact number, also used as their WhatsApp number (e.g. a
     new-support-ticket alert). Meaningless on a student account. */
  phone?:           string
  /* An instructor LENT to the other academy. They stay OWNED by the academy on
     their organizationId -- both may list them and schedule classes for them,
     which is what keeps "whose instructor is this" answerable for reporting.
     The API has always sent this; nothing rendered it, so a lent instructor was
     indistinguishable from an ordinary one in every list. */
  sharedAcrossOrgs?: boolean
  organizationId?:   string
  category?:        '4x-trading' | 'digital-marketing' | 'ai' | 'jura'
  categories?:      ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]
  /* The Google account an instructor joins Meet with, when it isn't their
     login email (most log in with a non-Google Zoho address). null/absent =
     use `email`. */
  meetEmail?:       string | null
  program?:         'ai' | 'digital_marketing' | 'forex' | 'jura'
  enrollmentStatus?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  /** Students only: programmes of the courses they are enrolled on — derived
      server-side, separate from the programmes they were approved into. */
  enrolledPrograms?: string[]
  rejectionReason?:        string
  rejectedByEmail?:        string
  rejectedByName?:         string
  rejectedAt?:             string
  enrollmentApplication?:  EnrollmentApplication
  lastLoginAt?:     string
  createdAt:        string
  updatedAt:        string
  customRoleId?:    string | { id: string; name: string }
  /** Their CS and CS team in Tetra Commission, where it has said. */
  tetraCs?:         TetraCs | null
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

/* Instructors who teach a course's programme, for the class forms' picker.
   Filtered on the server (`category` matches an instructor's `category` or any
   of `categories`, lent instructors included), so the 200 cap applies to the
   programme rather than the whole academy. No programme → every instructor.
   A sub-admin's list is narrowed to their own department by the server either
   way. */
export function useProgramInstructors(program?: string | null) {
  return useUsers('instructor', { per_page: 200, ...(program ? { category: program } : {}) })
}

/** Clears a picked instructor who is not in `list` — i.e. the course, and with
    it the programme, just changed. `list` is undefined while loading, so a
    list still in flight never wipes a valid choice. */
export function useDropInstructorOutside(
  list: { id: string }[] | undefined,
  instructorId: string,
  setInstructorId: (id: string) => void,
) {
  useEffect(() => {
    if (list && instructorId && !list.some(i => i.id === instructorId)) setInstructorId('')
  }, [list, instructorId, setInstructorId])
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
      /* The Students table lists each student's enrolled programmes — a new
         course may add one. */
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
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
  mode?:           'read' | 'write'
}

/* mode 'write' — read & write (2026-10-09): the student portal lets the operator change things, except the student's
   security, payments and ID documents, and records every change as theirs (backend auth.middleware.ts). */
export function useImpersonateClient() {
  return useMutation({
    mutationFn: async ({ userId, mode = 'read' }: { userId: string; mode?: 'read' | 'write' }): Promise<ClientImpersonationHandoff> => {
      const res = await api.post<{ success: true; data: ClientImpersonationHandoff }>(
        `/admin/users/${userId}/impersonate-client`, { mode },
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
    }: { id: string; meetEmail?: string; role?: AdminUser['role']; isActive?: boolean; isVerified?: boolean; name?: string; email?: string; category?: '4x-trading' | 'digital-marketing' | 'ai' | 'jura' | null; categories?: ('4x-trading' | 'digital-marketing' | 'ai' | 'jura')[]; avatarUrl?: string; headline?: string; bio?: string; phone?: string; program?: 'ai' | 'digital_marketing' | 'forex' | 'jura'; sharedAcrossOrgs?: boolean }) => {
      const res = await api.patch<{ success: true; data: AdminUser }>(`/admin/users/${id}`, dto)
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
  })
}
