'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/axios'

/* Mentor KPIs (2026-11-09): worked out in Root, shown here view only — /admin/mentor-kpis/*. */

export interface KpiResult {
  metric: string; name: string; unit: string; direction: 'up' | 'down'; mode: 'scored' | 'monitoring' | 'off'
  share: number; value: number | null; target: number | null; targetFrom: 'role' | 'mentor' | null; effectiveTarget: number | null
  score: number | null; status: string; note: string
  corrected: { action: 'set_value' | 'leave_out'; reason: string; was: number | null } | null
}
export interface MentorMonth {
  closed?: true; missing?: true; message?: string
  month?: string; elapsed?: number; observationUntil?: string | null
  snapshot?: { version: number; frozenAt: string } | null
  statusLabels?: Record<string, string>
  mentor?: {
    email: string; name: string; roleLabel: string; score: number | null; coverage: number
    categories: { key: string; name: string; weight: number; score: number | null; subs: { key: string; name: string; score: number | null; kpis: KpiResult[] }[] }[]
  }
  trend?: { month: string; score: number | null }[]
  corrections?: { id: string; metricName: string; action: string; value: number | null; reason: string; status: string; decisionNote: string }[]
}
export interface TeamMonth {
  closed?: true; missing?: true; message?: string
  month?: string; observationUntil?: string | null
  snapshot?: { version: number } | null
  categories?: { key: string; name: string; share: number }[]
  mentors?: { email: string; name: string; roleLabel: string; score: number | null; coverage: number; categories: { key: string; score: number | null }[] }[]
}

export const kpiError = (e: unknown, fallback = 'Could not load the KPIs') =>
  String((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (e as Error)?.message ?? fallback)

export function useMyKpis(month: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'mentor-kpis', 'me', month],
    queryFn: () => apiGet<MentorMonth>('/admin/mentor-kpis/me', { month }),
    enabled, retry: false, staleTime: 60_000,
  })
}
export function useTeamKpis(month: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'mentor-kpis', 'team', month],
    queryFn: () => apiGet<TeamMonth>('/admin/mentor-kpis/team', { month }),
    enabled, retry: false, staleTime: 60_000,
  })
}
export function useMentorKpis(email: string | null, month: string) {
  return useQuery({
    queryKey: ['admin', 'mentor-kpis', 'mentor', email, month],
    queryFn: () => apiGet<MentorMonth>('/admin/mentor-kpis/mentor', { email, month }),
    enabled: !!email, retry: false, staleTime: 60_000,
  })
}
export function useAskKpiCorrection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { month: string; email: string; metric: string; action: 'set_value' | 'leave_out'; value: number | null; reason: string; evidence: string }) =>
      apiPost<{ closed?: true; status?: string }>('/admin/mentor-kpis/corrections', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mentor-kpis'] }),
  })
}
