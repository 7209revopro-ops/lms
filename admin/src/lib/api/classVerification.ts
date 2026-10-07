'use client'
/* Class Verification — the mentor's attendance check and class review after
   every class (backend: admin.routes.ts CLASS VERIFICATION, reminders.job.ts
   runMentorVerification). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/axios'

export type VerifyStatus = 'pending' | 'overdue' | 'verified'

export interface VerifyRow {
  id: string
  title: string
  scheduledStart: string
  durationMins: number
  isOnline: boolean
  language: string | null
  mentor: { id: string; name: string } | null
  course: { id: string; title: string } | null
  status: VerifyStatus
  verifiedAt: string | null
  verifiedBy: string | null
  rating: number | null
  students: number
  attended: number
  missed: number
}

export interface VerifyList {
  counts: Record<VerifyStatus, number>
  rows: VerifyRow[]
}

export interface VerifyStudent {
  bookingId: string
  name: string
  email: string | null
  phone: string | null
  cs: string | null
  team: string | null
  studentCode: string | null
  status: 'booked' | 'attended' | 'missed'
  joinedAt: string | null
  joinedVia: string | null
  note: string
}

export interface VerifyClass {
  id: string
  title: string
  scheduledStart: string
  durationMins: number
  isOnline: boolean
  language: string | null
  location: string | null
  room: string | null
  mentor: { id: string; name: string } | null
  course: { id: string; title: string } | null
  ended: boolean
  status: VerifyStatus
  verifiedAt: string | null
  verifiedBy: string | null
  review: { rating: number | null; topics: string; issues: string }
  students: VerifyStudent[]
}

export interface VerifySubmit {
  marks: { bookingId: string; status: 'attended' | 'missed'; note?: string }[]
  rating: number
  topics?: string
  issues?: string
}

export const verifyKeys = {
  all:  ['admin', 'class-verification'] as const,
  list: (p: Record<string, string | undefined>) => ['admin', 'class-verification', 'list', p] as const,
  one:  (id: string) => ['admin', 'class-verification', 'one', id] as const,
}

export function useVerifyList(params: { status: VerifyStatus; mentorId?: string; from?: string; to?: string }) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
  return useQuery({
    queryKey: verifyKeys.list(clean),
    queryFn:  () => apiGet<VerifyList>('/admin/class-verification', clean),
    staleTime: 15_000,
  })
}

export function useVerifyClass(id: string | undefined) {
  return useQuery({
    queryKey: verifyKeys.one(id ?? ''),
    queryFn:  () => apiGet<VerifyClass>(`/admin/class-verification/${id}`),
    enabled:  !!id,
  })
}

export function useSubmitVerification(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: VerifySubmit) => apiPost<{ verified: boolean; marked: number }>(`/admin/class-verification/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: verifyKeys.all }) },
  })
}
