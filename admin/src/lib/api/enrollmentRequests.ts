'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'

export type EnrollmentRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type ProgramCategory = '4x-trading' | 'digital-marketing' | 'ai' | 'jura'

export interface EnrollmentApplication {
  phone?:              string
  emergencyContact?:   string
  gender?:             string
  dateOfBirth?:        string
  nationality?:        string
  homeCountry?:        string
  occupation?:         string
  idType?:             string
  idNumber?:           string
  emiratesId?:         string
  countryAttendance?:  string
  villa?:              string
  city?:               string
  addressCountry?:     string
  passportUrl?:        string
  idDocUrl?:           string
  photoUrl?:           string
  experienceLevel?:    string
  preferredStartDate?: string
  hearAboutUs?:        string
  referralName?:       string
  programs?:           string[]
  paymentMethod?:      string
}

export interface EnrollmentRequest {
  id:                string
  name:              string
  email:             string
  /** Legacy single category */
  category?:         ProgramCategory
  /** Multi-category (new) */
  categories:        ProgramCategory[]
  enrollmentStatus:  EnrollmentRequestStatus
  rejectionReason?:  string
  enrollmentCancellationReason?: string
  /* Approval metadata */
  approvedBy?:       string
  approvedByEmail?:  string
  approvedByName?:   string
  approvedByRole?:   string
  approvedAt?:       string
  /* Rejection metadata */
  rejectedByEmail?:  string
  rejectedByName?:   string
  rejectedByRole?:   string
  rejectedAt?:       string
  isActive:               boolean
  createdAt:              string
  enrollmentApplication?: EnrollmentApplication
}

const KEYS = {
  list: (status: string, category?: string) =>
    ['admin', 'enrollment-requests', status, category ?? 'all'] as const,
}

export function useEnrollmentRequests(
  status: EnrollmentRequestStatus | 'all' = 'pending',
  category?: ProgramCategory,
) {
  return useQuery({
    queryKey: KEYS.list(status, category),
    queryFn: async () => {
      /* per_page 100 - the backend's maximum (admin.routes.ts:694) - because
         this table has no pagination control. It was sending nothing, so the
         backend's default of 20 applied: the Pending card read the real
         total from meta.total_count while the table under it listed twenty
         rows and there was no next page to reach the rest. Worse, the search
         box filters those rows CLIENT-side, so typing the name of the 21st
         pending student rendered "No pending requests" and the admin
         concluded they had never signed up.

         100 covers any realistic single-status backlog here, and the page
         now says so out loud when there are more rather than quietly
         trimming - see the notice above the table. A real pager is still the
         right answer if these ever run past 100. */
      const params: Record<string, string> = { status, per_page: '100' }
      if (category) params['category'] = category
      const res = await api.get<{ success: true; data: EnrollmentRequest[]; meta: { total_count: number; total_pages: number; page: number; has_next: boolean; has_prev: boolean } }>(
        '/admin/enrollment-requests',
        { params },
      )
      return res.data
    },
    staleTime: 30_000,
  })
}

export function useApproveEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, categories }: { userId: string; categories?: ProgramCategory[] }) => {
      const res = await api.patch<{ success: true; data: { id: string; enrollmentStatus: string; categories: string[] } }>(
        `/admin/enrollment-requests/${userId}/approve`,
        categories ? { categories } : {},
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useRejectEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const res = await api.patch<{ success: true; data: { id: string; enrollmentStatus: string } }>(
        `/admin/enrollment-requests/${userId}/reject`,
        { reason },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useRemoveEnrollmentCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, category }: { userId: string; category: ProgramCategory }) => {
      const res = await api.patch<{ success: true; data: { id: string; enrollmentStatus: string; categories: string[] } }>(
        `/admin/enrollment-requests/${userId}/remove-category`,
        { category },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useToggleBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const res = await api.patch<{ success: true; data: { id: string; isActive: boolean } }>(
        `/admin/users/${userId}`,
        { isActive },
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useRevokeToViewer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const res = await api.patch<{ success: true; data: { id: string; enrollmentStatus: string } }>(
        `/admin/enrollment-requests/${userId}/revoke-to-viewer`,
        {},
      )
      return res.data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'enrollment-requests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

/** Backward compat alias */
export const useCancelEnrollment = useRejectEnrollment
