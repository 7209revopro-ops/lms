'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/axios'
import type { TetraCs } from '@/lib/api/tetraCs'

export type SupportStatus   = 'open' | 'pending' | 'resolved' | 'closed'
export type SupportCategory = 'technical' | 'billing' | 'course' | 'account' | 'other'
export type SupportProgram  = 'ai' | '4x-trading' | 'digital-marketing' | 'jura' | 'all'

export interface SupportMessage {
  _id?:       string
  senderId:   string | { id: string; name: string; avatarUrl?: string; role?: string }
  senderRole: 'student' | 'admin'
  body:       string
  createdAt:  string
}

export interface SupportUser { id: string; name: string; email: string; avatarUrl?: string; tetraCs?: TetraCs | null }

export interface SupportTicket {
  id:             string
  userId:         SupportUser | string
  subject:        string
  category:       SupportCategory
  program?:       'ai' | '4x-trading' | 'digital-marketing'
  status:         SupportStatus
  messages:       SupportMessage[]
  lastMessageAt:  string
  lastSenderRole: 'student' | 'admin'
  adminUnread:    boolean
  createdAt:      string
}

export interface SupportStats {
  total: number; open: number; pending: number; resolved: number; closed: number; unread: number
}

export interface ProgramStat {
  program: string; label: string; total: number; open: number; pending: number
  resolved: number; closed: number; unread: number; avgResponseHours: number; responded: number
}

export const supportKeys = {
  list:        (p: object)   => ['admin', 'support', 'list', p] as const,
  one:         (id: string)  => ['admin', 'support', 'ticket', id] as const,
  stats:       (prog?: string) => ['admin', 'support', 'stats', prog ?? 'all'] as const,
  performance: ()            => ['admin', 'support', 'performance'] as const,
}

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  technical: 'Technical Issue',
  billing:   'Billing / Payment',
  course:    'Course Content',
  account:   'Account & Profile',
  other:     'Other',
}

export const PROGRAM_LABELS: Record<string, string> = {
  'ai':                'AI',
  '4x-trading':        'FOREX',
  'digital-marketing': 'Digital Marketing',
}

export { CATEGORY_LABELS }

/* GET /support/admin */
export function useAdminTickets(filter: { status?: string; search?: string; program?: string } = {}) {
  return useQuery({
    queryKey: supportKeys.list(filter),
    queryFn:  async () => {
      const params: Record<string, string> = {}
      if (filter.status  && filter.status  !== 'all') params.status  = filter.status
      if (filter.search?.trim())                       params.search  = filter.search.trim()
      if (filter.program && filter.program !== 'all') params.program = filter.program
      return (await api.get<{ success: true; data: SupportTicket[] }>('/support/admin', { params })).data.data
    },
    staleTime: 10_000,
  })
}

/* Lightweight count for the sidebar badge — polls every 60 s */
export function useUnreadSupportCount() {
  return useQuery({
    queryKey: ['admin', 'support', 'unread-count'],
    queryFn:  async () => {
      const data = (await api.get<{ success: true; data: SupportStats }>('/support/admin/stats')).data.data
      return data.unread
    },
    staleTime:       30_000,
    refetchInterval: 60_000,
  })
}

/* GET /support/admin/stats */
export function useSupportStats(program?: string) {
  return useQuery({
    queryKey: supportKeys.stats(program),
    queryFn:  async () => {
      const params: Record<string, string> = {}
      if (program && program !== 'all') params.program = program
      return (await api.get<{ success: true; data: SupportStats }>('/support/admin/stats', { params })).data.data
    },
    staleTime: 15_000,
  })
}

/* GET /support/admin/performance */
export function useSupportPerformance() {
  return useQuery({
    queryKey: supportKeys.performance(),
    queryFn:  async () =>
      (await api.get<{ success: true; data: ProgramStat[] }>('/support/admin/performance')).data.data,
    staleTime: 30_000,
  })
}

/* GET /support/:id */
export function useAdminTicket(id: string | null) {
  return useQuery({
    queryKey: supportKeys.one(id ?? ''),
    queryFn:  async () => (await api.get<{ success: true; data: SupportTicket }>(`/support/${id}`)).data.data,
    enabled:  !!id,
    staleTime: 5_000,
  })
}

/* POST /support/:id/messages */
export function useAdminReply(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) =>
      (await api.post<{ success: true; data: SupportTicket }>(`/support/${id}/messages`, { body })).data.data,
    onSuccess: (ticket) => {
      qc.setQueryData(supportKeys.one(id), ticket)
      qc.invalidateQueries({ queryKey: ['admin', 'support'] })
    },
  })
}

/* PATCH /support/:id/status */
export function useSetTicketStatus(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (status: SupportStatus) =>
      (await api.patch<{ success: true; data: SupportTicket }>(`/support/${id}/status`, { status })).data.data,
    onSuccess: (ticket) => {
      qc.setQueryData(supportKeys.one(id), ticket)
      qc.invalidateQueries({ queryKey: ['admin', 'support'] })
    },
  })
}
