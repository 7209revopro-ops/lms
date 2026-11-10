'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiPost } from '@/lib/axios'

/* Meeting requests and Meetings done (the user, 2026-11-10): kept in the CS Portal, asked of it by this server as the
   instructor signed in — POST /admin/cs-meetings/:action (backend services/csPortalMeetings.service.ts). */

const ask = <T,>(action: string, body: Record<string, unknown> = {}) => apiPost<T>(`/admin/cs-meetings/${action}`, body)

export interface CsMentor {
  mentor: boolean; message?: string
  /** An admin's own CS Portal account (Super Admin, Admin, CS Manager): what it may read there, read only. */
  viewer?: boolean
  /** Whose requests: their own ("mine"), the ones their account decides ("to_decide", read only), or none (a Chief). */
  requests?: 'mine' | 'to_decide' | null
  role?: 'junior_mentor' | 'senior_mentor' | 'subjunior_mentor' | 'chief_mentor'; name?: string
  /** A Senior / Junior / Sub-junior asks for student meetings; a Chief books them. */
  asks?: boolean
  meetings_done?: Array<'meetings' | 'commission'>
}
export interface MeetingRequest {
  id: string; number: string; status: 'pending' | 'booking' | 'approved' | 'rejected' | 'cancelled' | 'blocked'; view: string
  blocked: { reason?: string; allowed_from?: string } | null; escalated: { by_name?: string; at?: string; note?: string } | null
  override_reason: string; override_by_name: string
  student: { id: string; name: string; code: string; cs_name: string }
  mentor: { id: string; name: string; email: string }
  category: string; course: string; duration_mins: number; in_person: boolean; location: string; notes: string; mode: 'online' | 'offline' | 'cs'
  requested_at: string; scheduled_start: string | null; decided_at: string | null; decided_by_name: string; reason: string; title: string
}
export interface Eligibility {
  blocked: boolean; lms_checked: boolean; allowed_from: string | null; message: string
  last: { mentor: string; at: string; days_ago: number; outcome: string } | null
  upcoming: { mentor: string; at: string }[]
}
export interface MeetingStudent { id: string; name: string; code: string; email: string; cs_name: string }
export interface StudentMeeting { kind: 'held' | 'request'; at: string | null; mentor: string; category: string; course: string; outcome?: string; remark?: string; status?: string; reason?: string }
export interface CommissionRow {
  id: string; txn_id: string; requested_at: string; course: string; paid_aed: number; payment_status?: string
  student: { id: string; name: string; code: string }; mentor: { id: string; name: string }
  pct: number; commission_aed: number; status: string
  meeting: { id: string; starts_at: string; stage: string; how: 'linked' | 'calendar' } | null
}
export interface Commissions { rows: CommissionRow[]; totals: { count: number; aed: number; by_status: Record<string, number> }; mentors: { id: string; name: string }[]; sees: 'own' | 'team' | 'everyone' }
export interface MeetingDoneRow {
  id: string; meeting_id: string; starts_at: string; title: string; category: string; status: string; stage: string; summary: string
  mentor: { name: string; email: string }; attendee: string; converted: boolean
  student: { id: string; name: string; code: string; cs: string; team: string } | null
  payment: { id: string; aed: number; product: string; date: string; status: 'approved' | 'pending'; linked: boolean } | null
  cs_status: { status: string; reason: string } | null; cancel_reason: string
}
export interface MeetingsDone { rows: MeetingDoneRow[]; mentors: { name: string; email: string }[] }

export const csError = (e: unknown, fallback = 'Something went wrong') =>
  String((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (e as Error)?.message ?? fallback)

/** Whether the CS Portal knows the instructor signed in as a mentor — and what they get. */
export function useCsMentor(enabled: boolean) {
  return useQuery({ queryKey: ['cs-meetings', 'me'], queryFn: () => ask<CsMentor>('me'), enabled, retry: false, staleTime: 10 * 60_000 })
}
export function useMyMeetingRequests() {
  return useQuery({
    queryKey: ['cs-meetings', 'requests'],
    queryFn: () => ask<{ requests: MeetingRequest[]; counts: Record<string, number> }>('listMeetingRequests'),
    retry: false, refetchInterval: 60_000,
  })
}
export function useMeetingRequestReview(id: string | null) {
  return useQuery({
    queryKey: ['cs-meetings', 'review', id],
    queryFn: () => ask<{ request: MeetingRequest; eligibility: Eligibility }>('getMeetingRequestReview', { id }),
    enabled: !!id, retry: false,
  })
}
export function useMeetingStudents(q: string) {
  return useQuery({
    queryKey: ['cs-meetings', 'students', q],
    queryFn: () => ask<{ students: MeetingStudent[] }>('searchMeetingStudents', { q }),
    enabled: q.length >= 2, retry: false, staleTime: 30_000,
  })
}
export function useStudentMeetingHistory(studentId: string | null) {
  return useQuery({
    queryKey: ['cs-meetings', 'history', studentId],
    queryFn: () => ask<{ meetings: StudentMeeting[] }>('getStudentMeetingHistory', { studentId }),
    enabled: !!studentId, retry: false,
  })
}
export function useAskForMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { studentId: string; category: string; course: string; durationMins: number; mode: string; location: string; notes: string }) =>
      ask<{ ok: boolean; blocked?: boolean; message?: string; request: MeetingRequest }>('createMeetingRequest', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cs-meetings'] }) },
  })
}
export function useTakeBackRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ask<{ ok: boolean }>('cancelMeetingRequest', { id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cs-meetings'] }) },
  })
}
export function useMeetingCommissions(days: { from: string; to: string }, mentor: string) {
  return useQuery({
    queryKey: ['cs-meetings', 'commission', days.from, days.to, mentor],
    queryFn: () => ask<Commissions>('getMeetingCommissions', { ...days, mentor }),
    retry: false, placeholderData: prev => prev,
  })
}
export function useMeetingsDone(filters: { from: string; to: string; status: string; mentor: string }, enabled: boolean) {
  return useQuery({
    queryKey: ['cs-meetings', 'done', filters],
    queryFn: () => ask<MeetingsDone>('getMeetingsDone', filters),
    enabled, retry: false, placeholderData: prev => prev,
  })
}
